import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { all, get, run, now, uid } from '../db.js';
import { ah, bad, conflict, unauthorized, tooMany } from '../lib/http.js';
import {
  createSession, destroySession, hashPassword, verifyPassword, authRequired,
} from '../lib/auth.js';
import { selfUser } from '../lib/serialize.js';
import { serverView, dmListFor, friendSummary, notificationView, unreadByScope } from '../lib/views.js';
import { notify } from '../lib/guards.js';
import { toUser } from '../lib/bus.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({
    error: { code: 'rate_limited', message: 'Muitas tentativas. Aguarde um minuto.' },
  }),
});

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

function validateRegistration({ username, email, password }) {
  if (!USERNAME_RE.test(String(username || ''))) {
    throw bad('O nome de usuário deve ter 3 a 20 caracteres (letras, números, ponto, hífen ou _).', 'invalid_username');
  }
  if (!EMAIL_RE.test(String(email || ''))) throw bad('E-mail inválido.', 'invalid_email');
  if (String(password || '').length < 8) throw bad('A senha deve ter pelo menos 8 caracteres.', 'weak_password');
  if (String(password).length > 200) throw bad('Senha muito longa.', 'weak_password');
}

export function bootstrap(userId) {
  const user = get('SELECT * FROM users WHERE id = ?', userId);
  const memberships = all(
    'SELECT server_id FROM server_members WHERE user_id = ? ORDER BY joined_at ASC', userId,
  );
  const servers = memberships.map((m) => serverView(m.server_id, userId)).filter(Boolean);
  const notifications = all(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30', userId,
  ).map(notificationView);
  return {
    user: selfUser(user),
    servers,
    dms: dmListFor(userId),
    friends: friendSummary(userId),
    notifications,
    unread: unreadByScope(userId),
  };
}

router.post('/register', authLimiter, ah(async (req, res) => {
  const { username, email, password, displayName } = req.body || {};
  validateRegistration({ username, email, password });

  const usernameLower = String(username).toLowerCase();
  const emailLower = String(email).toLowerCase().trim();
  if (get('SELECT id FROM users WHERE username_lower = ?', usernameLower)) {
    throw conflict('Este nome de usuário já está em uso.', 'username_taken');
  }
  if (get('SELECT id FROM users WHERE email_lower = ?', emailLower)) {
    throw conflict('Este e-mail já está cadastrado.', 'email_taken');
  }

  const totalUsers = get('SELECT COUNT(*) AS c FROM users').c;
  const isFirstUser = totalUsers === 0;
  const id = uid();
  const ts = now();
  const passwordHash = await hashPassword(String(password));
  run(
    `INSERT INTO users (id, username, username_lower, email, email_lower, display_name, password_hash,
      avatar_url, banner_color, bio, status, custom_status, is_admin, suspended, preferences, created_at, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, '', 'online', '', ?, 0, ?, ?, ?)`,
    id, username, usernameLower, emailLower, emailLower,
    String(displayName || username).slice(0, 40), passwordHash,
    isFirstUser ? '#6d5efc' : '#6d5efc', isFirstUser ? 1 : 0,
    JSON.stringify({ theme: 'dark', compact: false, notifications: true, sounds: true }), ts, ts,
  );

  const user = get('SELECT * FROM users WHERE id = ?', id);
  const { token } = createSession(user, req);
  if (!isFirstUser) {
    const admins = all('SELECT id FROM users WHERE is_admin = 1');
    for (const admin of admins) {
      const n = notify(admin.id, 'user_joined', { userId: id, username, displayName: user.display_name });
      toUser(admin.id, 'notification', n);
    }
  }
  res.status(201).json({ token, ...bootstrap(id), firstAdmin: isFirstUser });
}));

router.post('/login', authLimiter, ah(async (req, res) => {
  const { login, password } = req.body || {};
  const key = String(login || '').trim().toLowerCase();
  if (!key || !password) throw bad('Informe usuário/e-mail e senha.', 'missing_credentials');

  const user = get('SELECT * FROM users WHERE username_lower = ? OR email_lower = ?', key, key);
  const genericError = unauthorized('Usuário ou senha incorretos.', 'invalid_credentials');
  if (!user) throw genericError;
  const ok = await verifyPassword(String(password), user.password_hash);
  if (!ok) throw genericError;
  if (user.suspended) throw unauthorized('Conta suspensa. Fale com a administração.', 'account_suspended');

  const { token } = createSession(user, req);
  run('UPDATE users SET status = ?, last_seen = ? WHERE id = ?', 'online', now(), user.id);
  res.json({ token, ...bootstrap(user.id) });
}));

router.post('/logout', authRequired, ah(async (req, res) => {
  destroySession(req.session.id);
  res.json({ ok: true });
}));

router.get('/me', authRequired, ah(async (req, res) => {
  res.json(bootstrap(req.user.id));
}));

export default router;
