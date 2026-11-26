import sqlite from 'node-sqlite3-wasm';
const { Database } = sqlite;
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = process.env.ZYRA_DATA_DIR || path.join(process.cwd(), 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'zyra.db'));
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 4000;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  username_lower TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  email_lower TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  banner_color TEXT NOT NULL DEFAULT '#6d5efc',
  bio TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'online',
  custom_status TEXT NOT NULL DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0,
  suspended INTEGER NOT NULL DEFAULT 0,
  preferences TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS user_sessions_user ON user_sessions(user_id);

CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_url TEXT,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS server_members (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT,
  joined_at INTEGER NOT NULL,
  timeout_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (server_id, user_id)
);
CREATE INDEX IF NOT EXISTS server_members_user ON server_members(user_id);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#9aa4b2',
  permissions INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  is_everyone INTEGER NOT NULL DEFAULT 0,
  hoist INTEGER NOT NULL DEFAULT 0,
  mentionable INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS roles_server ON roles(server_id);

CREATE TABLE IF NOT EXISTS member_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  server_id TEXT NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  topic TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Geral',
  position INTEGER NOT NULL DEFAULT 0,
  slowmode INTEGER NOT NULL DEFAULT 0,
  user_limit INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS channels_server ON channels(server_id);

CREATE TABLE IF NOT EXISTS channel_overwrites (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  allow INTEGER NOT NULL DEFAULT 0,
  deny INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, target_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  attachments TEXT NOT NULL DEFAULT '[]',
  sticker_id TEXT,
  reply_to INTEGER,
  pinned INTEGER NOT NULL DEFAULT 0,
  system INTEGER NOT NULL DEFAULT 0,
  edited_at INTEGER,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_scope ON messages(scope_type, scope_id, id);
CREATE INDEX IF NOT EXISTS messages_author ON messages(author_id);

CREATE TABLE IF NOT EXISTS reactions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS dms (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'direct',
  name TEXT,
  icon_url TEXT,
  owner_id TEXT,
  created_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dm_members (
  dm_id TEXT NOT NULL REFERENCES dms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (dm_id, user_id)
);
CREATE INDEX IF NOT EXISTS dm_members_user ON dm_members(user_id);

CREATE TABLE IF NOT EXISTS friendships (
  user_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  channel_id TEXT,
  inviter_id TEXT NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 0,
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  token_hash TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS server_bots (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, bot_id)
);

CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bans (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  moderator_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, read);

CREATE TABLE IF NOT EXISTS read_states (
  user_id TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  last_read INTEGER NOT NULL,
  PRIMARY KEY (user_id, scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS server_emojis (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  creator_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stickers (
  id TEXT PRIMARY KEY,
  server_id TEXT REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  creator_id TEXT,
  created_at INTEGER NOT NULL
);

/* ------------------- etapa 02: contas, perfis e identidade ------------------- */
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  banner_url TEXT,
  banner_color TEXT NOT NULL DEFAULT '#6d5efc',
  bio TEXT NOT NULL DEFAULT '',
  pronouns TEXT NOT NULL DEFAULT '',
  accent_color TEXT NOT NULL DEFAULT '#8b7cf6',
  location TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  presence_visibility TEXT NOT NULL DEFAULT 'everyone',
  allow_friend_requests TEXT NOT NULL DEFAULT 'everyone',
  allow_dms TEXT NOT NULL DEFAULT 'everyone',
  show_activity INTEGER NOT NULL DEFAULT 1,
  show_mutual_friends INTEGER NOT NULL DEFAULT 1,
  show_email INTEGER NOT NULL DEFAULT 0,
  notifications TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_presence (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'offline',
  custom_status TEXT NOT NULL DEFAULT '',
  activity TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0,
  last_active INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS badges (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '✦',
  color TEXT NOT NULL DEFAULT '#8b7cf6',
  rarity TEXT NOT NULL DEFAULT 'common',
  criteria TEXT NOT NULL DEFAULT '',
  grantable INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id TEXT NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  granted_by TEXT,
  granted_at INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS friend_requests (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  responded_at INTEGER
);
CREATE INDEX IF NOT EXISTS friend_requests_to ON friend_requests(to_id, status);
CREATE INDEX IF NOT EXISTS friend_requests_from ON friend_requests(from_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pending ON friend_requests(from_id, to_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS blocked_users (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS email_tokens_user ON email_tokens(user_id, kind);

CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  link TEXT,
  delivered INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL DEFAULT 'outbox',
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  success INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_lookup ON login_attempts(identifier, created_at);
`;

db.exec(SCHEMA);

/* ---------- migrações incrementais ---------- */
function hasColumn(table, column) {
  return db.all(`PRAGMA table_info(${table})`).some((c) => c.name === column);
}
const MIGRATIONS = [
  ['users', 'token_version', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'is_bot', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'bot_owner_id', 'TEXT'],
  ['users', 'discriminator', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'email_verified_at', 'INTEGER'],
];
for (const [table, column, definition] of MIGRATIONS) {
  if (!hasColumn(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function hasTable(name) {
  return Boolean(db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]));
}

/* ---------- etapa 02: renomeia sessions -> user_sessions preservando dados ---------- */
if (hasTable('sessions')) {
  if (!hasTable('user_sessions')) {
    db.exec('ALTER TABLE sessions RENAME TO user_sessions');
  } else {
    db.exec(
      `INSERT OR IGNORE INTO user_sessions (id, user_id, user_agent, ip, created_at, last_seen)
       SELECT id, user_id, user_agent, ip, created_at, last_seen FROM sessions`,
    );
    db.exec('DROP TABLE sessions');
  }
}
db.exec('CREATE INDEX IF NOT EXISTS user_sessions_user ON user_sessions(user_id)');

/* ---------- etapa 02: backfill de identidade, perfil, privacidade e presença ---------- */
const metaValue = (key) => db.get('SELECT value FROM schema_meta WHERE key = ?', [key])?.value;

if (!metaValue('stage2_identity')) {
  const ts = Date.now();
  for (const row of db.all('SELECT * FROM users')) {
    if (!row.discriminator) {
      const taken = new Set(
        db.all('SELECT discriminator FROM users WHERE username_lower = ?', [row.username_lower])
          .map((r) => r.discriminator),
      );
      let candidate = 0;
      for (let i = 0; i < 60 && !candidate; i += 1) {
        const pick = 1 + Math.floor(Math.random() * 9999);
        if (!taken.has(pick)) candidate = pick;
      }
      for (let pick = 1; pick <= 9999 && !candidate; pick += 1) {
        if (!taken.has(pick)) candidate = pick;
      }
      db.run('UPDATE users SET discriminator = ? WHERE id = ?', [candidate, row.id]);
    }
    db.run(
      `INSERT OR IGNORE INTO profiles (user_id, banner_url, banner_color, bio, updated_at)
       VALUES (?, NULL, ?, ?, ?)`,
      [row.id, row.banner_color || '#6d5efc', row.bio || '', ts],
    );
    db.run('INSERT OR IGNORE INTO user_settings (user_id, updated_at) VALUES (?, ?)', [row.id, ts]);
    db.run(
      `INSERT OR IGNORE INTO user_presence (user_id, status, custom_status, activity, updated_at, last_active)
       VALUES (?, ?, ?, '', ?, ?)`,
      [row.id, row.status || 'offline', row.custom_status || '', ts, row.last_seen || ts],
    );
    /* contas anteriores à verificação de e-mail não ficam bloqueadas */
    db.run('UPDATE users SET email_verified = 1, email_verified_at = ? WHERE id = ? AND email_verified = 0', [ts, row.id]);
  }
  db.run('INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)', ['stage2_identity', String(ts)]);
}

db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_tag ON users(username_lower, discriminator)');

/* ---------- etapa 02: catálogo oficial de insígnias ZYRA ---------- */
const BADGE_SEED = [
  ['founder', 'Fundador', 'Criou a ZYRA CONNECT e ajudou a definir a plataforma.', '👑', '#a855f7', 'legendary', 'Concedida à primeira conta da plataforma e a fundadores autorizados.', 0],
  ['developer', 'Desenvolvedor', 'Contribui com código, infraestrutura ou integrações da ZYRA.', '🛠️', '#38bdf8', 'epic', 'Concedida pela administração a quem contribui tecnicamente.', 1],
  ['verified', 'Verificado', 'Identidade confirmada pela equipe ZYRA.', '✅', '#22c55e', 'rare', 'Concedida após análise da equipe de moderação.', 1],
  ['moderator', 'Moderador', 'Cuida da segurança e da boa convivência nas comunidades.', '🛡️', '#f59e0b', 'epic', 'Concedida a moderadores ativos da plataforma.', 1],
  ['supporter', 'Apoiador', 'Ajuda a comunidade com suporte, guias e acolhimento.', '💜', '#ec4899', 'rare', 'Concedida a quem apoia a comunidade de forma consistente.', 1],
  ['event_aurora', 'Evento Aurora', 'Participou do evento de lançamento Aurora.', '🌌', '#8b5cf6', 'rare', 'Concedida durante eventos oficiais da ZYRA.', 1],
  ['achievement_pioneer', 'Pioneiro', 'Uma das primeiras contas da ZYRA CONNECT.', '🚀', '#06b6d4', 'epic', 'Automática para as primeiras contas criadas na plataforma.', 0],
  ['achievement_community', 'Coração da Comunidade', 'Criou servidores ativos e reuniu pessoas.', '💠', '#f472b6', 'rare', 'Concedida a quem constrói comunidades ativas.', 1],
];
for (const [id, name, description, icon, color, rarity, criteria, grantable] of BADGE_SEED) {
  db.run(
    `INSERT OR IGNORE INTO badges (id, name, description, icon, color, rarity, criteria, grantable, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, description, icon, color, rarity, criteria, grantable, Date.now()],
  );
}

/* ---------- query helpers ---------- */
export const all = (sql, ...params) => db.all(sql, params);
export const get = (sql, ...params) => db.get(sql, params);
export const run = (sql, ...params) => db.run(sql, params);
export const now = () => Date.now();
export const uid = () => crypto.randomUUID();
export const shortId = (n = 10) => crypto.randomBytes(n).toString('base64url').slice(0, n);

export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

export const jsonParse = (value, fallback) => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};
