import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { UPLOAD_DIR } from '../db.js';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'zyra';
export const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_KEY);

const EXT_BY_MIME = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg',
  'audio/webm': '.weba', 'audio/wav': '.wav', 'application/pdf': '.pdf',
  'text/plain': '.txt', 'application/zip': '.zip', 'image/svg+xml': '.svg',
};

export const ALLOWED_MIME = new Set([
  ...Object.keys(EXT_BY_MIME),
  'application/octet-stream', 'application/json', 'application/x-zip-compressed',
]);

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function extensionFor(file) {
  const fromName = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
  if (fromName && fromName.length <= 6) return fromName;
  return EXT_BY_MIME[file.mimetype] || '.bin';
}

async function storeInSupabase(buffer, key, mime) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${key}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': mime,
      'x-upsert': 'true',
    },
    body: buffer,
  });
  if (!res.ok) throw new Error(`supabase storage ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${key}`;
}

/**
 * Persist an uploaded buffer. Uses Supabase Storage when SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are configured, otherwise the local data dir.
 */
export async function storeFile(buffer, file, ownerId) {
  const id = crypto.randomUUID();
  const ext = extensionFor(file);
  const key = `u/${id}${ext}`;

  if (SUPABASE_ENABLED) {
    try {
      const url = await storeInSupabase(buffer, key, file.mimetype || 'application/octet-stream');
      return { id, url, filename: file.originalname, mime: file.mimetype, size: buffer.length };
    } catch (err) {
      console.error('[storage] supabase falhou, usando disco local:', err.message);
    }
  }

  const name = `${id}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
  return { id, url: `/uploads/${name}`, filename: file.originalname, mime: file.mimetype, size: buffer.length };
}
