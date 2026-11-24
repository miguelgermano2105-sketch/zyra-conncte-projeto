import { Router } from 'express';
import { all, get, run, now, jsonParse } from '../db.js';
import { ah, bad, conflict, notFound, unauthorized } from '../lib/http.js';
import { authRequired, hashPassword, verifyPassword } from '../lib/auth.js';
import { publicUser, selfUser, userRef } from '../lib/serialize.js';
import { notificationView } from '../lib/views.js';

const router = Router();
router.use(authRequired);

const STATUSES = new Set(['online', 'idle', 'dnd', 'invisible']);

router.get('/users/me', ah(async (req, res) => {
  res.json({ user: selfUser(req.user) });
}));

router.patch('/users/me', ah(async (req, res) => {
  const body = req.body || {};
  const fields = [];
  const values = [];
  const set = (sql, value) => { fields.push(sql); values.push(value); };

  if (body.displayName !== undefined) {
    const name = String(body.displayName).trim();
    if (name.length < 1 || name.length > 40) throw bad('O nome de exibição deve ter 1 a 40 caracteres.', 'invalid_display_name');
    set('display_name = ?', name);
  }
  if (body.bio !== undefined) {
    const bio = String(body.bio);
    if (bio.length > 300) throw bad('A bio deve ter no máximo 300 caracteres.', 'invalid_bio');
    set('bio = ?', bio);
  }
  if (body.avatarUrl !== undefined) {
    const url = body.avatarUrl ? String(body.avatarUrl) : null;
    if (url && url.length > 500) throw bad('URL de avatar inválida.', 'invalid_avatar');
    if (url && !/^(\/uploads\/|https?:\/\/)/.test(url)) throw bad('URL de avatar inválida.', 'invalid_avatar');
    set('avatar_url = ?', url);
  }
  if (body.bannerColor !== undefined) {
    const color = String(body.bannerColor);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw bad('Cor inválida.', 'invalid_color');
    set('banner_color = ?', color);
  }
  if (body.status !== undefined) {
    const status = String(body.status);
    if (!STATUSES.has(status)) throw bad('Status inválido.', 'invalid_status');
    set('status = ?', status);
  }
  if (body.customStatus !== undefined) {
    set('custom_status = ?', String(body.customStatus).slice(0, 80));
  }
  if (body.preferences !== undefined) {
    const prefs = body.preferences;
    if (typeof prefs !== 'object' || prefs === null) throw bad('Preferências inválidas.', 'invalid_preferences');
    set('preferences = ?', JSON.stringify(prefs).slice(0, 4000));
  }

  if (fields.length) {
    values.push(req.user.id);
    run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, ...values);
  }
  const user = get('SELECT * FROM users WHERE id = ?', req.user.id);
  res.json({ user: selfUser(user) });
}));

router.put('/users/me/password', ah(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) throw bad('Informe a senha atual e a nova senha.', 'missing_password');
  if (String(newPassword).length < 8) throw bad('A nova senha deve ter pelo menos 8 caracteres.', 'weak_password');
  const ok = await verifyPassword(String(currentPassword), req.user.password_hash);
  if (!ok) throw unauthorized('Senha atual incorreta.', 'invalid_password');

  const hash = await hashPassword(String(newPassword));
  run(
    'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?',
    hash, req.user.id,
  );
  run('DELETE FROM sessions WHERE user_id = ? AND id != ?', req.user.id, req.session.id);
  res.json({ ok: true, message: 'Senha alterada. Outras sessões foram encerradas.' });
}));

router.get('/users/me/sessions', ah(async (req, res) => {
  const rows = all('SELECT * FROM sessions WHERE user_id = ? ORDER BY last_seen DESC', req.user.id);
  res.json({
    sessions: rows.map((s) => ({
      id: s.id,
      current: s.id === req.session.id,
      userAgent: s.user_agent,
      ip: s.ip,
      createdAt: s.created_at,
      lastSeen: s.last_seen,
    })),
  });
}));

router.delete('/users/me/sessions/:id', ah(async (req, res) => {
  run('DELETE FROM sessions WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  res.json({ ok: true });
}));

router.delete('/users/me/sessions', ah(async (req, res) => {
  run('DELETE FROM sessions WHERE user_id = ? AND id != ?', req.user.id, req.session.id);
  res.json({ ok: true });
}));

router.delete('/users/me', ah(async (req, res) => {
  const { password } = req.body || {};
  const ok = await verifyPassword(String(password || ''), req.user.password_hash);
  if (!ok) throw unauthorized('Senha incorreta.', 'invalid_password');
  const owned = get('SELECT COUNT(*) AS c FROM servers WHERE owner_id = ?', req.user.id).c;
  if (owned > 0) {
    throw conflict('Transfira ou exclua os servidores que você possui antes de apagar a conta.', 'owns_servers');
  }
  run('DELETE FROM users WHERE id = ?', req.user.id);
  res.json({ ok: true });
}));

router.get('/users/search', ah(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json({ users: [] });
  const rows = all(
    'SELECT * FROM users WHERE (username_lower LIKE ? OR lower(display_name) LIKE ?) AND id != ? LIMIT 12',
    `%${q}%`, `%${q}%`, req.user.id,
  );
  res.json({ users: rows.map(publicUser) });
}));

router.get('/users/:id', ah(async (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!user) throw notFound('Usuário não encontrado.');
  const sharedServers = all(
    `SELECT s.id, s.name, s.icon_url FROM servers s
     JOIN server_members a ON a.server_id = s.id AND a.user_id = ?
     JOIN server_members b ON b.server_id = s.id AND b.user_id = ?`,
    req.user.id, user.id,
  ).map((s) => ({ id: s.id, name: s.name, iconUrl: s.icon_url || null }));
  const friendship = get(
    `SELECT * FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
    req.user.id, user.id, user.id, req.user.id,
  );
  res.json({
    user: publicUser(user),
    sharedServers,
    friendship: friendship
      ? { status: friendship.status, incoming: friendship.friend_id === req.user.id, requestedBy: friendship.user_id }
      : null,
  });
}));

router.get('/notifications', ah(async (req, res) => {
  const rows = all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', req.user.id);
  res.json({ notifications: rows.map(notificationView) });
}));

router.post('/notifications/read', ah(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : null;
  if (ids && ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    run(`UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (${placeholders})`, req.user.id, ...ids);
  } else {
    run('UPDATE notifications SET read = 1 WHERE user_id = ?', req.user.id);
  }
  res.json({ ok: true });
}));

router.delete('/notifications/:id', ah(async (req, res) => {
  run('DELETE FROM notifications WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  res.json({ ok: true });
}));

export default router;
