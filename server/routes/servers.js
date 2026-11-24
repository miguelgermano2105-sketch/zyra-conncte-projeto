import { Router } from 'express';
import crypto from 'node:crypto';
import { all, get, run, now, uid, transaction } from '../db.js';
import { ah, bad, conflict, forbidden, notFound } from '../lib/http.js';
import { authRequired } from '../lib/auth.js';
import { PERM, DEFAULT_EVERYONE, has, basePerms } from '../lib/perms.js';
import {
  audit, loadChannel, memberList, notify, requireChannelAccess, requireMember, requireServerPerm,
} from '../lib/guards.js';
import { serverView } from '../lib/views.js';
import { toServer, toUser } from '../lib/bus.js';
import { userRef } from '../lib/serialize.js';

const router = Router();
router.use(authRequired);

const inviteCode = () => crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, '').slice(0, 8);

function topPosition(serverId, userId) {
  const row = get(
    `SELECT MAX(r.position) AS p FROM roles r JOIN member_roles mr ON mr.role_id = r.id
     WHERE mr.server_id = ? AND mr.user_id = ?`,
    serverId, userId,
  );
  return row?.p ?? 0;
}

function canActOn(server, actorId, targetId) {
  if (actorId === targetId) return false;
  if (server.owner_id === actorId) return true;
  if (server.owner_id === targetId) return false;
  return topPosition(server.id, actorId) > topPosition(server.id, targetId);
}

/* ----------------------------- servidores ----------------------------- */

router.get('/servers', ah(async (req, res) => {
  const rows = all('SELECT server_id FROM server_members WHERE user_id = ? ORDER BY joined_at ASC', req.user.id);
  res.json({ servers: rows.map((r) => serverView(r.server_id, req.user.id)).filter(Boolean) });
}));

router.post('/servers', ah(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (name.length < 2 || name.length > 60) throw bad('O nome do servidor deve ter 2 a 60 caracteres.', 'invalid_name');
  const iconUrl = req.body?.iconUrl ? String(req.body.iconUrl).slice(0, 500) : null;
  const description = String(req.body?.description || '').slice(0, 300);

  const serverId = uid();
  const ts = now();
  transaction(() => {
    run('INSERT INTO servers (id, name, description, icon_url, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      serverId, name, description, iconUrl, req.user.id, ts);
    run('INSERT INTO server_members (server_id, user_id, nickname, joined_at, timeout_until) VALUES (?, ?, NULL, ?, 0)',
      serverId, req.user.id, ts);
    run(`INSERT INTO roles (id, server_id, name, color, permissions, position, is_everyone, hoist, mentionable)
         VALUES (?, ?, '@everyone', '#9aa4b2', ?, 0, 1, 0, 0)`,
      uid(), serverId, DEFAULT_EVERYONE);
    run('INSERT INTO channels (id, server_id, name, type, topic, category, position, slowmode, user_limit, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?)',
      uid(), serverId, 'geral', 'text', 'Canal principal do servidor', 'Texto', ts);
    run('INSERT INTO channels (id, server_id, name, type, topic, category, position, slowmode, user_limit, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0, ?)',
      uid(), serverId, 'Voz geral', 'voice', '', 'Voz', ts);
  });
  audit(serverId, req.user.id, 'server_create', name);
  const view = serverView(serverId, req.user.id);
  toUser(req.user.id, 'server:created', { server: view });
  res.status(201).json({ server: view });
}));

router.get('/servers/:id', ah(async (req, res) => {
  const view = serverView(req.params.id, req.user.id);
  if (!view) throw forbidden('Você não é membro deste servidor.', 'not_a_member');
  res.json({ server: view, members: memberList(req.params.id) });
}));

router.patch('/servers/:id', ah(async (req, res) => {
  const { server } = requireServerPerm(req.params.id, req.user.id, PERM.MANAGE_SERVER);
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : server.name;
  if (name.length < 2 || name.length > 60) throw bad('Nome inválido.', 'invalid_name');
  const description = req.body?.description !== undefined ? String(req.body.description).slice(0, 300) : server.description;
  const iconUrl = req.body?.iconUrl !== undefined ? (req.body.iconUrl ? String(req.body.iconUrl).slice(0, 500) : null) : server.icon_url;
  run('UPDATE servers SET name = ?, description = ?, icon_url = ? WHERE id = ?', name, description, iconUrl, server.id);
  audit(server.id, req.user.id, 'server_update', name);
  const view = serverView(server.id, req.user.id);
  toServer(server.id, 'server:update', { server: view });
  res.json({ server: view });
}));

