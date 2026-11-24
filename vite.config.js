import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const target = `http://127.0.0.1:${process.env.PORT || 3000}`;

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: path.resolve(process.cwd(), 'dist'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': target,
      '/uploads': target,
      '/socket.io': { target, ws: true },
    },
  },
});
