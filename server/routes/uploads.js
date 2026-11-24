import { Router } from 'express';
import multer from 'multer';
import { run, now, uid } from '../db.js';
import { ah, bad } from '../lib/http.js';
import { authRequired } from '../lib/auth.js';
import {
  ALLOWED_MIME, MAX_UPLOAD_BYTES, SUPABASE_ENABLED, storeFile,
} from '../lib/storage.js';

const router = Router();
router.use(authRequired);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

router.get('/uploads/config', ah(async (_req, res) => {
  res.json({
    supabase: SUPABASE_ENABLED,
    maxBytes: MAX_UPLOAD_BYTES,
    accepted: [...ALLOWED_MIME],
  });
}));

router.post('/uploads', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? `Arquivo maior que ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`
        : 'Falha ao ler o arquivo enviado.';
      return next(bad(message, 'upload_failed'));
    }
    next();
  });
}, ah(async (req, res) => {
  if (!req.file) throw bad('Selecione um arquivo.', 'missing_file');
  if (!ALLOWED_MIME.has(req.file.mimetype)) {
    throw bad(`Tipo de arquivo não permitido (${req.file.mimetype}).`, 'unsupported_type');
  }
  const stored = await storeFile(req.file.buffer, req.file, req.user.id);
  const id = uid();
  run('INSERT INTO uploads (id, owner_id, filename, mime, size, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, req.user.id, stored.filename, stored.mime, stored.size, stored.url, now());
  res.status(201).json({
    upload: { id, url: stored.url, filename: stored.filename, mime: stored.mime, size: stored.size },
  });
}));

export default router;
