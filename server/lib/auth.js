import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, get, run, uid, now } from '../db.js';
import { unauthorized, forbidden } from './http.js';

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, '.jwt-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export const JWT_SECRET = loadSecret();
const TOKEN_TTL = '30d';

export const hashPassword = (pw) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw, hash) => bcrypt.compare(pw, hash);

export function createSession(user, req) {
  const sid = uid();
  const ts = now();
  run(
    'INSERT INTO user_sessions (id, user_id, user_agent, ip, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)',
    sid, user.id, String(req.headers['user-agent'] || '').slice(0, 200),
    String(req.ip || '').slice(0, 60), ts, ts,
  );
  const token = jwt.sign({ sub: user.id, sid, ver: user.token_version || 0 }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
  return { token, sid };
}

export function destroySession(sid) {
  if (sid) run('DELETE FROM user_sessions WHERE id = ?', sid);
}

/** Encerra todas as sessões do usuário, opcionalmente preservando a atual. */
export function revokeSessions(userId, exceptSid = null) {
  if (exceptSid) run('DELETE FROM user_sessions WHERE user_id = ? AND id != ?', userId, exceptSid);
  else run('DELETE FROM user_sessions WHERE user_id = ?', userId);
}

export function userFromToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    throw unauthorized('Sessão inválida ou expirada.');
  }
  const session = get('SELECT * FROM user_sessions WHERE id = ?', payload.sid);
  if (!session || session.user_id !== payload.sub) throw unauthorized('Sessão encerrada.');
  const user = get('SELECT * FROM users WHERE id = ?', payload.sub);
  if (!user) throw unauthorized('Conta não encontrada.');
  if (user.suspended) throw forbidden('Conta suspensa. Fale com a administração.', 'account_suspended');
  if ((user.token_version || 0) !== (payload.ver || 0)) throw unauthorized('Sessão revogada.');
  return { user, session };
}

export function bearer(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  if (req.query && typeof req.query.token === 'string') return req.query.token;
  return null;
}

/** Express middleware: requires a valid user session. */
export function authRequired(req, _res, next) {
  try {
    const token = bearer(req);
    if (!token) throw unauthorized('Faça login para continuar.');
    const { user, session } = userFromToken(token);
    req.user = user;
    req.session = session;
    const ts = now();
    if (ts - session.last_seen > 60_000) {
      run('UPDATE user_sessions SET last_seen = ? WHERE id = ?', ts, session.id);
      run('UPDATE users SET last_seen = ? WHERE id = ?', ts, user.id);
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function adminRequired(req, _res, next) {
  if (!req.user?.is_admin) return next(forbidden('Acesso restrito à administração.'));
  next();
}

/* ---------------- bot tokens ---------------- */
export const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

export function createBotToken(botId) {
  const secret = crypto.randomBytes(24).toString('base64url');
  return { raw: `zyra.${botId}.${secret}`, hash: hashToken(`zyra.${botId}.${secret}`) };
}

export function botFromRequest(req) {
  const header = req.headers.authorization || '';
  const raw = header.startsWith('Bot ') ? header.slice(4).trim() : null;
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== 'zyra') return null;
  const bot = get('SELECT * FROM bots WHERE id = ?', parts[1]);
  if (!bot || bot.token_hash !== hashToken(raw)) return null;
  return bot;
}
