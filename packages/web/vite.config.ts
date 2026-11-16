import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// In development the browser talks only to the Vite server (http://localhost:5173);
// /api and /ws are forwarded to the backend, so cookies and WebSockets work without CORS.
const backend = process.env.BACKEND_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/ws': { target: backend, ws: true },
    },
  },
  test: {
    environment: 'node',
  },
});
