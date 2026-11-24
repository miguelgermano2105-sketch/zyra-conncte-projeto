import { all, get, jsonParse } from '../db.js';
import { basePerms, channelView, memberList, serverChannels, serverRoles } from './guards.js';
import { userRef } from './serialize.js';

export function serverView(serverId, userId) {
  const server = get('SELECT * FROM servers WHERE id = ?', serverId);
  if (!server) return null;
  const ctx = basePerms(serverId, userId);
  if (!ctx.member) return null;
  const channels = serverChannels(serverId).map((c) => channelView(c, userId)).filter((c) => c.canView);
  const roles = serverRoles(serverId).map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    permissions: r.permissions,
    position: r.position,
    isEveryone: !!r.is_everyone,
    hoist: !!r.hoist,
    mentionable: !!r.mentionable,
  }));
  const myRoleIds = all(
    'SELECT role_id FROM member_roles WHERE server_id = ? AND user_id = ?', serverId, userId,
  ).map((r) => r.role_id);
  const memberCount = get('SELECT COUNT(*) AS c FROM server_members WHERE server_id = ?', serverId).c;
  return {
    id: server.id,
    name: server.name,
    description: server.description,
    iconUrl: server.icon_url || null,
    ownerId: server.owner_id,
    createdAt: server.created_at,
    channels,
    roles,
    myRoleIds,
    myPermissions: ctx.perms,
    isOwner: ctx.isOwner,
    nickname: ctx.member.nickname || null,
    timeoutUntil: ctx.member.timeout_until || 0,
    memberCount,
  };
}

export function dmMembers(dmId) {
  return all(
    `SELECT u.* FROM dm_members dm JOIN users u ON u.id = dm.user_id WHERE dm.dm_id = ?`,
    dmId,
  ).map(userRef);
}

export function dmView(dm, viewerId) {
  const members = dmMembers(dm.id);
  const last = get(
    'SELECT m.*, u.display_name FROM messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.scope_type = ? AND m.scope_id = ? AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT 1',
    'dm', dm.id,
  );
  const read = get(
    'SELECT last_read FROM read_states WHERE user_id = ? AND scope_type = ? AND scope_id = ?',
    viewerId, 'dm', dm.id,
  );
  const lastRead = read?.last_read || 0;
  const unread = get(
    'SELECT COUNT(*) AS c FROM messages WHERE scope_type = ? AND scope_id = ? AND id > ? AND author_id != ? AND deleted_at IS NULL',
    'dm', dm.id, lastRead, viewerId,
  ).c;
  const other = members.find((m) => m.id !== viewerId) || null;
  return {
    id: dm.id,
    type: dm.type,
    name: dm.type === 'group' ? dm.name || 'Grupo' : other?.displayName || 'Conversa',
    iconUrl: dm.icon_url || (dm.type === 'direct' ? other?.avatarUrl || null : null),
    ownerId: dm.owner_id,
    members,
    lastMessage: last
      ? { id: last.id, content: last.content, createdAt: last.created_at, authorName: last.display_name || '' }
      : null,
    lastRead,
    unread,
    lastMessageAt: dm.last_message_at || 0,
    createdAt: dm.created_at,
  };
}

export function dmListFor(userId) {
  const rows = all(
    `SELECT d.* FROM dms d JOIN dm_members m ON m.dm_id = d.id WHERE m.user_id = ? ORDER BY d.last_message_at DESC, d.created_at DESC`,
    userId,
  );
  return rows.map((d) => dmView(d, userId));
}

export function friendSummary(userId) {
  const accepted = get(
    `SELECT COUNT(*) AS c FROM friendships WHERE status = 'accepted' AND (user_id = ? OR friend_id = ?)`,
    userId, userId,
  ).c;
  const incoming = get(
    `SELECT COUNT(*) AS c FROM friendships WHERE status = 'pending' AND friend_id = ?`, userId,
  ).c;
  return { friends: accepted, incoming };
}

export function unreadByScope(userId) {
  const states = new Map(
    all('SELECT scope_type, scope_id, last_read FROM read_states WHERE user_id = ?', userId)
      .map((r) => [`${r.scope_type}:${r.scope_id}`, r.last_read]),
  );
  const out = {};
  for (const dm of dmListFor(userId)) out[`dm:${dm.id}`] = dm.unread;

  const servers = all('SELECT server_id FROM server_members WHERE user_id = ?', userId);
  for (const { server_id: serverId } of servers) {
    for (const ch of all('SELECT id FROM channels WHERE server_id = ? AND type = ?', serverId, 'text')) {
      const last = states.get(`channel:${ch.id}`) || 0;
      const c = get(
        `SELECT COUNT(*) AS c FROM messages WHERE scope_type = 'channel' AND scope_id = ? AND id > ? AND author_id != ? AND deleted_at IS NULL`,
        ch.id, last, userId,
      ).c;
      if (c > 0) out[`channel:${ch.id}`] = c;
    }
  }
  return out;
}

export function notificationView(row) {
  return {
    id: row.id,
    type: row.type,
    payload: jsonParse(row.payload, {}),
    read: !!row.read,
    createdAt: row.created_at,
  };
}

export function membersOf(serverId) {
  return memberList(serverId);
}
