import { Router } from 'express';
import { all, get, run, now, uid } from '../db.js';
import { ah, bad, forbidden, notFound } from '../lib/http.js';
import { authRequired } from '../lib/auth.js';
import { requireDmAccess } from '../lib/guards.js';
import { dmListFor, dmView } from '../lib/views.js';
import { toUser } from '../lib/bus.js';

const router = Router();
router.use(authRequired);

router.get('/dms', ah(async (req, res) => {
  res.json({ dms: dmListFor(req.user.id) });
}));

router.post('/dms', ah(async (req, res) => {
  const recipientId = String(req.body?.recipientId || '');
  if (!recipientId) throw bad('Informe o destinatário.', 'missing_recipient');
  if (recipientId === req.user.id) throw bad('Escolha outra pessoa.', 'self_dm');
  if (!get('SELECT id FROM users WHERE id = ?', recipientId)) throw notFound('Usuário não encontrado.');

  const existing = get(
    `SELECT d.* FROM dms d
     JOIN dm_members a ON a.dm_id = d.id AND a.user_id = ?
     JOIN dm_members b ON b.dm_id = d.id AND b.user_id = ?
     WHERE d.type = 'direct'
       AND (SELECT COUNT(*) FROM dm_members m WHERE m.dm_id = d.id) = 2
     LIMIT 1`,
    req.user.id, recipientId,
  );
  if (existing) return res.json({ dm: dmView(existing, req.user.id) });

  const id = uid();
  const ts = now();
  run('INSERT INTO dms (id, type, name, icon_url, owner_id, created_at, last_message_at) VALUES (?, ?, NULL, NULL, ?, ?, 0)',
    id, 'direct', req.user.id, ts);
  run('INSERT INTO dm_members (dm_id, user_id, joined_at) VALUES (?, ?, ?)', id, req.user.id, ts);
  run('INSERT INTO dm_members (dm_id, user_id, joined_at) VALUES (?, ?, ?)', id, recipientId, ts);

  const dm = get('SELECT * FROM dms WHERE id = ?', id);
  const view = dmView(dm, req.user.id);
  toUser(recipientId, 'dm:create', { dm: dmView(dm, recipientId) });
  res.status(201).json({ dm: view });
}));

router.post('/dms/group', ah(async (req, res) => {
  const name = String(req.body?.name || 'Novo grupo').trim().slice(0, 60);
  const memberIds = Array.isArray(req.body?.memberIds) ? [...new Set(req.body.memberIds.map(String))] : [];
  const others = memberIds.filter((id) => id !== req.user.id);
  if (others.length < 1) throw bad('Selecione pelo menos uma pessoa.', 'missing_members');
  for (const id of others) {
    if (!get('SELECT id FROM users WHERE id = ?', id)) throw notFound('Um dos usuários não existe.', 'user_not_found');
  }
  const id = uid();
  const ts = now();
  run('INSERT INTO dms (id, type, name, icon_url, owner_id, created_at, last_message_at) VALUES (?, ?, ?, NULL, ?, ?, 0)',
    id, 'group', name, req.user.id, ts);
  for (const userId of [req.user.id, ...others]) {
    run('INSERT INTO dm_members (dm_id, user_id, joined_at) VALUES (?, ?, ?)', id, userId, ts);
  }
  const dm = get('SELECT * FROM dms WHERE id = ?', id);
  for (const userId of [req.user.id, ...others]) {
    if (userId !== req.user.id) toUser(userId, 'dm:create', { dm: dmView(dm, userId) });
  }
  res.status(201).json({ dm: dmView(dm, req.user.id) });
}));

router.patch('/dms/:id', ah(async (req, res) => {
  const dm = requireDmAccess(req.params.id, req.user.id);
  if (dm.type !== 'group') throw bad('Apenas grupos podem ser editados.', 'not_group');
  if (dm.owner_id !== req.user.id) throw forbidden('Apenas o criador do grupo pode editá-lo.');
  const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 60) : dm.name;
  const iconUrl = req.body?.iconUrl !== undefined ? String(req.body.iconUrl).slice(0, 500) : dm.icon_url;
  run('UPDATE dms SET name = ?, icon_url = ? WHERE id = ?', name, iconUrl, dm.id);
  const updated = get('SELECT * FROM dms WHERE id = ?', dm.id);
  const members = all('SELECT user_id FROM dm_members WHERE dm_id = ?', dm.id);
  for (const m of members) toUser(m.user_id, 'dm:update', { dm: dmView(updated, m.user_id) });
  res.json({ dm: dmView(updated, req.user.id) });
}));

router.post('/dms/:id/members', ah(async (req, res) => {
  const dm = requireDmAccess(req.params.id, req.user.id);
  if (dm.type !== 'group') throw bad('Converta em grupo primeiro.', 'not_group');
  const userId = String(req.body?.userId || '');
  if (!get('SELECT id FROM users WHERE id = ?', userId)) throw notFound('Usuário não encontrado.');
  if (get('SELECT 1 AS x FROM dm_members WHERE dm_id = ? AND user_id = ?', dm.id, userId)) {
    return res.json({ dm: dmView(dm, req.user.id) });
  }
  run('INSERT INTO dm_members (dm_id, user_id, joined_at) VALUES (?, ?, ?)', dm.id, userId, now());
  const members = all('SELECT user_id FROM dm_members WHERE dm_id = ?', dm.id);
  for (const m of members) toUser(m.user_id, 'dm:update', { dm: dmView(dm, m.user_id) });
  res.json({ dm: dmView(dm, req.user.id) });
}));

router.delete('/dms/:id/members/:userId', ah(async (req, res) => {
  const dm = requireDmAccess(req.params.id, req.user.id);
  const target = req.params.userId;
  if (target !== req.user.id && dm.owner_id !== req.user.id) {
    throw forbidden('Apenas o criador do grupo pode remover participantes.');
  }
  run('DELETE FROM dm_members WHERE dm_id = ? AND user_id = ?', dm.id, target);
  toUser(target, 'dm:remove', { dmId: dm.id });
  res.json({ ok: true });
}));

export default router;
