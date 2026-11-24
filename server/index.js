import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { Server as SocketServer } from 'socket.io';
import { DATA_DIR, UPLOAD_DIR, get } from './db.js';
import { HttpError } from './lib/http.js';
import { SUPABASE_ENABLED } from './lib/storage.js';
import { attachRealtime } from './realtime.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import friendRoutes from './routes/friends.js';
import dmRoutes from './routes/dms.js';
import serverRoutes from './routes/servers.js';
import messageRoutes from './routes/messages.js';
import uploadRoutes from './routes/uploads.js';
import integrationRoutes from './routes/integrations.js';
import adminRoutes from './routes/admin.js';

const PORT = Number(process.env.PORT || 3000);
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; " +
    "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss: https:; " +
    "font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
  );
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'zyra-connect',
    time: Date.now(),
    storage: SUPABASE_ENABLED ? 'supabase' : 'local',
    users: get('SELECT COUNT(*) AS c FROM users WHERE is_bot = 0')?.c ?? 0,
  });
});

app.use('/api', authRoutes);
app.use('/api', userRoutes);
app.use('/api', friendRoutes);
app.use('/api', dmRoutes);
app.use('/api', serverRoutes);
app.use('/api', messageRoutes);
app.use('/api', uploadRoutes);
app.use('/api', integrationRoutes);
app.use('/api', adminRoutes);

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', fallthrough: true }));

app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'Rota de API não encontrada.' } });
});

const DIST = path.join(process.cwd(), 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, { maxAge: '1h', index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(path.join(DIST, 'index.html'));
  });
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'payload_too_large', message: 'Conteúdo muito grande.' } });
  }
  console.error('[zyra] erro inesperado:', err);
  res.status(500).json({
    error: { code: 'internal_error', message: 'Erro interno. Tente novamente.' },
  });
});

const server = http.createServer(app);
const io = new SocketServer(server, {
  maxHttpBufferSize: 1e6,
  cors: { origin: true, credentials: true },
});
attachRealtime(io);

fs.mkdirSync(DATA_DIR, { recursive: true });

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[zyra] ZYRA CONNECT ativo em http://0.0.0.0:${PORT} (storage: ${SUPABASE_ENABLED ? 'supabase' : 'local'})`);
});

const shutdown = () => {
  console.log('[zyra] encerrando...');
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
