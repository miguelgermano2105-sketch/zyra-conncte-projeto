import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { all, get, run, now, uid } from '../db.js';
import { ah, bad, conflict, unauthorized, tooMany } from '../lib/http.js';
import {
  createSession, destroySession, hashPassword, verifyPassword, authRequired, revokeSessions,
} from '../lib/auth.js';
import { selfUser } from '../lib/serialize.js';
import { serverView, dmListFor, friendSummary, notificationView, unreadByScope } from '../lib/views.js';
import { notify } from '../lib/guards.js';
import { toUser } from '../lib/bus.js';
import {
  EMAIL_RE, USERNAME_RE, allocateDiscriminator, ensureIdentity, findUserByIdentity, formatTag,
  padDiscriminator,
} from '../lib/identity.js';
import { issueToken, consumeToken } from '../lib/emailTokens.js';
import { sendMail, emailLayout, MAIL_CONFIGURED, MAIL_PROVIDER } from '../lib/mailer.js';
import { settingsFor } from '../lib/settings.js';
import { presenceOf, recordPresence } from '../lib/presence.js';
import { badgesOf, awardAutomatic } from '../lib/badges.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 25,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({
    error: { code: 'rate_limited', message: 'Muitas tentativas. Aguarde um minuto.' },
  }),
});

/* ---------------- proteção contra tentativas abusivas de login ---------------- */
const LOCK_WINDOW = 15 * 60 * 1000;
const MAX_FAILURES = 8;

const clientIp = (req) => String(req.ip || req.socket?.remoteAddress || '').slice(0, 60);

function failuresFor(identifier, ip) {
  const since = now() - LOCK_WINDOW;
  if (!ip) {
    return get(
      'SELECT COUNT(*) AS c FROM login_attempts WHERE success = 0 AND created_at > ? AND identifier = ?',
      since, identifier,
    ).c;
  }
  return get(
    'SELECT COUNT(*) AS c FROM login_attempts WHERE success = 0 AND created_at > ? AND (identifier = ? OR ip = ?)',
    since, identifier, ip,
  ).c;
}

function recordAttempt(identifier, ip, success) {
  run(
    'INSERT INTO login_attempts (identifier, ip, success, created_at) VALUES (?, ?, ?, ?)',
    String(identifier).slice(0, 120), ip, success ? 1 : 0, now(),
  );
  if (Math.random() < 0.05) run('DELETE FROM login_attempts WHERE created_at < ?', now() - 7 * 24 * 3_600_000);
}

