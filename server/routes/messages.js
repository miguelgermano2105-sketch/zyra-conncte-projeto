import { Router } from 'express';
import { all, get, run, now, jsonParse } from '../db.js';
import { ah, bad, forbidden, notFound } from '../lib/http.js';
import { authRequired } from '../lib/auth.js';
import { PERM, has } from '../lib/perms.js';
import { requireChannelAccess, requireDmAccess, notify } from '../lib/guards.js';
import { serializeMessage, serializeMessages, userRef } from '../lib/serialize.js';
import { toChannel, toDm, toServer, toUser } from '../lib/bus.js';

const router = Router();
router.use(authRequired);

const MAX_CONTENT = 4000;

function scopeAccess(scopeType, scopeId, userId, perm) {
  if (scopeType === 'dm') {
    requireDmAccess(scopeId, userId);
    return { kind: 'dm', dm: get('SELECT * FROM dms WHERE id = ?', scopeId) };
  }
  const ctx = requireChannelAccess(scopeId, userId, perm);
  return { kind: 'channel', channel: ctx.channel, perms: ctx.perms, member: ctx.member };
}

function validateAttachments(raw, userId) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw.slice(0, 10)) {
    if (!item || typeof item !== 'object') continue;
    const url = String(item.url || '');
    if (!/^(\/uploads\/|https?:\/\/)/.test(url)) continue;
    const record = item.id ? get('SELECT * FROM uploads WHERE id = ?', String(item.id)) : null;
    if (record && record.owner_id !== userId) continue;
    out.push({
      id: record?.id || null,
      url: record?.url || url,
      filename: String(item.filename || record?.filename || 'arquivo').slice(0, 120),
      mime: String(item.mime || record?.mime || 'application/octet-stream').slice(0, 100),
      size: Number(item.size || record?.size || 0),
    });
  }
  return out;
}

function mentionIds(content) {
  const ids = new Set();
  const re = /<@([0-9a-fA-F-]{36})>/g;
  let m;
  while ((m = re.exec(content))) ids.add(m[1]);
  return [...ids];
}

function pushMessage(scopeType, scopeId, row, viewerId) {
  const message = serializeMessage(row, viewerId);
  if (scopeType === 'dm') {
    const members = all('SELECT user_id FROM dm_members WHERE dm_id = ?', scopeId);
    for (const m of members) toUser(m.user_id, 'message:create', { message: serializeMessage(row, m.user_id) });
    run('UPDATE dms SET last_message_at = ? WHERE id = ?', row.created_at, scopeId);
  } else {
    toChannel(scopeId, 'message:create', { message });
    const channel = get('SELECT * FROM channels WHERE id = ?', scopeId);
    if (channel) {
      toServer(channel.server_id, 'scope:activity', {
        scopeType, scopeId, messageId: row.id,
        preview: row.content.slice(0, 120), authorName: message.author.displayName,
      });
    }
  }
  return message;
}

router.get('/channels/:channelId/messages', ah(async (req, res) => {
  const { channel, perms } = requireChannelAccess(req.params.channelId, req.user.id, PERM.VIEW_CHANNELS);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const before = Number(req.query.before || 0);
  const rows = before
    ? all('SELECT * FROM messages WHERE scope_type = ? AND scope_id = ? AND id < ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?', 'channel', channel.id, before, limit)
    : all('SELECT * FROM messages WHERE scope_type = ? AND scope_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?', 'channel', channel.id, limit);
  res.json({
    messages: serializeMessages(rows.reverse(), req.user.id),
    canSend: has(perms, PERM.SEND_MESSAGES),
    channel: { id: channel.id, name: channel.name, topic: channel.topic, slowmode: channel.slowmode },
  });
}));

