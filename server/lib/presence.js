import { get, now, run } from '../db.js';
import { settingsFor } from './settings.js';

export const PRESENCE_STATES = ['online', 'idle', 'dnd', 'invisible', 'offline'];
export const SELECTABLE_STATES = ['online', 'idle', 'dnd', 'invisible'];

export function recordPresence(userId, patch = {}) {
  const ts = now();
  const row = get('SELECT * FROM user_presence WHERE user_id = ?', userId);
  const status = SELECTABLE_STATES.includes(patch.status)
    ? patch.status
    : (row?.status || 'offline');
  const customStatus = patch.customStatus !== undefined
    ? String(patch.customStatus).slice(0, 80)
    : (row?.custom_status || '');
  const activity = patch.activity !== undefined
    ? String(patch.activity).slice(0, 80)
    : (row?.activity || '');
  run(
    `INSERT OR REPLACE INTO user_presence (user_id, status, custom_status, activity, updated_at, last_active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    userId, status, customStatus, activity, ts, ts,
  );
  run('UPDATE users SET status = ?, custom_status = ?, last_seen = ? WHERE id = ?',
    status, customStatus, ts, userId);
  return { status, customStatus, activity, updatedAt: ts, lastActive: ts };
}

export function presenceOf(userId) {
  const row = get('SELECT * FROM user_presence WHERE user_id = ?', userId);
  if (row) {
    return {
      status: row.status,
      customStatus: row.custom_status,
      activity: row.activity,
      updatedAt: row.updated_at,
      lastActive: row.last_active,
    };
  }
  const user = get('SELECT status, custom_status, last_seen FROM users WHERE id = ?', userId);
  return {
    status: user?.status || 'offline',
    customStatus: user?.custom_status || '',
    activity: '',
    updatedAt: user?.last_seen || 0,
    lastActive: user?.last_seen || 0,
  };
}

export function areFriends(a, b) {
  if (!a || !b) return false;
  return Boolean(get(
    `SELECT 1 AS ok FROM friendships WHERE status = 'accepted'
      AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))`,
    a, b, b, a,
  ));
}

/** Presença respeitando privacidade: invisível e "ninguém" aparecem offline. */
export function presenceView(userId, viewerId) {
  const presence = presenceOf(userId);
  if (!viewerId || viewerId === userId) return presence;
  const settings = settingsFor(userId);
  const visible = settings.presenceVisibility === 'everyone'
    || (settings.presenceVisibility === 'friends' && areFriends(userId, viewerId));
  const status = visible && presence.status !== 'invisible' ? presence.status : 'offline';
  return {
    ...presence,
    status,
    customStatus: visible ? presence.customStatus : '',
    activity: visible && settings.showActivity ? presence.activity : '',
  };
}