const appBase = (req) => (process.env.PUBLIC_APP_URL
  || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

function validateRegistration({ username, email, password }) {
  if (!USERNAME_RE.test(String(username || ''))) {
    throw bad('O nome de usuário deve ter 3 a 20 caracteres (letras, números, ponto, hífen ou _).', 'invalid_username');
  }
  if (!EMAIL_RE.test(String(email || ''))) throw bad('E-mail inválido.', 'invalid_email');
  if (String(password || '').length < 8) throw bad('A senha deve ter pelo menos 8 caracteres.', 'weak_password');
  if (String(password).length > 200) throw bad('Senha muito longa.', 'weak_password');
}

export function bootstrap(userId) {
  const user = ensureIdentity(userId) || get('SELECT * FROM users WHERE id = ?', userId);
  const memberships = all(
    'SELECT server_id FROM server_members WHERE user_id = ? ORDER BY joined_at ASC', userId,
  );
  const servers = memberships.map((m) => serverView(m.server_id, userId)).filter(Boolean);
  const notifications = all(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30', userId,
  ).map(notificationView);
  return {
    user: selfUser(user),
    identity: {
      tag: formatTag(user.username, user.discriminator),
      discriminator: padDiscriminator(user.discriminator),
      permanentId: user.id,
    },
    settings: settingsFor(userId),
    presence: presenceOf(userId),
    badges: badgesOf(userId),
    servers,
    dms: dmListFor(userId),
    friends: friendSummary(userId),
    notifications,
    unread: unreadByScope(userId),
    mailConfigured: MAIL_CONFIGURED,
  };
}

async function sendVerification(req, user) {
  const { token, expiresAt } = issueToken(user, 'verify', user.email);
  const url = `${appBase(req)}/verificar-email?token=${encodeURIComponent(token)}`;
  const { text, html } = emailLayout(
    'Confirme seu e-mail na ZYRA CONNECT',
    ['Olá, ' + user.display_name + '!', 'Confirme seu e-mail para proteger sua conta e liberar a recuperação de senha.', 'O link expira em 24 horas.'],
    'Verificar e-mail',
    url,
  );
  const delivery = await sendMail({
    userId: user.id, to: user.email, subject: 'Confirme seu e-mail — ZYRA CONNECT', text, html, kind: 'verify', link: url,
  });
  return {
    sent: delivery.delivered,
    provider: delivery.provider,
    mailConfigured: MAIL_CONFIGURED,
    expiresAt,
    /* sem provedor de e-mail configurado o link vai apenas para o próprio dono da conta */
    devLink: MAIL_CONFIGURED ? undefined : url,
    deliveryError: delivery.delivered ? undefined : delivery.error,
  };
}

async function sendReset(req, user) {
  const { token, expiresAt } = issueToken(user, 'reset', user.email);
  const url = `${appBase(req)}/redefinir-senha?token=${encodeURIComponent(token)}`;
  const { text, html } = emailLayout(
    'Redefinição de senha — ZYRA CONNECT',
    ['Recebemos um pedido para redefinir a senha da sua conta.', 'Se não foi você, ignore esta mensagem: sua senha continua a mesma.', 'O link expira em 1 hora.'],
    'Criar nova senha',
    url,
  );
  const delivery = await sendMail({
    userId: user.id, to: user.email, subject: 'Redefinição de senha — ZYRA CONNECT', text, html, kind: 'reset', link: url,
  });
  return {
    sent: delivery.delivered,
    provider: delivery.provider,
    mailConfigured: MAIL_CONFIGURED,
    expiresAt,
    devLink: MAIL_CONFIGURED ? undefined : url,
    deliveryError: delivery.delivered ? undefined : delivery.error,
  };
}

router.get('/auth/config', ah(async (_req, res) => {
  res.json({
    mailConfigured: MAIL_CONFIGURED,
    mailProvider: MAIL_PROVIDER,
    passwordMinLength: 8,
    registrationOpen: true,
  });
}));

router.post('/register', authLimiter, ah(async (req, res) => {
  const { username, email, password, displayName } = req.body || {};
  validateRegistration({ username, email, password });

  const cleanUsername = String(username).trim();
  const usernameLower = cleanUsername.toLowerCase();
  const emailLower = String(email).toLowerCase().trim();
  if (get('SELECT id FROM users WHERE username_lower = ?', usernameLower)) {
    throw conflict('Este nome de usuário já está em uso.', 'username_taken');
  }
  if (get('SELECT id FROM users WHERE email_lower = ?', emailLower)) {
    throw conflict('Este e-mail já está cadastrado.', 'email_taken');
  }

  const totalUsers = get('SELECT COUNT(*) AS c FROM users WHERE is_bot = 0').c;
  const isFirstUser = totalUsers === 0;
  const id = uid();
  const ts = now();
  const passwordHash = await hashPassword(String(password));
  const discriminator = allocateDiscriminator(usernameLower);

  run(
    `INSERT INTO users (id, username, username_lower, email, email_lower, display_name, password_hash,
      avatar_url, banner_color, bio, status, custom_status, is_admin, suspended, preferences,
      discriminator, email_verified, email_verified_at, created_at, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, '', 'online', '', ?, 0, ?, ?, 0, NULL, ?, ?)`,
    id, cleanUsername, usernameLower, emailLower, emailLower,
    String(displayName || cleanUsername).trim().slice(0, 40) || cleanUsername, passwordHash,
    '#6d5efc', isFirstUser ? 1 : 0,
    JSON.stringify({ theme: 'dark', compact: false, notifications: true, sounds: true }),
    discriminator, ts, ts,
  );

  ensureIdentity(id);
  const user = get('SELECT * FROM users WHERE id = ?', id);
  if (isFirstUser) awardAutomatic(id, 'founder');
  if (totalUsers < 50) awardAutomatic(id, 'achievement_pioneer');
  recordPresence(id, { status: 'online' });

  const { token } = createSession(user, req);
  const verification = await sendVerification(req, user);

  if (!isFirstUser) {
    for (const admin of all('SELECT id FROM users WHERE is_admin = 1 AND id != ?', id)) {
      const n = notify(admin.id, 'user_joined', { userId: id, username: cleanUsername, displayName: user.display_name });
      toUser(admin.id, 'notification', n);
    }
  }

  res.status(201).json({
    token,
    ...bootstrap(id),
    firstAdmin: isFirstUser,
    verification,
    message: verification.sent
      ? 'Conta criada. Enviamos um link de verificação para seu e-mail.'
      : 'Conta criada. Configure o envio de e-mails para receber o link de verificação.',
  });
}));

router.post('/login', authLimiter, ah(async (req, res) => {
  const { login, password } = req.body || {};
  const identifier = String(login || '').trim();
  const ip = clientIp(req);
  if (!identifier || !password) throw bad('Informe usuário/e-mail e senha.', 'missing_credentials');

  const failures = failuresFor(identifier.toLowerCase(), ip);
  if (failures >= MAX_FAILURES) {
    throw tooMany('Muitas tentativas de login. Tente novamente em alguns minutos.', 'too_many_attempts');
  }

  const genericError = unauthorized('Usuário ou senha incorretos.', 'invalid_credentials');
  const user = findUserByIdentity(identifier);
  if (!user || user.is_bot) {
    recordAttempt(identifier.toLowerCase(), ip, false);
    throw genericError;
  }
  const ok = await verifyPassword(String(password), user.password_hash);
  if (!ok) {
    recordAttempt(identifier.toLowerCase(), ip, false);
    throw genericError;
  }
  if (user.suspended) {
    recordAttempt(identifier.toLowerCase(), ip, false);
    throw unauthorized('Conta suspensa. Fale com a administração.', 'account_suspended');
  }

  recordAttempt(identifier.toLowerCase(), ip, true);
  run('DELETE FROM login_attempts WHERE success = 0 AND identifier = ?', identifier.toLowerCase());
  ensureIdentity(user.id);
  recordPresence(user.id, { status: 'online' });
  const fresh = get('SELECT * FROM users WHERE id = ?', user.id);
  const { token } = createSession(fresh, req);
  res.json({
    token,
    ...bootstrap(user.id),
    verification: { required: !fresh.email_verified, mailConfigured: MAIL_CONFIGURED },
  });
}));

router.post('/logout', authRequired, ah(async (req, res) => {
  destroySession(req.session.id);
  recordPresence(req.user.id, { status: 'offline' });
  res.json({ ok: true });
}));

router.get('/me', authRequired, ah(async (req, res) => {
  res.json(bootstrap(req.user.id));
}));

/* ------------------------------ verificação de e-mail ------------------------------ */
router.post('/auth/verify-email', authLimiter, ah(async (req, res) => {
  const token = req.body?.token || req.query?.token;
  const row = consumeToken(token, 'verify');
  const user = get('SELECT * FROM users WHERE id = ?', row.user_id);
  if (!user) throw bad('Conta não encontrada.', 'user_not_found');
  run('UPDATE users SET email_verified = 1, email_verified_at = ? WHERE id = ?', now(), user.id);
  const updated = get('SELECT * FROM users WHERE id = ?', user.id);
  res.json({
    ok: true,
    message: 'E-mail verificado com sucesso.',
    user: selfUser(updated),
  });
}));

router.post('/auth/verify-email/resend', authRequired, authLimiter, ah(async (req, res) => {
  if (req.user.email_verified) throw bad('Seu e-mail já está verificado.', 'already_verified');
  const verification = await sendVerification(req, req.user);
  res.json({ ok: true, verification });
}));

/* ------------------------------ recuperação de senha ------------------------------ */
router.post('/auth/forgot-password', authLimiter, ah(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw bad('Informe um e-mail válido.', 'invalid_email');
  const user = get('SELECT * FROM users WHERE email_lower = ?', email);
  /* resposta sempre igual: não revela se a conta existe */
  const generic = {
    ok: true,
    mailConfigured: MAIL_CONFIGURED,
    message: 'Se este e-mail estiver cadastrado, enviaremos as instruções de recuperação.',
  };
  if (!user) return res.json(generic);
  const delivery = await sendReset(req, user);
  res.json({ ...generic, delivery: { sent: delivery.sent, provider: delivery.provider } });
}));

router.post('/auth/reset-password', authLimiter, ah(async (req, res) => {
  const { token, password } = req.body || {};
  if (String(password || '').length < 8) throw bad('A nova senha deve ter pelo menos 8 caracteres.', 'weak_password');
  if (String(password).length > 200) throw bad('Senha muito longa.', 'weak_password');
  const row = consumeToken(token, 'reset');
  const user = get('SELECT * FROM users WHERE id = ?', row.user_id);
  if (!user) throw bad('Conta não encontrada.', 'user_not_found');
  const hash = await hashPassword(String(password));
  run('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', hash, user.id);
  revokeSessions(user.id);
  res.json({ ok: true, message: 'Senha redefinida. Entre com a nova senha.' });
}));

export default router;
