import { all, get, now, run } from '../db.js';
import { bad, notFound } from './http.js';

const view = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  icon: row.icon,
  color: row.color,
  rarity: row.rarity,
  criteria: row.criteria,
  grantable: !!row.grantable,
  grantedAt: row.granted_at ?? null,
  note: row.note || '',
});

export function badgeCatalog() {
  return all('SELECT * FROM badges ORDER BY rarity ASC, name ASC').map(view);
}

export function badgesOf(userId) {
  return all(
    `SELECT b.*, ub.granted_at, ub.note FROM user_badges ub
      JOIN badges b ON b.id = ub.badge_id
      WHERE ub.user_id = ?
      ORDER BY b.rarity ASC, b.name ASC`,
    userId,
  ).map(view);
}

/** Concessão auditada: somente chamada por rotas administrativas. */
export function grantBadge(userId, badgeId, grantedBy, note = '') {
  if (!get('SELECT id FROM users WHERE id = ?', userId)) throw notFound('Usuário não encontrado.');
  const badge = get('SELECT * FROM badges WHERE id = ?', String(badgeId || ''));
  if (!badge) throw notFound('Insígnia não encontrada.', 'badge_not_found');
  if (!badge.grantable) {
    throw bad('Esta insígnia é automática e não pode ser concedida manualmente.', 'badge_not_grantable');
  }
  run(
    `INSERT OR REPLACE INTO user_badges (user_id, badge_id, granted_by, granted_at, note)
     VALUES (?, ?, ?, ?, ?)`,
    userId, badge.id, grantedBy, now(), String(note || '').slice(0, 200),
  );
  return badgesOf(userId);
}

export function revokeBadge(userId, badgeId) {
  const badge = get('SELECT * FROM badges WHERE id = ?', String(badgeId || ''));
  if (!badge) throw notFound('Insígnia não encontrada.', 'badge_not_found');
  if (!badge.grantable) {
    throw bad('Insígnias automáticas não podem ser removidas manualmente.', 'badge_not_grantable');
  }
  run('DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?', userId, badge.id);
  return badgesOf(userId);
}

export function hasBadge(userId, badgeId) {
  return Boolean(get('SELECT 1 AS ok FROM user_badges WHERE user_id = ? AND badge_id = ?', userId, badgeId));
}

export function awardAutomatic(userId, badgeId) {
  const badge = get('SELECT * FROM badges WHERE id = ?', badgeId);
  if (!badge || badge.grantable) return false;
  run(
    `INSERT OR IGNORE INTO user_badges (user_id, badge_id, granted_by, granted_at, note)
     VALUES (?, ?, NULL, ?, 'Concessão automática')`,
    userId, badgeId, now(),
  );
  return true;
}
