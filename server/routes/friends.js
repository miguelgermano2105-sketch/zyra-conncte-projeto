import { Router } from 'express';
import { all, get, run, now } from '../db.js';
import { ah, bad, conflict, notFound } from '../lib/http.js';
import { authRequired } from '../lib/auth.js';
import { publicUser, userRef } from '../lib/serialize.js';
import { notify } from '../lib/guards.js';
import { toUser } from '../lib/bus.js';

const router = Router();
router.use(authRequired);

const findUserByName = (username) => get('SELECT * FROM users WHERE username_lower = ?', String(username || '').trim().toLowerCase());

function relation(a, b) {
  return get(
    `SELECT * FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
    a, b, b, a,
  );
}

router.get('/friends', ah(async (req, res) => {
  const me = req.user.id;
  const rows = all(
    `SELECT f.*, u.id AS other_id FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
     WHERE f.user_id = ? OR f.friend_id = ?`,
    me, me, me,
  );
  const friends = [];
  const incoming = [];
  const outgoing = [];
  const blocked = [];
  for (const row of rows) {
    const other = get('SELECT * FROM users WHERE id = ?', row.other_id);
    if (!other) continue;
    const item = { user: publicUser(other), since: row.created_at, direction: row.user_id === me ? 'out' : 'in' };
    if (row.status === 'accepted') friends.push(item);
    else if (row.status === 'blocked') { if (row.user_id === me) blocked.push(item); }
    else if (row.user_id === me) outgoing.push(item);
    else incoming.push(item);
  }
  friends.sort((a, b) => a.user.displayName.localeCompare(b.user.displayName));
  res.json({ friends, incoming, outgoing, blocked });
}));

router.post('/friends/request', ah(async (req, res) => {
  const target = findUserByName(req.body?.username);
  if (!target) throw notFound('Nenhum usuário com esse nome.', 'user_not_found');
  if (target.id === req.user.id) throw bad('Você não pode adicionar você mesmo.', 'self_request');

  const existing = relation(req.user.id, target.id);
  if (existing) {
    if (existing.status === 'accepted') throw conflict('Vocês já são amigos.', 'already_friends');
    if (existing.status === 'blocked') throw conflict('Não é possível enviar solicitação para este usuário.', 'blocked');
    if (existing.user_id === target.id) {
      run('UPDATE friendships SET status = ? WHERE user_id = ? AND friend_id = ?', 'accepted', target.id, req.user.id);
      const n = notify(target.id, 'friend_accepted', { user: userRef(req.user) });
      toUser(target.id, 'notification', n);
      toUser(target.id, 'friends:changed', {});
      toUser(req.user.id, 'friends:changed', {});
      return res.json({ ok: true, status: 'accepted' });
    }
    throw conflict('Solicitação já enviada.', 'request_pending');
  }

  run(
    'INSERT INTO friendships (user_id, friend_id, status, created_at) VALUES (?, ?, ?, ?)',
    req.user.id, target.id, 'pending', now(),
  );
  const n = notify(target.id, 'friend_request', { user: userRef(req.user) });
  toUser(target.id, 'notification', n);
  toUser(target.id, 'friends:changed', {});
  res.status(201).json({ ok: true, status: 'pending' });
}));

router.post('/friends/accept', ah(async (req, res) => {
  const userId = String(req.body?.userId || '');
  const row = get('SELECT * FROM friendships WHERE user_id = ? AND friend_id = ? AND status = ?', userId, req.user.id, 'pending');
  if (!row) throw notFound('Solicitação não encontrada.', 'request_not_found');
  run('UPDATE friendships SET status = ? WHERE user_id = ? AND friend_id = ?', 'accepted', userId, req.user.id);
  const n = notify(userId, 'friend_accepted', { user: userRef(req.user) });
  toUser(userId, 'notification', n);
  toUser(userId, 'friends:changed', {});
  toUser(req.user.id, 'friends:changed', {});
  res.json({ ok: true });
}));

router.post('/friends/decline', ah(async (req, res) => {
  const userId = String(req.body?.userId || '');
  run('DELETE FROM friendships WHERE user_id = ? AND friend_id = ? AND status = ?', userId, req.user.id, 'pending');
  toUser(userId, 'friends:changed', {});
  toUser(req.user.id, 'friends:changed', {});
  res.json({ ok: true });
}));

router.delete('/friends/:userId', ah(async (req, res) => {
  const other = req.params.userId;
  run(
    `DELETE FROM friendships WHERE status != 'blocked' AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))`,
    req.user.id, other, other, req.user.id,
  );
  toUser(other, 'friends:changed', {});
  toUser(req.user.id, 'friends:changed', {});
  res.json({ ok: true });
}));

router.post('/friends/block', ah(async (req, res) => {
  const userId = String(req.body?.userId || '');
  if (userId === req.user.id) throw bad('Ação inválida.', 'self_block');
  if (!get('SELECT id FROM users WHERE id = ?', userId)) throw notFound('Usuário não encontrado.');
  run('DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)', req.user.id, userId, userId, req.user.id);
  run('INSERT INTO friendships (user_id, friend_id, status, created_at) VALUES (?, ?, ?, ?)', req.user.id, userId, 'blocked', now());
  toUser(req.user.id, 'friends:changed', {});
  res.json({ ok: true });
}));

router.delete('/friends/block/:userId', ah(async (req, res) => {
  run('DELETE FROM friendships WHERE user_id = ? AND friend_id = ? AND status = ?', req.user.id, req.params.userId, 'blocked');
  toUser(req.user.id, 'friends:changed', {});
  res.json({ ok: true });
}));

export default router;
