import crypto from 'node:crypto';
import { get, now, run } from '../db.js';
import { bad } from './http.js';

export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;

const digest = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

/** Cria um token de uso único; o valor bruto nunca é gravado no banco. */
export function issueToken(user, kind, email) {
  const raw = crypto.randomBytes(32).toString('base64url');
  const ts = now();
  const ttl = kind === 'reset' ? RESET_TTL_MS : VERIFY_TTL_MS;
  run('DELETE FROM email_tokens WHERE user_id = ? AND kind = ?', user.id, kind);
  run(
    `INSERT INTO email_tokens (token_hash, user_id, kind, email, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    digest(raw), user.id, kind, email || user.email, ts + ttl, ts,
  );
  return { token: raw, expiresAt: ts + ttl };
}

export function consumeToken(raw, kind) {
  const token = String(raw || '').trim();
  if (!token) throw bad('Token ausente.', 'missing_token');
  const row = get('SELECT * FROM email_tokens WHERE token_hash = ? AND kind = ?', digest(token), kind);
  if (!row) throw bad('Link inválido ou já utilizado.', 'invalid_token');
  if (row.used_at) throw bad('Este link já foi utilizado.', 'token_used');
  if (row.expires_at < now()) throw bad('Link expirado. Solicite um novo.', 'token_expired');
  run('UPDATE email_tokens SET used_at = ? WHERE token_hash = ?', now(), row.token_hash);
  return row;
}

export function purgeExpiredTokens() {
  run('DELETE FROM email_tokens WHERE expires_at < ?', now() - 24 * 60 * 60 * 1000);
}