router.post('/channels/:channelId/messages', ah(async (req, res) => {
  const { channel, perms, member } = requireChannelAccess(req.params.channelId, req.user.id, PERM.SEND_MESSAGES);
  if (member.timeout_until && member.timeout_until > now()) {
    throw forbidden(`Você está silenciado neste servidor até ${new Date(member.timeout_until).toLocaleString('pt-BR')}.`, 'timed_out');
  }
  const content = String(req.body?.content || '').slice(0, MAX_CONTENT);
  const attachments = validateAttachments(req.body?.attachments, req.user.id);
  const stickerId = req.body?.stickerId ? String(req.body.stickerId) : null;
  if (!content.trim() && !attachments.length && !stickerId) throw bad('Escreva uma mensagem.', 'empty_message');
  if (attachments.length && !has(perms, PERM.ATTACH_FILES)) throw forbidden('Você não pode anexar arquivos neste canal.');

  if (channel.slowmode > 0 && !has(perms, PERM.MANAGE_MESSAGES)) {
    const last = get(
      'SELECT created_at FROM messages WHERE scope_type = ? AND scope_id = ? AND author_id = ? ORDER BY id DESC LIMIT 1',
      'channel', channel.id, req.user.id,
    );
    const waitMs = channel.slowmode * 1000 - (now() - (last?.created_at || 0));
    if (waitMs > 0) {
      throw bad(`Modo lento ativo. Aguarde ${Math.ceil(waitMs / 1000)}s.`, 'slowmode');
    }
  }

  const replyTo = req.body?.replyTo ? Number(req.body.replyTo) : null;
  const ts = now();
  const result = run(
    'INSERT INTO messages (scope_type, scope_id, author_id, content, attachments, sticker_id, reply_to, pinned, system, edited_at, deleted_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, ?)',
    'channel', channel.id, req.user.id, content, JSON.stringify(attachments), stickerId, replyTo, ts,
  );
  const row = get('SELECT * FROM messages WHERE id = ?', result.lastInsertRowid);
  const message = pushMessage('channel', channel.id, row, req.user.id);

  for (const targetId of mentionIds(content)) {
    if (targetId === req.user.id) continue;
    if (!get('SELECT 1 AS x FROM server_members WHERE server_id = ? AND user_id = ?', channel.server_id, targetId)) continue;
    const n = notify(targetId, 'mention', {
      serverId: channel.server_id, channelId: channel.id, messageId: row.id,
      author: userRef(req.user), preview: content.slice(0, 140),
    });
    toUser(targetId, 'notification', n);
  }
  res.status(201).json({ message });
}));

router.get('/dms/:dmId/messages', ah(async (req, res) => {
  const dm = requireDmAccess(req.params.dmId, req.user.id);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const before = Number(req.query.before || 0);
  const rows = before
    ? all('SELECT * FROM messages WHERE scope_type = ? AND scope_id = ? AND id < ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?', 'dm', dm.id, before, limit)
    : all('SELECT * FROM messages WHERE scope_type = ? AND scope_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?', 'dm', dm.id, limit);
  res.json({ messages: serializeMessages(rows.reverse(), req.user.id), dm: { id: dm.id, type: dm.type, name: dm.name } });
}));

router.post('/dms/:dmId/messages', ah(async (req, res) => {
  const dm = requireDmAccess(req.params.dmId, req.user.id);
  const content = String(req.body?.content || '').slice(0, MAX_CONTENT);
  const attachments = validateAttachments(req.body?.attachments, req.user.id);
  const stickerId = req.body?.stickerId ? String(req.body.stickerId) : null;
  if (!content.trim() && !attachments.length && !stickerId) throw bad('Escreva uma mensagem.', 'empty_message');
  const result = run(
    'INSERT INTO messages (scope_type, scope_id, author_id, content, attachments, sticker_id, reply_to, pinned, system, edited_at, deleted_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, ?)',
    'dm', dm.id, req.user.id, content, JSON.stringify(attachments), stickerId,
    req.body?.replyTo ? Number(req.body.replyTo) : null, now(),
  );
  const row = get('SELECT * FROM messages WHERE id = ?', result.lastInsertRowid);
  const message = pushMessage('dm', dm.id, row, req.user.id);
  const others = all('SELECT user_id FROM dm_members WHERE dm_id = ? AND user_id != ?', dm.id, req.user.id);
  for (const other of others) {
    const n = notify(other.user_id, 'dm_message', {
      dmId: dm.id, messageId: row.id, author: userRef(req.user), preview: content.slice(0, 140),
    });
    toUser(other.user_id, 'notification', n);
  }
  res.status(201).json({ message });
}));