router.delete('/servers/:id', ah(async (req, res) => {
  const server = get('SELECT * FROM servers WHERE id = ?', req.params.id);
  if (!server) throw notFound('Servidor não encontrado.');
  if (server.owner_id !== req.user.id) throw forbidden('Apenas o dono pode excluir o servidor.');
  const members = all('SELECT user_id FROM server_members WHERE server_id = ?', server.id);
  run('DELETE FROM servers WHERE id = ?', server.id);
  for (const m of members) toUser(m.user_id, 'server:deleted', { serverId: server.id });
  res.json({ ok: true });
}));

router.post('/servers/:id/transfer', ah(async (req, res) => {
  const server = get('SELECT * FROM servers WHERE id = ?', req.params.id);
  if (!server) throw notFound('Servidor não encontrado.');
  if (server.owner_id !== req.user.id) throw forbidden('Apenas o dono pode transferir o servidor.');
  const targetId = String(req.body?.userId || '');
  if (!get('SELECT 1 AS x FROM server_members WHERE server_id = ? AND user_id = ?', server.id, targetId)) {
    throw bad('O novo dono precisa ser membro do servidor.', 'not_member');
  }
  run('UPDATE servers SET owner_id = ? WHERE id = ?', targetId, server.id);
  audit(server.id, req.user.id, 'server_transfer', targetId);
  toServer(server.id, 'server:update', { server: serverView(server.id, targetId) });
  res.json({ ok: true });
}));

router.post('/servers/:id/leave', ah(async (req, res) => {
  const server = get('SELECT * FROM servers WHERE id = ?', req.params.id);
  if (!server) throw notFound('Servidor não encontrado.');
  if (server.owner_id === req.user.id) {
    throw conflict('Transfira a propriedade ou exclua o servidor antes de sair.', 'owner_cannot_leave');
  }
  run('DELETE FROM server_members WHERE server_id = ? AND user_id = ?', server.id, req.user.id);
  audit(server.id, req.user.id, 'member_leave', req.user.username);
  toServer(server.id, 'member:remove', { serverId: server.id, userId: req.user.id });
  toUser(req.user.id, 'server:deleted', { serverId: server.id });
  res.json({ ok: true });
}));

/* ------------------------------ membros ------------------------------ */

router.get('/servers/:id/members', ah(async (req, res) => {
  requireMember(req.params.id, req.user.id);
  res.json({ members: memberList(req.params.id) });
}));

router.patch('/servers/:id/members/:userId', ah(async (req, res) => {
  const { server } = requireMember(req.params.id, req.user.id);
  const targetId = req.params.userId;
  if (!get('SELECT 1 AS x FROM server_members WHERE server_id = ? AND user_id = ?', server.id, targetId)) {
    throw notFound('Membro não encontrado.');
  }
  const isSelf = targetId === req.user.id;
  const ctx = basePerms(server.id, req.user.id);

  if (req.body?.nickname !== undefined) {
    if (!isSelf && !has(ctx.perms, PERM.MANAGE_ROLES)) throw forbidden('Permissão insuficiente.');
    if (isSelf && !has(ctx.perms, PERM.CHANGE_NICKNAME)) throw forbidden('Você não pode alterar seu apelido.');
    const nickname = req.body.nickname ? String(req.body.nickname).trim().slice(0, 32) : null;
    run('UPDATE server_members SET nickname = ? WHERE server_id = ? AND user_id = ?', nickname, server.id, targetId);
  }

  if (Array.isArray(req.body?.roleIds)) {
    requireServerPerm(server.id, req.user.id, PERM.MANAGE_ROLES);
    if (!canActOn(server, req.user.id, targetId) && !ctx.isOwner) {
      throw forbidden('Você não pode gerenciar cargos deste membro.');
    }
    const everyone = get('SELECT id FROM roles WHERE server_id = ? AND is_everyone = 1', server.id);
    const valid = all('SELECT id, position FROM roles WHERE server_id = ?', server.id);
    const validIds = new Set(valid.map((r) => r.id));
    const chosen = req.body.roleIds.map(String).filter((id) => validIds.has(id) && id !== everyone?.id);
    transaction(() => {
      run('DELETE FROM member_roles WHERE server_id = ? AND user_id = ?', server.id, targetId);
      for (const roleId of chosen) {
        run('INSERT INTO member_roles (user_id, role_id, server_id) VALUES (?, ?, ?)', targetId, roleId, server.id);
      }
    });
    audit(server.id, req.user.id, 'member_roles_update', targetId, { roleIds: chosen });
  }

  toServer(server.id, 'member:update', { serverId: server.id, members: memberList(server.id) });
  const members = memberList(server.id);
  res.json({ member: members.find((m) => m.id === targetId) || null });
}));

