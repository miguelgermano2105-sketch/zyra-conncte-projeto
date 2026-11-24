import { all, get } from '../db.js';

export const PERM = {
  ADMIN: 1 << 0,
  MANAGE_SERVER: 1 << 1,
  MANAGE_CHANNELS: 1 << 2,
  MANAGE_ROLES: 1 << 3,
  KICK_MEMBERS: 1 << 4,
  BAN_MEMBERS: 1 << 5,
  TIMEOUT_MEMBERS: 1 << 6,
  MANAGE_MESSAGES: 1 << 7,
  SEND_MESSAGES: 1 << 8,
  VIEW_CHANNELS: 1 << 9,
  ATTACH_FILES: 1 << 10,
  ADD_REACTIONS: 1 << 11,
  MENTION_EVERYONE: 1 << 12,
  MANAGE_WEBHOOKS: 1 << 13,
  CREATE_INVITES: 1 << 14,
  VOICE_CONNECT: 1 << 15,
  VOICE_SPEAK: 1 << 16,
  VIEW_AUDIT_LOG: 1 << 17,
  MANAGE_BOTS: 1 << 18,
  PIN_MESSAGES: 1 << 19,
  CHANGE_NICKNAME: 1 << 20,
  MANAGE_EMOJIS: 1 << 21,
};

export const PERM_LABELS = {
  ADMIN: 'Administrador',
  MANAGE_SERVER: 'Gerenciar servidor',
  MANAGE_CHANNELS: 'Gerenciar canais',
  MANAGE_ROLES: 'Gerenciar cargos',
  KICK_MEMBERS: 'Expulsar membros',
  BAN_MEMBERS: 'Banir membros',
  TIMEOUT_MEMBERS: 'Silenciar membros',
  MANAGE_MESSAGES: 'Gerenciar mensagens',
  SEND_MESSAGES: 'Enviar mensagens',
  VIEW_CHANNELS: 'Ver canais',
  ATTACH_FILES: 'Anexar arquivos',
  ADD_REACTIONS: 'Adicionar reações',
  MENTION_EVERYONE: 'Mencionar @everyone',
  MANAGE_WEBHOOKS: 'Gerenciar webhooks',
  CREATE_INVITES: 'Criar convites',
  VOICE_CONNECT: 'Conectar em voz',
  VOICE_SPEAK: 'Falar',
  VIEW_AUDIT_LOG: 'Ver registro de auditoria',
  MANAGE_BOTS: 'Gerenciar bots',
  PIN_MESSAGES: 'Fixar mensagens',
  CHANGE_NICKNAME: 'Alterar apelido',
  MANAGE_EMOJIS: 'Gerenciar emojis/stickers',
};

export const ALL_PERMS = Object.values(PERM).reduce((a, b) => a | b, 0);

export const DEFAULT_EVERYONE =
  PERM.VIEW_CHANNELS | PERM.SEND_MESSAGES | PERM.ATTACH_FILES | PERM.ADD_REACTIONS |
  PERM.CREATE_INVITES | PERM.VOICE_CONNECT | PERM.VOICE_SPEAK | PERM.CHANGE_NICKNAME |
  PERM.PIN_MESSAGES;

export const has = (perms, flag) => (perms & PERM.ADMIN) !== 0 || (perms & flag) === flag;

export function getMember(serverId, userId) {
  return get('SELECT * FROM server_members WHERE server_id = ? AND user_id = ?', serverId, userId);
}

export function isMember(serverId, userId) {
  return !!getMember(serverId, userId);
}

/** Base permissions for a user in a server (role OR, plus owner/admin override). */
export function basePerms(serverId, userId) {
  const server = get('SELECT * FROM servers WHERE id = ?', serverId);
  if (!server) return { perms: 0, isOwner: false, member: null, server: null };
  const member = getMember(serverId, userId);
  if (!member) return { perms: 0, isOwner: false, member: null, server };
  const isOwner = server.owner_id === userId;
  if (isOwner) return { perms: ALL_PERMS, isOwner, member, server };

  let perms = 0;
  const rows = all(
    `SELECT r.permissions FROM roles r
     JOIN member_roles mr ON mr.role_id = r.id
     WHERE mr.server_id = ? AND mr.user_id = ?`,
    serverId, userId,
  );
  const everyone = get('SELECT * FROM roles WHERE server_id = ? AND is_everyone = 1', serverId);
  if (everyone) perms |= everyone.permissions;
  for (const row of rows) perms |= row.permissions;
  return { perms, isOwner, member, server };
}

/** Permissions after applying channel overwrites. */
export function channelPerms(channel, userId) {
  const base = basePerms(channel.server_id, userId);
  if (!base.member) return { perms: 0, ...base };
  if ((base.perms & PERM.ADMIN) !== 0) return { perms: ALL_PERMS, ...base };

  let perms = base.perms;
  const overwrites = all('SELECT * FROM channel_overwrites WHERE channel_id = ?', channel.id);
  const roleIds = new Set(
    all('SELECT role_id FROM member_roles WHERE server_id = ? AND user_id = ?', channel.server_id, userId)
      .map((r) => r.role_id),
  );
  const everyone = get('SELECT id FROM roles WHERE server_id = ? AND is_everyone = 1', channel.server_id);
  if (everyone) roleIds.add(everyone.id);

  const apply = (ow) => {
    perms &= ~ow.deny;
    perms |= ow.allow;
  };
  for (const ow of overwrites) {
    if (ow.target_type === 'role' && roleIds.has(ow.target_id)) apply(ow);
  }
  for (const ow of overwrites) {
    if (ow.target_type === 'user' && ow.target_id === userId) apply(ow);
  }
  return { perms, ...base };
}

export function roleIdsOf(serverId, userId) {
  return all('SELECT role_id FROM member_roles WHERE server_id = ? AND user_id = ?', serverId, userId)
    .map((r) => r.role_id);
}

/** Highest role colour/position for display. */
export function topRole(serverId, userId) {
  return get(
    `SELECT r.* FROM roles r JOIN member_roles mr ON mr.role_id = r.id
     WHERE mr.server_id = ? AND mr.user_id = ? AND r.is_everyone = 0
     ORDER BY r.position DESC LIMIT 1`,
    serverId, userId,
  ) || null;
}
