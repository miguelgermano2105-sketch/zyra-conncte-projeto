import { all, get, now, run } from '../db.js';
import { conflict } from './http.js';

/** Identificação no formato antigo do Discord: username#0000 */
export const MAX_DISCRIMINATOR = 9999;
export const USERNAME_RE = /^[a-zA-Z0-9._-]{3,20}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

export const padDiscriminator = (value) => String(Number(value) || 0).padStart(4, '0');
export const formatTag = (username, discriminator) => `${username}#${padDiscriminator(discriminator)}`;

/** Sorteia um identificador numérico livre para o username, verificando duplicidade no banco. */
export function allocateDiscriminator(usernameLower) {
  const taken = new Set(
    all('SELECT discriminator FROM users WHERE username_lower = ?', usernameLower)
      .map((row) => Number(row.discriminator) || 0),
  );
  for (let i = 0; i < 40; i += 1) {
    const pick = 1 + Math.floor(Math.random() * MAX_DISCRIMINATOR);
    if (!taken.has(pick)) return pick;
  }
  for (let pick = 1; pick <= MAX_DISCRIMINATOR; pick += 1) {
    if (!taken.has(pick)) return pick;
  }
  throw conflict('Não há identificadores livres para este username.', 'discriminator_exhausted');
}

/** Aceita "silva#4821", "silva", "@silva", e-mail ou ID interno permanente. */
export function parseIdentity(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const tagged = value.match(/^@?([^#\s]{1,32})#(\d{1,4})$/);
  if (tagged) {
    return { username: tagged[1], discriminator: Number(tagged[2]), email: null, id: null };
  }
  if (EMAIL_RE.test(value)) return { email: value.toLowerCase(), username: null, discriminator: null, id: null };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return { id: value, username: null, discriminator: null, email: null };
  }
  return { username: value.replace(/^@/, ''), discriminator: null, email: null, id: null };
}

export function findUserByIdentity(raw) {
  const parsed = parseIdentity(raw);
  if (!parsed) return null;
  if (parsed.id) return get('SELECT * FROM users WHERE id = ?', parsed.id) || null;
  if (parsed.email) return get('SELECT * FROM users WHERE email_lower = ?', parsed.email) || null;
  const usernameLower = String(parsed.username).toLowerCase();
  if (parsed.discriminator !== null) {
    return get(
      'SELECT * FROM users WHERE username_lower = ? AND discriminator = ?',
      usernameLower, parsed.discriminator,
    ) || null;
  }
  return get('SELECT * FROM users WHERE username_lower = ? LIMIT 1', usernameLower) || null;
}

/** Garante que a conta tem identificador, perfil, privacidade e presença registrados. */
export function ensureIdentity(userId) {
  const user = get('SELECT * FROM users WHERE id = ?', userId);
  if (!user) return null;
  const ts = now();
  if (!user.discriminator) {
    const discriminator = allocateDiscriminator(user.username_lower);
    run('UPDATE users SET discriminator = ? WHERE id = ?', discriminator, userId);
    user.discriminator = discriminator;
  }
  run(
    `INSERT OR IGNORE INTO profiles (user_id, banner_url, banner_color, bio, updated_at)
     VALUES (?, NULL, ?, ?, ?)`,
    userId, user.banner_color || '#6d5efc', user.bio || '', ts,
  );
  run('INSERT OR IGNORE INTO user_settings (user_id, updated_at) VALUES (?, ?)', userId, ts);
  run(
    `INSERT OR IGNORE INTO user_presence (user_id, status, custom_status, activity, updated_at, last_active)
     VALUES (?, ?, ?, '', ?, ?)`,
    userId, user.status || 'offline', user.custom_status || '', ts, user.last_seen || ts,
  );
  return get('SELECT * FROM users WHERE id = ?', userId);
}

export function identityOf(row) {
  if (!row) return null;
  const discriminator = Number(row.discriminator) || 0;
  return {
    username: row.username,
    discriminator,
    tag: formatTag(row.username, discriminator),
  };
}

/** Procura contas por username, username#tag, ID permanente ou trecho do nome de exibição. */
export function searchIdentities(viewerId, rawQuery, limit = 12) {
  const query = String(rawQuery || '').trim();
  if (query.length < 2) return [];
  const exact = findUserByIdentity(query);
  const like = `%${query.replace(/^@/, '').replace(/#\d*$/, '').toLowerCase()}%`;
  const rows = all(
    `SELECT * FROM users
     WHERE is_bot = 0 AND id != ? AND (
       username_lower LIKE ? OR lower(display_name) LIKE ? OR id = ? OR email_lower = ?
     )
     ORDER BY (id = ?) DESC, username_lower ASC
     LIMIT ?`,
    viewerId, like, like, query, query.toLowerCase(), exact?.id || '', limit,
  );
  if (exact && exact.id !== viewerId && !rows.some((row) => row.id === exact.id)) rows.unshift(exact);
  return rows;
}