router.post('/servers/:id/members/:userId/timeout', ah(async (req, res) => {
  const { server } = requireServerPerm(req.params.id, req.user.id, PERM.TIMEOUT_MEMBERS);
  const targetId = req.params.userId;
  if (!canActOn(server, req.user.id, targetId)) throw forbidden('Você não pode silenciar este membro.');
  const minutes = Math.max(0, Math.min(40320, Number(req.body?.minutes || 0)));
  const until = minutes > 0 ? now() + minutes * 60_000 : 0;
  run('UPDATE server_members SET timeout_until = ? WHERE server_id = ? AND user_id = ?', until, server.id, targetId);
  audit(server.id, req.user.id, 'member_timeout', targetId, { minutes });
  toServer(server.id, 'member:update', { serverId: server.id, members: memberList(server.id) });
  res.json({ ok: true, timeoutUntil: until });
}));

router.delete('/servers/:id/members/:userId', ah(async (req, res) => {
  const { server } = requireServerPerm(req.params.id, req.user.id, PERM.KICK_MEMBERS);
  const targetId = req.params.userId;
  if (!canActOn(server, req.user.id, targetId)) throw forbidden('Você não pode expulsar este membro.');
  run('DELETE FROM server_members WHERE server_id = ? AND user_id = ?', server.id, targetId);
  audit(server.id, req.user.id, 'member_kick', targetId);
  toServer(server.id, 'member:remove', { serverId: server.id, userId: targetId });
  toUser(targetId, 'server:deleted', { serverId: server.id, reason: 'Você foi expulso do servidor.' });
  res.json({ ok: true });
}));

router.get('/servers/:id/bans', ah(async (req, res) => {
  requireServerPerm(req.params.id, req.user.id, PERM.BAN_MEMBERS);
  const rows = all(
    `SELECT b.*, u.username, u.display_name, u.avatar_url FROM bans b
     LEFT JOIN users u ON u.id = b.user_id WHERE b.server_id = ? ORDER BY b.created_at DESC`,
    req.params.id,
  );
  res.json({
    bans: rows.map((b) => ({
      userId: b.user_id,
      username: b.username || 'desconhecido',
      displayName: b.display_name || 'Desconhecido',
      avatarUrl: b.avatar_url || null,
      reason: b.reason,
      createdAt: b.created_at,
    })),
  });
}));

router.post('/servers/:id/bans', ah(async (req, res) => {
  const { server } = requireServerPerm(req.params.id, req.user.id, PERM.BAN_MEMBERS);
  const targetId = String(req.body?.userId || '');
  if (!get('SELECT id FROM users WHERE id = ?', targetId)) throw notFound('Usuário não encontrado.');
  if (!canActOn(server, req.user.id, targetId)) throw forbidden('Você não pode banir este usuário.');
  const reason = String(req.body?.reason || '').slice(0, 200);
  run('INSERT OR REPLACE INTO bans (server_id, user_id, reason, moderator_id, created_at) VALUES (?, ?, ?, ?, ?)',
    server.id, targetId, reason, req.user.id, now());
  run('DELETE FROM server_members WHERE server_id = ? AND user_id = ?', server.id, targetId);
  audit(server.id, req.user.id, 'member_ban', targetId, { reason });
  toServer(server.id, 'member:remove', { serverId: server.id, userId: targetId });
  toUser(targetId, 'server:deleted', { serverId: server.id, reason: 'Você foi banido do servidor.' });
  res.status(201).json({ ok: true });
}));

router.delete('/servers/:id/bans/:userId', ah(async (req, res) => {
  const { server } = requireServerPerm(req.params.id, req.user.id, PERM.BAN_MEMBERS);
  run('DELETE FROM bans WHERE server_id = ? AND user_id = ?', server.id, req.params.userId);
  audit(server.id, req.user.id, 'member_unban', req.params.userId);
  res.json({ ok: true });
}));

/* ------------------------------- cargos ------------------------------- */

