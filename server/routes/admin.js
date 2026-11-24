import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, now, DATA_DIR } from '../db.js';
import { ah, bad, forbidden, notFound } from '../lib/http.js';
import { authRequired } from '../lib/auth.js';
import { SUPABASE_ENABLED } from '../lib/storage.js';

const router = Router();
router.use(authRequired, (req, _res, next) => {
  if (!req.user.is_admin) return next(forbidden('Acesso restrito à administração.', 'admin_only'));
  next();
});

router.get('/admin/stats', ah(async (_req, res) => {
  let dbSize = 0;
  try { dbSize = fs.statSync(path.join(DATA_DIR, 'zyra.db')).size; } catch { /* sem arquivo */ }
  const dayAgo = now() - 24 * 3_600_000;
  res.json({
    stats: {
      users: get('SELECT COUNT(*) AS c FROM users WHERE is_bot = 0').c,
      online: get('SELECT COUNT(*) AS c FROM users WHERE status != ? AND last_seen > ?', 'offline', dayAgo).c,
      servers: get('SELECT COUNT(*) AS c FROM servers').c,
      channels: get('SELECT COUNT(*) AS c FROM channels').c,
      messages: get('SELECT COUNT(*) AS c FROM messages WHERE deleted_at IS NULL').c,
      messages24h: get('SELECT COUNT(*) AS c FROM messages WHERE created_at > ? AND deleted_at IS NULL', dayAgo).c,
      dms: get('SELECT COUNT(*) AS c FROM dms').c,
      uploads: get('SELECT COUNT(*) AS c FROM uploads').c,
      uploadBytes: get('SELECT COALESCE(SUM(size), 0) AS s FROM uploads').s,
      bots: get('SELECT COUNT(*) AS c FROM bots').c,
      webhooks: get('SELECT COUNT(*) AS c FROM webhooks').c,
      suspended: get('SELECT COUNT(*) AS c FROM users WHERE suspended = 1').c,
      dbSize,
      supabase: SUPABASE_ENABLED,
      uptime: Math.round(process.uptime()),
    },
  });
}));

router.get('/admin/users', ah(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const rows = q
    ? all('SELECT * FROM users WHERE is_bot = 0 AND (username_lower LIKE ? OR email_lower LIKE ?) ORDER BY created_at DESC LIMIT 100', `%${q}%`, `%${q}%`)
    : all('SELECT * FROM users WHERE is_bot = 0 ORDER BY created_at DESC LIMIT 100');
  res.json({
    users: rows.map((u) => ({
      id: u.id, username: u.username, email: u.email, displayName: u.display_name,
      isAdmin: !!u.is_admin, suspended: !!u.suspended, status: u.status,
      createdAt: u.created_at, lastSeen: u.last_seen,
      servers: get('SELECT COUNT(*) AS c FROM server_members WHERE user_id = ?', u.id).c,
    })),
  });
}));

router.post('/admin/users/:id/suspend', ah(async (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!user) throw notFound('Usuário não encontrado.');
  if (user.id === req.user.id) throw bad('Você não pode suspender a própria conta.', 'self_action');
  const suspend = req.body?.suspend !== false;
  run('UPDATE users SET suspended = ?, token_version = token_version + 1 WHERE id = ?', suspend ? 1 : 0, user.id);
  if (suspend) run('DELETE FROM sessions WHERE user_id = ?', user.id);
  res.json({ ok: true, suspended: suspend });
}));

router.post('/admin/users/:id/admin', ah(async (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!user) throw notFound('Usuário não encontrado.');
  if (user.id === req.user.id) throw bad('Você não pode alterar seu próprio nível de acesso.', 'self_action');
  const makeAdmin = req.body?.admin !== false;
  run('UPDATE users SET is_admin = ? WHERE id = ?', makeAdmin ? 1 : 0, user.id);
  res.json({ ok: true, isAdmin: makeAdmin });
}));

router.delete('/admin/users/:id', ah(async (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!user) throw notFound('Usuário não encontrado.');
  if (user.id === req.user.id) throw bad('Você não pode excluir a própria conta por aqui.', 'self_action');
  run('DELETE FROM users WHERE id = ?', user.id);
  res.json({ ok: true });
}));

router.get('/admin/servers', ah(async (_req, res) => {
  const rows = all(
    `SELECT s.*, u.username AS owner_name,
       (SELECT COUNT(*) FROM server_members m WHERE m.server_id = s.id) AS member_count,
       (SELECT COUNT(*) FROM channels c WHERE c.server_id = s.id) AS channel_count
     FROM servers s LEFT JOIN users u ON u.id = s.owner_id ORDER BY s.created_at DESC LIMIT 100`,
  );
  res.json({
    servers: rows.map((s) => ({
      id: s.id, name: s.name, ownerName: s.owner_name, iconUrl: s.icon_url || null,
      members: s.member_count, channels: s.channel_count, createdAt: s.created_at,
    })),
  });
}));

router.delete('/admin/servers/:id', ah(async (req, res) => {
  const server = get('SELECT * FROM servers WHERE id = ?', req.params.id);
  if (!server) throw notFound('Servidor não encontrado.');
  run('DELETE FROM servers WHERE id = ?', server.id);
  res.json({ ok: true });
}));

router.get('/admin/audit', ah(async (_req, res) => {
  const rows = all(
    `SELECT a.*, u.username, s.name AS server_name FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN servers s ON s.id = a.server_id
     ORDER BY a.id DESC LIMIT 100`,
  );
  res.json({
    entries: rows.map((r) => ({
      id: r.id, action: r.action, target: r.target, meta: JSON.parse(r.meta || '{}'),
      actor: r.username || 'sistema', serverName: r.server_name || '—', createdAt: r.created_at,
    })),
  });
}));

export default router;
