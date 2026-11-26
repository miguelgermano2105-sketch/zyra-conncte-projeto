import { get, jsonParse, now, run } from '../db.js';
import { bad } from './http.js';

export const DEFAULT_SETTINGS = {
  presenceVisibility: 'everyone',
  allowFriendRequests: 'everyone',
  allowDms: 'everyone',
  showActivity: true,
  showMutualFriends: true,
  showEmail: false,
  notifications: { friendRequests: true, directMessages: true, mentions: true, sounds: true },
};

const ENUMS = {
  presenceVisibility: ['everyone', 'friends', 'nobody'],
  allowFriendRequests: ['everyone', 'nobody'],
  allowDms: ['everyone', 'friends', 'nobody'],
};

const BOOLEANS = ['showActivity', 'showMutualFriends', 'showEmail'];

export function settingsFor(userId) {
  const row = get('SELECT * FROM user_settings WHERE user_id = ?', userId);
  if (!row) return { ...DEFAULT_SETTINGS, notifications: { ...DEFAULT_SETTINGS.notifications } };
  return {
    presenceVisibility: row.presence_visibility || 'everyone',
    allowFriendRequests: row.allow_friend_requests || 'everyone',
    allowDms: row.allow_dms || 'everyone',
    showActivity: !!row.show_activity,
    showMutualFriends: !!row.show_mutual_friends,
    showEmail: !!row.show_email,
    notifications: { ...DEFAULT_SETTINGS.notifications, ...jsonParse(row.notifications, {}) },
  };
}

export function saveSettings(userId, patch = {}) {
  if (typeof patch !== 'object' || patch === null) throw bad('Configurações inválidas.', 'invalid_settings');
  const next = settingsFor(userId);
  for (const key of Object.keys(ENUMS)) {
    if (patch[key] === undefined) continue;
    if (!ENUMS[key].includes(patch[key])) throw bad('Valor de privacidade inválido.', 'invalid_settings');
    next[key] = patch[key];
  }
  for (const key of BOOLEANS) {
    if (patch[key] === undefined) continue;
    next[key] = Boolean(patch[key]);
  }
  if (patch.notifications !== undefined) {
    if (typeof patch.notifications !== 'object' || patch.notifications === null) {
      throw bad('Preferências de notificação inválidas.', 'invalid_settings');
    }
    next.notifications = { ...next.notifications, ...patch.notifications };
  }
  run(
    `INSERT OR REPLACE INTO user_settings
      (user_id, presence_visibility, allow_friend_requests, allow_dms,
       show_activity, show_mutual_friends, show_email, notifications, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId, next.presenceVisibility, next.allowFriendRequests, next.allowDms,
    next.showActivity ? 1 : 0, next.showMutualFriends ? 1 : 0, next.showEmail ? 1 : 0,
    JSON.stringify(next.notifications).slice(0, 4000), now(),
  );
  return next;
}
