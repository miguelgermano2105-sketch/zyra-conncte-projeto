import { all, get } from '../db.js';
import { publicUser } from './serialize.js';
import { presenceView } from './presence.js';
import { settingsFor } from './settings.js';
import { badgesOf } from './badges.js';

/** IDs dos amigos aceitos de um usuário. */
export function friendIdsOf(userId) {
  return all(
    `SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END AS other
       FROM friendships
      WHERE status = 'accepted' AND (user_id = ? OR friend_id = ?)`,
    userId, userId, userId,
  ).map((row) => row.other);
}

/** Amigos em comum entre dois usuários, sem duplicatas. */
export function mutualFriends(a, b) {
  if (!a || !b || a === b) return [];
  const mine = new Set(friendIdsOf(a));
  const shared = friendIdsOf(b).filter((id) => mine.has(id));
  if (!shared.length) return [];
  return all(
    `SELECT * FROM users WHERE id IN (${shared.map(() => '?').join(',')})`,
    ...shared,
  ).map((row) => ({ ...publicUser(row), presence: presenceView(row.id, a) }));
}

export function sharedServers(a, b) {
  return all(
    `SELECT s.id, s.name, s.icon_url FROM servers s
       JOIN server_members x ON x.server_id = s.id AND x.user_id = ?
       JOIN server_members y ON y.server_id = s.id AND y.user_id = ?`,
    a, b,
  ).map((s) => ({ id: s.id, name: s.name, iconUrl: s.icon_url || null }));
}

/** Estado da relação entre o visitante e o perfil consultado. */
export function friendshipState(viewerId, userId) {
  if (viewerId === userId) return { status: 'self' };
  const blockedByMe = get(
    'SELECT 1 AS ok FROM blocked_users WHERE user_id = ? AND blocked_id = ?', viewerId, userId,
  );
  if (blockedByMe) return { status: 'blocked', byMe: true };
  const blockedMe = get(
    'SELECT 1 AS ok FROM blocked_users WHERE user_id = ? AND blocked_id = ?', userId, viewerId,
  );
  if (blockedMe) return { status: 'blocked', byMe: false };
  const friend = get(
    `SELECT * FROM friendships WHERE status = 'accepted'
      AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))`,
    viewerId, userId, userId, viewerId,
  );
  if (friend) return { status: 'friends', since: friend.created_at };
  const outgoing = get(
    "SELECT * FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'",
    viewerId, userId,
  );
  if (outgoing) return { status: 'outgoing', requestId: outgoing.id, message: outgoing.message };
  const incoming = get(
    "SELECT * FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'",
    userId, viewerId,
  );
  if (incoming) return { status: 'incoming', requestId: incoming.id, message: incoming.message };
  return { status: 'none' };
}

/** Perfil completo respeitando as configurações de privacidade do dono. */
export function profileView(userId, viewerId) {
  const user = get('SELECT * FROM users WHERE id = ?', userId);
  if (!user) return null;
  const isSelf = userId === viewerId;
  const settings = settingsFor(userId);
  const row = get('SELECT * FROM profiles WHERE user_id = ?', userId);
  const presence = presenceView(userId, viewerId);
  const canSeeMutual = isSelf || settings.showMutualFriends;
  return {
    user: publicUser(user),
    identity: {
      tag: `${user.username}#${String(user.discriminator || 0).padStart(4, '0')}`,
      discriminator: String(user.discriminator || 0).padStart(4, '0'),
      permanentId: user.id,
    },
    profile: {
      bannerUrl: row?.banner_url || null,
      bannerColor: row?.banner_color || user.banner_color,
      bio: row?.bio || user.bio || '',
      pronouns: row?.pronouns || '',
      accentColor: row?.accent_color || '#8b7cf6',
      location: row?.location || '',
      website: row?.website || '',
      updatedAt: row?.updated_at || 0,
    },
    presence,
    badges: badgesOf(userId),
    createdAt: user.created_at,
    email: isSelf || settings.showEmail ? user.email : null,
    emailVerified: isSelf ? !!user.email_verified : undefined,
    friendship: friendshipState(viewerId, userId),
    mutualFriends: canSeeMutual ? mutualFriends(viewerId, userId) : [],
    mutualFriendsVisible: canSeeMutual,
    sharedServers: sharedServers(viewerId, userId),
    isSelf,
    settings: isSelf ? settings : undefined,
  };
}
