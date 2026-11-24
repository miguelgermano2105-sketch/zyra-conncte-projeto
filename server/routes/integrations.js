import { Router } from 'express';
import crypto from 'node:crypto';
import { all, get, run, now, uid, transaction } from '../db.js';
import { ah, bad, forbidden, notFound } from '../lib/http.js';
import { authRequired, botFromRequest, createBotToken, hashToken } from '../lib/auth.js';
import { PERM } from '../lib/perms.js';
import { requireChannelAccess, requireServerPerm } from '../lib/guards.js';
import { serializeMessage } from '../lib/serialize.js';
import { toChannel, toServer } from '../lib/bus.js';

const router = Router();

/* ------------------------------ bots (API) ------------------------------ */

const botLimiter = new Map();
function rateLimitBots(botId) {
  const ts = now();
  const list = (botLimiter.get(botId) || []).filter((t) => ts - t < 60_000);
  if (list.length >= 60) throw bad('Limite de 60 mensagens por minuto por bot atingido.', 'bot_rate_limited');
  list.push(ts);
  botLimiter.set(botId, list);
}

/** Create the pseudo-user that authors bot/webhook messages. */
export function createIntegrationUser({ id, name, avatarUrl, ownerId }) {
  const username = `${String(name).toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 12) || 'bot'}_${id.slice(0, 4)}`;
  const email = `integration+${id}@bots.zyra.local`;
  run(
    `INSERT INTO users (id, username, username_lower, email, email_lower, display_name, password_hash,
      avatar_url, banner_color, bio, status, custom_status, is_admin, suspended, preferences, created_at, last_seen, is_bot, bot_owner_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'offline', '', 0, 0, '{}', ?, ?, 1, ?)`,
    id, username, username.toLowerCase(), email, email, String(name).slice(0, 40), '!',
    avatarUrl || null, '#6d5efc', now(), now(), ownerId,
  );
  return username;
}

router.use(['/bots', '/servers/:serverId/bots', '/webhooks', '/servers/:serverId/webhooks'], authRequired);

router.get('/bots', ah(async (req, res) => {
  const rows = all('SELECT * FROM bots WHERE owner_id = ? ORDER BY created_at DESC', req.user.id);
  res.json({
    bots: rows.map((b) => ({
      id: b.id, name: b.name, avatarUrl: b.avatar_url || null,
      tokenPrefix: b.token_prefix, createdAt: b.created_at,
    })),
  });
}));

router.post('/bots', ah(async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40);
  if (name.length < 2) throw bad('Informe um nome para o bot.', 'invalid_name');
  const botId = uid();
  const userId = uid();
  const { raw, hash } = createBotToken(botId);
  transaction(() => {
    createIntegrationUser({ id: userId, name, ownerId: req.user.id });
    run('INSERT INTO bots (id, owner_id, name, avatar_url, token_hash, token_prefix, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      botId, req.user.id, name, null, hash, raw.slice(0, 18), now());
  });
  res.status(201).json({
    bot: { id: botId, name, token: raw, tokenPrefix: raw.slice(0, 18) },
    warning: 'Guarde o token agora: ele não será exibido novamente.',
  });
}));

router.delete('/bots/:botId', ah(async (req, res) => {
  const bot = get('SELECT * FROM bots WHERE id = ?', req.params.botId);
  if (!bot) throw notFound('Bot não encontrado.');
  if (bot.owner_id !== req.user.id && !req.user.is_admin) throw forbidden('Apenas o dono pode remover o bot.');
  run('DELETE FROM bots WHERE id = ?', bot.id);
  res.json({ ok: true });
}));

router.get('/servers/:serverId/bots', ah(async (req, res) => {
  requireServerPerm(req.params.serverId, req.user.id, PERM.MANAGE_BOTS);
  const rows = all(
    `SELECT b.* FROM server_bots sb JOIN bots b ON b.id = sb.bot_id WHERE sb.server_id = ? ORDER BY b.name`,
    req.params.serverId,
  );
  res.json({ bots: rows.map((b) => ({ id: b.id, name: b.name, avatarUrl: b.avatar_url || null })) });
}));

router.post('/servers/:serverId/bots', ah(async (req, res) => {
  const { server } = requireServerPerm(req.params.serverId, req.user.id, PERM.MANAGE_BOTS);
  const botId = String(req.body?.botId || '');
  const bot = get('SELECT * FROM bots WHERE id = ?', botId);
  if (!bot) throw notFound('Bot não encontrado.');
  run('INSERT OR REPLACE INTO server_bots (server_id, bot_id, added_at) VALUES (?, ?, ?)', server.id, bot.id, now());
  res.status(201).json({ ok: true });
}));

router.delete('/servers/:serverId/bots/:botId', ah(async (req, res) => {
  const { server } = requireServerPerm(req.params.serverId, req.user.id, PERM.MANAGE_BOTS);
  run('DELETE FROM server_bots WHERE server_id = ? AND bot_id = ?', server.id, req.params.botId);
  res.json({ ok: true });
}));

