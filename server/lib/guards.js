import { all, get, run, now, jsonParse } from '../db.js';
import { forbidden, notFound } from './http.js';
import { basePerms, channelPerms, has, PERM } from './perms.js';

export function loadServer(serverId) {
  const server = get('SELECT * FROM servers WHERE id = ?', serverId);
  if (!server) throw notFound('Servidor não encontrado.');
  return server;
}

export function requireMember(serverId, userId) {
  const server = loadServer(serverId);
  const ctx = basePerms(serverId, userId);
  if (!ctx.member) throw forbidden('Você não é membro deste servidor.', 'not_a_member');
  return { server, ...ctx };
}

export function requireServerPerm(serverId, userId, perm) {
  const ctx = requireMember(serverId, userId);
  if (!has(ctx.perms, perm)) throw forbidden('Permissão insuficiente para esta ação.', 'missing_permission');
  return ctx;
}

export function loadChannel(channelId) {
  const channel = get('SELECT * FROM channels WHERE id = ?', channelId);
  if (!channel) throw notFound('Canal não encontrado.');
  return channel;
}

export function requireChannelAccess(channelId, userId, perm = PERM.VIEW_CHANNELS) {
  const channel = loadChannel(channelId);
  const ctx = channelPerms(channel, userId);
  if (!ctx.member) throw forbidden('Você não é membro deste servidor.', 'not_a_member');
  if (!has(ctx.perms, perm)) throw forbidden('Permissão insuficiente neste canal.', 'missing_permission');
  return { channel, ...ctx };
}

export function requireDmAccess(dmId, userId) {
  const dm = get('SELECT * FROM dms WHERE id = ?', dmId);
  if (!dm) throw notFound('Conversa não encontrada.');
  const membership = get('SELECT * FROM dm_members WHERE dm_id = ? AND user_id = ?', dmId, userId);
  if (!membership) throw forbidden('Você não participa desta conversa.');
  return dm;
}

export function audit(serverId, actorId, action, target = '', meta = {}) {
  run(
    'INSERT INTO audit_logs (server_id, actor_id, action, target, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    serverId, actorId, action, String(target).slice(0, 120), JSON.stringify(meta), now(),
  );
}

export function notify(userId, type, payload) {
  const res = run(
    'INSERT INTO notifications (user_id, type, payload, read, created_at) VALUES (?, ?, ?, 0, ?)',
    userId, type, JSON.stringify(payload), now(),
  );
  const row = get('SELECT * FROM notifications WHERE id = ?', res.lastInsertRowid);
  return {
    id: row.id,
    type: row.type,
    payload: jsonParse(row.payload, {}),
    read: false,
    createdAt: row.created_at,
  };
}

export function serverRoles(serverId) {
  return all('SELECT * FROM roles WHERE server_id = ? ORDER BY position DESC, name ASC', serverId);
}

export function memberList(serverId) {
  const rows = all(
    `SELECT sm.*, u.username, u.display_name, u.avatar_url, u.status, u.custom_status
     FROM server_members sm JOIN users u ON u.id = sm.user_id
     WHERE sm.server_id = ? ORDER BY u.display_name COLLATE NOCASE ASC`,
    serverId,
  );
  const roles = all(
    `SELECT mr.user_id, r.id, r.name, r.color, r.position FROM member_roles mr
     JOIN roles r ON r.id = mr.role_id WHERE mr.server_id = ?`,
    serverId,
  );
  const byUser = new Map();
  for (const r of roles) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push({ id: r.id, name: r.name, color: r.color, position: r.position });
  }
  return rows.map((m) => {
    const userRoles = (byUser.get(m.user_id) || []).sort((a, b) => b.position - a.position);
    return {
      id: m.user_id,
      username: m.username,
      displayName: m.nickname || m.display_name,
      avatarUrl: m.avatar_url || null,
      status: m.status,
      customStatus: m.custom_status,
      nickname: m.nickname || null,
      joinedAt: m.joined_at,
      timeoutUntil: m.timeout_until || 0,
      roles: userRoles,
      topRole: userRoles[0] || null,
    };
  });
}

export function serverChannels(serverId) {
  return all('SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC, name ASC', serverId);
}

export function channelView(channel, userId) {
  const ctx = channelPerms(channel, userId);
  return {
    id: channel.id,
    serverId: channel.server_id,
    name: channel.name,
    type: channel.type,
    topic: channel.topic,
    category: channel.category,
    position: channel.position,
    slowmode: channel.slowmode,
    userLimit: channel.user_limit,
    createdAt: channel.created_at,
    canView: has(ctx.perms, PERM.VIEW_CHANNELS),
    canSend: has(ctx.perms, PERM.SEND_MESSAGES),
  };
}