function loadMessage(id) {
  const row = get('SELECT * FROM messages WHERE id = ? AND deleted_at IS NULL', Number(id));
  if (!row) throw notFound('Mensagem não encontrada.');
  return row;
}

function canManageMessage(row, userId, perms) {
  if (row.author_id === userId) return true;
  return has(perms || 0, PERM.MANAGE_MESSAGES);
}

router.patch('/messages/:id', ah(async (req, res) => {
  const row = loadMessage(req.params.id);
  const access = scopeAccess(row.scope_type, row.scope_id, req.user.id, PERM.VIEW_CHANNELS);
  if (row.author_id !== req.user.id) throw forbidden('Você só pode editar suas próprias mensagens.');
  const content = String(req.body?.content || '').slice(0, MAX_CONTENT);
  if (!content.trim()) throw bad('A mensagem não pode ficar vazia.', 'empty_message');
  run('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?', content, now(), row.id);
  const updated = get('SELECT * FROM messages WHERE id = ?', row.id);
  if (row.scope_type === 'dm') {
    const members = all('SELECT user_id FROM dm_members WHERE dm_id = ?', row.scope_id);
    for (const m of members) toUser(m.user_id, 'message:update', { message: serializeMessage(updated, m.user_id) });
  } else {
    toChannel(row.scope_id, 'message:update', { message: serializeMessage(updated, req.user.id) });
  }
  void access;
  res.json({ message: serializeMessage(updated, req.user.id) });
}));

router.delete('/messages/:id', ah(async (req, res) => {
  const row = loadMessage(req.params.id);
  let perms = 0;
  if (row.scope_type === 'channel') {
    perms = requireChannelAccess(row.scope_id, req.user.id, PERM.VIEW_CHANNELS).perms;
  } else {
    requireDmAccess(row.scope_id, req.user.id);
  }
  if (!canManageMessage(row, req.user.id, perms)) throw forbidden('Você não pode apagar esta mensagem.');
  run('UPDATE messages SET deleted_at = ? WHERE id = ?', now(), row.id);
  if (row.scope_type === 'dm') {
    toDm(row.scope_id, 'message:delete', { id: row.id, scopeType: 'dm', scopeId: row.scope_id });
  } else {
    toChannel(row.scope_id, 'message:delete', { id: row.id, scopeType: 'channel', scopeId: row.scope_id });
  }
  res.json({ ok: true });
}));

router.post('/messages/:id/reactions', ah(async (req, res) => {
  const row = loadMessage(req.params.id);
  const emoji = String(req.body?.emoji || '').trim().slice(0, 64);
  if (!emoji) throw bad('Informe um emoji.', 'invalid_emoji');
  let perms = 0;
  if (row.scope_type === 'channel') {
    perms = requireChannelAccess(row.scope_id, req.user.id, PERM.ADD_REACTIONS).perms;
  } else {
    requireDmAccess(row.scope_id, req.user.id);
  }
  void perms;
  const existing = get('SELECT 1 AS x FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', row.id, req.user.id, emoji);
  if (existing) {
    run('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', row.id, req.user.id, emoji);
  } else {
    run('INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)', row.id, req.user.id, emoji, now());
  }
  const message = serializeMessage(get('SELECT * FROM messages WHERE id = ?', row.id), req.user.id);
  if (row.scope_type === 'dm') toDm(row.scope_id, 'message:update', { message });
  else toChannel(row.scope_id, 'message:update', { message });
  res.json({ message });
}));