/** Bot endpoint: POST /api/bot/messages with header `Authorization: Bot <token>` */
router.post('/bot/messages', ah(async (req, res) => {
  const bot = botFromRequest(req);
  if (!bot) throw forbidden('Token de bot inválido.', 'invalid_bot_token');
  rateLimitBots(bot.id);

  const channelId = String(req.body?.channelId || '');
  const channel = get('SELECT * FROM channels WHERE id = ?', channelId);
  if (!channel) throw notFound('Canal não encontrado.');
  if (!get('SELECT 1 AS x FROM server_bots WHERE server_id = ? AND bot_id = ?', channel.server_id, bot.id)) {
    throw forbidden('Adicione o bot ao servidor antes de publicar mensagens.', 'bot_not_in_server');
  }
  const content = String(req.body?.content || '').slice(0, 4000);
  if (!content.trim()) throw bad('Conteúdo vazio.', 'empty_message');
  const botUser = get('SELECT * FROM users WHERE id = ?', bot.id) || get('SELECT * FROM users WHERE bot_owner_id = ? AND is_bot = 1 LIMIT 1', bot.owner_id);
  if (!botUser) throw notFound('Conta do bot não encontrada.', 'bot_user_missing');

  const result = run(
    'INSERT INTO messages (scope_type, scope_id, author_id, content, attachments, sticker_id, reply_to, pinned, system, edited_at, deleted_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, 0, NULL, NULL, ?)',
    'channel', channel.id, botUser.id, content, '[]', now(),
  );
  const row = get('SELECT * FROM messages WHERE id = ?', result.lastInsertRowid);
  const message = serializeMessage(row, botUser.id);
  toChannel(channel.id, 'message:create', { message });
  toServer(channel.server_id, 'scope:activity', {
    scopeType: 'channel', scopeId: channel.id, messageId: row.id,
    preview: content.slice(0, 120), authorName: bot.name,
  });
  res.status(201).json({ message });
}));

/* ------------------------------ webhooks ------------------------------ */

router.get('/servers/:serverId/webhooks', ah(async (req, res) => {
  requireServerPerm(req.params.serverId, req.user.id, PERM.MANAGE_WEBHOOKS);
  const rows = all('SELECT * FROM webhooks WHERE server_id = ? ORDER BY created_at DESC', req.params.serverId);
  res.json({
    webhooks: rows.map((w) => ({
      id: w.id, name: w.name, channelId: w.channel_id,
      tokenPrefix: w.token_prefix, createdAt: w.created_at,
      url: `/api/webhooks/${w.id}/${w.token_prefix}…`,
    })),
  });
}));

router.post('/servers/:serverId/webhooks', ah(async (req, res) => {
  const { server } = requireServerPerm(req.params.serverId, req.user.id, PERM.MANAGE_WEBHOOKS);
  const channelId = String(req.body?.channelId || '');
  const channel = get('SELECT * FROM channels WHERE id = ? AND server_id = ?', channelId, server.id);
  if (!channel) throw notFound('Canal não encontrado.');
  const name = String(req.body?.name || 'Webhook').trim().slice(0, 40);
  const id = uid();
  const secret = crypto.randomBytes(24).toString('base64url');
  const token = `${id}.${secret}`;
  const userId = uid();
  transaction(() => {
    createIntegrationUser({ id: userId, name, ownerId: req.user.id });
    run('INSERT INTO webhooks (id, server_id, channel_id, name, token_hash, token_prefix, creator_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, server.id, channel.id, name, hashToken(token), token.slice(0, 18), req.user.id, now());
  });
  res.status(201).json({
    webhook: {
      id, name, channelId: channel.id,
      url: `/api/webhooks/${id}/${token}`,
      tokenPrefix: token.slice(0, 18),
    },
    warning: 'Guarde a URL agora: o token não será exibido novamente.',
  });
}));

router.delete('/webhooks/:webhookId', ah(async (req, res) => {
  const hook = get('SELECT * FROM webhooks WHERE id = ?', req.params.webhookId);
  if (!hook) throw notFound('Webhook não encontrado.');
  requireServerPerm(hook.server_id, req.user.id, PERM.MANAGE_WEBHOOKS);
  run('DELETE FROM webhooks WHERE id = ?', hook.id);
  res.json({ ok: true });
}));

/** Public webhook execution endpoint (no session): POST /api/webhooks/:id/:token */
router.post('/webhooks/:webhookId/:token', ah(async (req, res) => {
  const hook = get('SELECT * FROM webhooks WHERE id = ?', req.params.webhookId);
  if (!hook) throw notFound('Webhook não encontrado.', 'invalid_webhook');
  if (hook.token_hash !== hashToken(req.params.token)) throw forbidden('Token inválido.', 'invalid_webhook_token');
  const limiterKey = `wh:${hook.id}`;
  const ts = now();
  const list = (botLimiter.get(limiterKey) || []).filter((t) => ts - t < 60_000);
  if (list.length >= 30) throw bad('Limite de 30 chamadas por minuto para este webhook.', 'webhook_rate_limited');
  list.push(ts);
  botLimiter.set(limiterKey, list);

  const content = String(req.body?.content || '').slice(0, 4000);
  if (!content.trim()) throw bad('Conteúdo vazio.', 'empty_message');
  const hookUser = get('SELECT * FROM users WHERE display_name = ? AND is_bot = 1 AND bot_owner_id = ? ORDER BY created_at DESC LIMIT 1', hook.name, hook.creator_id);
  if (!hookUser) throw notFound('Autor do webhook não encontrado.', 'webhook_user_missing');

  const result = run(
    'INSERT INTO messages (scope_type, scope_id, author_id, content, attachments, sticker_id, reply_to, pinned, system, edited_at, deleted_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, 0, NULL, NULL, ?)',
    'channel', hook.channel_id, hookUser.id, content, '[]', now(),
  );
  const row = get('SELECT * FROM messages WHERE id = ?', result.lastInsertRowid);
  const message = serializeMessage(row, hookUser.id);
  toChannel(hook.channel_id, 'message:create', { message });
  toServer(hook.server_id, 'scope:activity', {
    scopeType: 'channel', scopeId: hook.channel_id, messageId: row.id,
    preview: content.slice(0, 120), authorName: hook.name,
  });
  res.status(201).json({ ok: true, messageId: row.id });
}));

export default router;