router.get('/servers/:id/roles', ah(async (req, res) => {
  requireMember(req.params.id, req.user.id);
  const rows = all('SELECT * FROM roles WHERE server_id = ? ORDER BY position DESC', req.params.id);
  res.json({
    roles: rows.map((r) => ({
      id: r.id, name: r.name, color: r.color, permissions: r.permissions, position: r.position,
      isEveryone: !!r.is_everyone, hoist: !!r.hoist, mentionable: !!r.mentionable,
    })),
  });
}));

router.post('/servers/:id/roles', ah(async (req, res) => {
  const { server } = requireServerPerm(req.params.id, req.user.id, PERM.MANAGE_ROLES);
  const name = String(req.body?.name || '').trim().slice(0, 40);
  if (!name) throw bad('Informe o nome do cargo.', 'invalid_name');
  const color = /^#[0-9a-fA-F]{6}$/.test(req.body?.color || '') ? req.body.color : '#9aa4b2';
  const permissions = Math.max(0, Math.min(0x7fffffff, Number(req.body?.permissions || 0)));
  const position = Math.max(1, Math.min(500, Number(req.body?.position || 1)));
  const id = uid();
  run(`INSERT INTO roles (id, server_id, name, color, permissions, position, is_everyone, hoist, mentionable)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    id, server.id, name, color, permissions, position,
    req.body?.hoist ? 1 : 0, req.body?.mentionable === false ? 0 : 1);
  audit(server.id, req.user.id, 'role_create', name);
  const role = get('SELECT * FROM roles WHERE id = ?', id);
  toServer(server.id, 'server:update', { server: serverView(server.id, req.user.id) });
  res.status(201).json({ role: { id: role.id, name: role.name, color: role.color, permissions: role.permissions, position: role.position, isEveryone: false, hoist: !!role.hoist, mentionable: !!role.mentionable } });
}));

router.patch('/servers/:id/roles/:roleId', ah(async (req, res) => {
  const { server } = requireServerPerm(req.params.id, req.user.id, PERM.MANAGE_ROLES);
  const role = get('SELECT * FROM roles WHERE id = ? AND server_id = ?', req.params.roleId, server.id);
  if (!role) throw notFound('Cargo não encontrado.');
  const name = role.is_everyone ? role.name : (req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 40) : role.name);
  if (!name) throw bad('Nome inválido.', 'invalid_name');
  const color = /^#[0-9a-fA-F]{6}$/.test(req.body?.color || '') ? req.body.color : role.color;
  const permissions = req.body?.permissions !== undefined
    ? Math.max(0, Math.min(0x7fffffff, Number(req.body.permissions)))
    : role.permissions;
  if (!has(basePerms(server.id, req.user.id).perms, PERM.ADMIN) && (permissions & PERM.ADMIN) !== 0) {
    throw forbidden('Apenas administradores podem conceder a permissão de administrador.');
  }
  const position = role.is_everyone ? 0 : (req.body?.position !== undefined ? Math.max(1, Math.min(500, Number(req.body.position))) : role.position);
  run('UPDATE roles SET name = ?, color = ?, permissions = ?, position = ?, hoist = ?, mentionable = ? WHERE id = ?',
    name, color, permissions, position,
    req.body?.hoist !== undefined ? (req.body.hoist ? 1 : 0) : role.hoist,
    req.body?.mentionable !== undefined ? (req.body.mentionable ? 1 : 0) : role.mentionable,
    role.id);
  audit(server.id, req.user.id, 'role_update', role.id);
  toServer(server.id, 'server:update', { server: serverView(server.id, req.user.id) });
  res.json({ ok: true });
}));

router.delete('/servers/:id/roles/:roleId', ah(async (req, res) => {
  const { server } = requireServerPerm(req.params.id, req.user.id, PERM.MANAGE_ROLES);
  const role = get('SELECT * FROM roles WHERE id = ? AND server_id = ?', req.params.roleId, server.id);
  if (!role) throw notFound('Cargo não encontrado.');
  if (role.is_everyone) throw bad('O cargo @everyone não pode ser removido.', 'protected_role');
  run('DELETE FROM roles WHERE id = ?', role.id);
  audit(server.id, req.user.id, 'role_delete', role.name);
  toServer(server.id, 'server:update', { server: serverView(server.id, req.user.id) });
  res.json({ ok: true });
}));

/* ------------------------------- canais ------------------------------- */

router.post('/servers/:id/channels', ah(async (req, res) => {
  const { server } = requireServerPerm(req.params.id, req.user.id, PERM.MANAGE_CHANNELS);
  const name = String(req.body?.name || '').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40);
  if (!name) throw bad('Informe o nome do canal.', 'invalid_name');
  const type = req.body?.type === 'voice' ? 'voice' : 'text';
  const category = String(req.body?.category || (type === 'voice' ? 'Voz' : 'Texto')).slice(0, 40);
  const topic = String(req.body?.topic || '').slice(0, 200);
  const userLimit = type === 'voice' ? Math.max(0, Math.min(99, Number(req.body?.userLimit || 0))) : 0;
  const position = get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM channels WHERE server_id = ?', server.id).p;
  const id = uid();
  run('INSERT INTO channels (id, server_id, name, type, topic, category, position, slowmode, user_limit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
    id, server.id, name, type, topic, category, position, userLimit, now());
  audit(server.id, req.user.id, 'channel_create', name, { type });
  const view = serverView(server.id, req.user.id);
  toServer(server.id, 'server:update', { server: view });
  res.status(201).json({ channel: view.channels.find((c) => c.id === id) || null });
}));

router.patch('/channels/:channelId', ah(async (req, res) => {
  const channel = loadChannel(req.params.channelId);
  const { server } = requireServerPerm(channel.server_id, req.user.id, PERM.MANAGE_CHANNELS);
  const name = req.body?.name !== undefined
    ? String(req.body.name).trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40)
    : channel.name;
  if (!name) throw bad('Nome inválido.', 'invalid_name');
  const topic = req.body?.topic !== undefined ? String(req.body.topic).slice(0, 200) : channel.topic;
  const category = req.body?.category !== undefined ? String(req.body.category).slice(0, 40) : channel.category;
  const slowmode = req.body?.slowmode !== undefined ? Math.max(0, Math.min(21600, Number(req.body.slowmode))) : channel.slowmode;
  const userLimit = req.body?.userLimit !== undefined ? Math.max(0, Math.min(99, Number(req.body.userLimit))) : channel.user_limit;
  run('UPDATE channels SET name = ?, topic = ?, category = ?, slowmode = ?, user_limit = ? WHERE id = ?',
    name, topic, category, slowmode, userLimit, channel.id);
  audit(server.id, req.user.id, 'channel_update', channel.id);
  toServer(server.id, 'server:update', { server: serverView(server.id, req.user.id) });
  res.json({ ok: true });
}));

router.delete('/channels/:channelId', ah(async (req, res) => {
  const channel = loadChannel(req.params.channelId);
  const { server } = requireServerPerm(channel.server_id, req.user.id, PERM.MANAGE_CHANNELS);
  const remaining = get('SELECT COUNT(*) AS c FROM channels WHERE server_id = ?', server.id).c;
  if (remaining <= 1) throw conflict('O servidor precisa de pelo menos um canal.', 'last_channel');
  run('DELETE FROM channels WHERE id = ?', channel.id);
  audit(server.id, req.user.id, 'channel_delete', channel.name);
  toServer(server.id, 'server:update', { server: serverView(server.id, req.user.id) });
  res.json({ ok: true });
}));

router.put('/channels/:channelId/overwrites/:targetId', ah(async (req, res) => {
  const channel = loadChannel(req.params.channelId);
  const { server } = requireServerPerm(channel.server_id, req.user.id, PERM.MANAGE_ROLES);
  const targetType = req.body?.targetType === 'user' ? 'user' : 'role';
  const allow = Math.max(0, Math.min(0x7fffffff, Number(req.body?.allow || 0)));
  const deny = Math.max(0, Math.min(0x7fffffff, Number(req.body?.deny || 0)));
  run('INSERT OR REPLACE INTO channel_overwrites (channel_id, target_id, target_type, allow, deny) VALUES (?, ?, ?, ?, ?)',
    channel.id, req.params.targetId, targetType, allow, deny);
  audit(server.id, req.user.id, 'channel_overwrite', channel.id, { targetType, allow, deny });
  res.json({ ok: true });
}));

router.delete('/channels/:channelId/overwrites/:targetId', ah(async (req, res) => {
  const channel = loadChannel(req.params.channelId);
  requireServerPerm(channel.server_id, req.user.id, PERM.MANAGE_ROLES);
  run('DELETE FROM channel_overwrites WHERE channel_id = ? AND target_id = ?', channel.id, req.params.targetId);
  res.json({ ok: true });
}));

/* ------------------------------ convites ------------------------------ */

router.post('/channels/:channelId/invites', ah(async (req, res) => {
  const { channel } = requireChannelAccess(req.params.channelId, req.user.id, PERM.CREATE_INVITES);
  const maxUses = Math.max(0, Math.min(1000, Number(req.body?.maxUses || 0)));
  const hours = Math.max(0, Math.min(720, Number(req.body?.expiresInHours || 0)));
  const code = inviteCode();
  run('INSERT INTO invites (code, server_id, channel_id, inviter_id, max_uses, uses, expires_at, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
    code, channel.server_id, channel.id, req.user.id, maxUses,
    hours > 0 ? now() + hours * 3_600_000 : 0, now());
  audit(channel.server_id, req.user.id, 'invite_create', code);
  res.status(201).json({ invite: { code, maxUses, uses: 0, expiresAt: hours > 0 ? now() + hours * 3_600_000 : 0 } });
}));

router.get('/servers/:id/invites', ah(async (req, res) => {
  requireServerPerm(req.params.id, req.user.id, PERM.MANAGE_SERVER);
  const rows = all('SELECT * FROM invites WHERE server_id = ? ORDER BY created_at DESC', req.params.id);
  res.json({
    invites: rows.map((i) => ({
      code: i.code, uses: i.uses, maxUses: i.max_uses, expiresAt: i.expires_at, createdAt: i.created_at, inviterId: i.inviter_id,
    })),
  });
}));

router.delete('/invites/:code', ah(async (req, res) => {
  const invite = get('SELECT * FROM invites WHERE code = ?', req.params.code);
  if (!invite) throw notFound('Convite não encontrado.');
  requireServerPerm(invite.server_id, req.user.id, PERM.MANAGE_SERVER);
  run('DELETE FROM invites WHERE code = ?', invite.code);
  res.json({ ok: true });
}));

router.get('/invites/:code', ah(async (req, res) => {
  const invite = get('SELECT * FROM invites WHERE code = ?', req.params.code);
  if (!invite) throw notFound('Convite inválido ou expirado.', 'invalid_invite');
  if (invite.expires_at && invite.expires_at < now()) throw notFound('Convite expirado.', 'expired_invite');
  if (invite.max_uses > 0 && invite.uses >= invite.max_uses) throw notFound('Convite esgotado.', 'exhausted_invite');
  const server = get('SELECT * FROM servers WHERE id = ?', invite.server_id);
  if (!server) throw notFound('Servidor não encontrado.', 'invalid_invite');
  const inviter = get('SELECT * FROM users WHERE id = ?', invite.inviter_id);
  const memberCount = get('SELECT COUNT(*) AS c FROM server_members WHERE server_id = ?', server.id).c;
  const already = get('SELECT 1 AS x FROM server_members WHERE server_id = ? AND user_id = ?', server.id, req.user.id);
  res.json({
    invite: {
      code: invite.code,
      server: {
        id: server.id, name: server.name, description: server.description,
        iconUrl: server.icon_url || null, memberCount,
      },
      inviter: userRef(inviter),
      alreadyMember: !!already,
    },
  });
}));

router.post('/invites/:code', ah(async (req, res) => {
  const invite = get('SELECT * FROM invites WHERE code = ?', req.params.code);
  if (!invite) throw notFound('Convite inválido.', 'invalid_invite');
  if (invite.expires_at && invite.expires_at < now()) throw notFound('Convite expirado.', 'expired_invite');
  if (invite.max_uses > 0 && invite.uses >= invite.max_uses) throw notFound('Convite esgotado.', 'exhausted_invite');
  const server = get('SELECT * FROM servers WHERE id = ?', invite.server_id);
  if (!server) throw notFound('Servidor não encontrado.', 'invalid_invite');
  if (get('SELECT 1 AS x FROM bans WHERE server_id = ? AND user_id = ?', server.id, req.user.id)) {
    throw forbidden('Você está banido deste servidor.', 'banned');
  }
  const existing = get('SELECT 1 AS x FROM server_members WHERE server_id = ? AND user_id = ?', server.id, req.user.id);
  if (!existing) {
    transaction(() => {
      run('INSERT INTO server_members (server_id, user_id, nickname, joined_at, timeout_until) VALUES (?, ?, NULL, ?, 0)',
        server.id, req.user.id, now());
      run('UPDATE invites SET uses = uses + 1 WHERE code = ?', invite.code);
    });
    audit(server.id, req.user.id, 'member_join', req.user.username, { invite: invite.code });
    toServer(server.id, 'member:add', { serverId: server.id, members: memberList(server.id) });
    const ownerNote = notify(server.owner_id, 'member_joined', { serverId: server.id, serverName: server.name, user: userRef(req.user) });
    toUser(server.owner_id, 'notification', ownerNote);
  }
  res.json({ server: serverView(server.id, req.user.id) });
}));

/* --------------------------- emojis e stickers --------------------------- */

router.get('/servers/:id/emojis', ah(async (req, res) => {
  requireMember(req.params.id, req.user.id);
  const emojis = all('SELECT * FROM server_emojis WHERE server_id = ? ORDER BY name ASC', req.params.id);
  const stickers = all('SELECT * FROM stickers WHERE server_id = ? ORDER BY name ASC', req.params.id);
  res.json({
    emojis: emojis.map((e) => ({ id: e.id, name: e.name, url: e.url })),
    stickers: stickers.map((s) => ({ id: s.id, name: s.name, url: s.url })),
  });
}));

router.post('/servers/:id/emojis', ah(async (req, res) => {
  const { server } = requireServerPerm(req.params.id, req.user.id, PERM.MANAGE_EMOJIS);
  const name = String(req.body?.name || '').trim().replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32);
  const url = String(req.body?.url || '');
  if (!name) throw bad('Informe um nome para o emoji.', 'invalid_name');
  if (!/^(\/uploads\/|https?:\/\/)/.test(url)) throw bad('Envie a imagem primeiro.', 'invalid_url');
  const id = uid();
  run('INSERT INTO server_emojis (id, server_id, name, url, creator_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id, server.id, name, url, req.user.id, now());
  audit(server.id, req.user.id, 'emoji_create', name);
  res.status(201).json({ emoji: { id, name, url } });
}));

router.delete('/emojis/:emojiId', ah(async (req, res) => {
  const emoji = get('SELECT * FROM server_emojis WHERE id = ?', req.params.emojiId);
  if (!emoji) throw notFound('Emoji não encontrado.');
  requireServerPerm(emoji.server_id, req.user.id, PERM.MANAGE_EMOJIS);
  run('DELETE FROM server_emojis WHERE id = ?', emoji.id);
  res.json({ ok: true });
}));

router.post('/servers/:id/stickers', ah(async (req, res) => {
  const { server } = requireServerPerm(req.params.id, req.user.id, PERM.MANAGE_EMOJIS);
  const name = String(req.body?.name || '').trim().slice(0, 32);
  const url = String(req.body?.url || '');
  if (!name) throw bad('Informe um nome para o sticker.', 'invalid_name');
  if (!/^(\/uploads\/|https?:\/\/)/.test(url)) throw bad('Envie a imagem primeiro.', 'invalid_url');
  const id = uid();
  run('INSERT INTO stickers (id, server_id, name, url, creator_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id, server.id, name, url, req.user.id, now());
  audit(server.id, req.user.id, 'sticker_create', name);
  res.status(201).json({ sticker: { id, name, url } });
}));

router.delete('/stickers/:stickerId', ah(async (req, res) => {
  const sticker = get('SELECT * FROM stickers WHERE id = ?', req.params.stickerId);
  if (!sticker) throw notFound('Sticker não encontrado.');
  if (sticker.server_id) requireServerPerm(sticker.server_id, req.user.id, PERM.MANAGE_EMOJIS);
  run('DELETE FROM stickers WHERE id = ?', sticker.id);
  res.json({ ok: true });
}));

/* ------------------------------ auditoria ------------------------------ */

router.get('/servers/:id/audit', ah(async (req, res) => {
  requireServerPerm(req.params.id, req.user.id, PERM.VIEW_AUDIT_LOG);
  const rows = all(
    `SELECT a.*, u.username, u.display_name FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.server_id = ? ORDER BY a.id DESC LIMIT 100`,
    req.params.id,
  );
  res.json({
    entries: rows.map((r) => ({
      id: r.id,
      action: r.action,
      target: r.target,
      meta: JSON.parse(r.meta || '{}'),
      actor: r.actor_id ? { id: r.actor_id, username: r.username, displayName: r.display_name } : null,
      createdAt: r.created_at,
    })),
  });
}));

export default router;