router.post('/messages/:id/pin', ah(async (req, res) => {
  const row = loadMessage(req.params.id);
  if (row.scope_type === 'channel') requireChannelAccess(row.scope_id, req.user.id, PERM.PIN_MESSAGES);
  else requireDmAccess(row.scope_id, req.user.id);
  const pinned = row.pinned ? 0 : 1;
  run('UPDATE messages SET pinned = ? WHERE id = ?', pinned, row.id);
  const message = serializeMessage(get('SELECT * FROM messages WHERE id = ?', row.id), req.user.id);
  if (row.scope_type === 'dm') toDm(row.scope_id, 'message:update', { message });
  else toChannel(row.scope_id, 'message:update', { message });
  res.json({ message });
}));

router.get('/channels/:channelId/pins', ah(async (req, res) => {
  requireChannelAccess(req.params.channelId, req.user.id, PERM.VIEW_CHANNELS);
  const rows = all(
    "SELECT * FROM messages WHERE scope_type = 'channel' AND scope_id = ? AND pinned = 1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 50",
    req.params.channelId,
  );
  res.json({ messages: serializeMessages(rows, req.user.id) });
}));

router.get('/search', ah(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });
  const scopeType = req.query.scopeType === 'dm' ? 'dm' : 'channel';
  const scopeId = String(req.query.scopeId || '');
  if (scopeId) scopeAccess(scopeType, scopeId, req.user.id, PERM.VIEW_CHANNELS);

  const like = `%${q.replace(/[%_]/g, '')}%`;
  let rows;
  if (scopeId) {
    rows = all(
      `SELECT * FROM messages WHERE scope_type = ? AND scope_id = ? AND content LIKE ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 50`,
      scopeType, scopeId, like,
    );
  } else {
    const channels = [];
    const servers = all('SELECT server_id FROM server_members WHERE user_id = ?', req.user.id);
    for (const s of servers) {
      for (const ch of all('SELECT id FROM channels WHERE server_id = ? AND type = ?', s.server_id, 'text')) {
        try {
          const ctx = requireChannelAccess(ch.id, req.user.id, PERM.VIEW_CHANNELS);
          if (ctx) channels.push(ch.id);
        } catch { /* sem acesso */ }
      }
    }
    const dms = all('SELECT dm_id FROM dm_members WHERE user_id = ?', req.user.id).map((d) => d.dm_id);
    const channelSql = channels.length ? `OR (scope_type = 'channel' AND scope_id IN (${channels.map(() => '?').join(',')}))` : '';
    const dmSql = dms.length ? `OR (scope_type = 'dm' AND scope_id IN (${dms.map(() => '?').join(',')}))` : '';
    rows = all(
      `SELECT * FROM messages WHERE content LIKE ? AND deleted_at IS NULL AND (1 = 0 ${channelSql} ${dmSql}) ORDER BY id DESC LIMIT 50`,
      like, ...channels, ...dms,
    );
  }
  res.json({ results: serializeMessages(rows, req.user.id) });
}));

router.post('/read', ah(async (req, res) => {
  const scopeType = req.body?.scopeType === 'dm' ? 'dm' : 'channel';
  const scopeId = String(req.body?.scopeId || '');
  if (!scopeId) throw bad('Escopo inválido.', 'invalid_scope');
  scopeAccess(scopeType, scopeId, req.user.id, PERM.VIEW_CHANNELS);
  const last = get(
    'SELECT MAX(id) AS id FROM messages WHERE scope_type = ? AND scope_id = ?', scopeType, scopeId,
  );
  const lastRead = Number(req.body?.lastRead || last?.id || 0);
  run('INSERT OR REPLACE INTO read_states (user_id, scope_type, scope_id, last_read) VALUES (?, ?, ?, ?)',
    req.user.id, scopeType, scopeId, lastRead);
  res.json({ ok: true, lastRead });
}));

export default router;
