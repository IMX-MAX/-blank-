import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { GET, OPTIONS } from './api/lyrics-proxy';

/** Serves the lyrics pass-through on /lyrics-proxy for `npm run dev` and `npm run preview`. */
function lyricsProxy(): Plugin {
  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/lyrics-proxy') return next();
    const request = new Request(`http://localhost${req.url}`, { method: req.method });
    const response = req.method === 'OPTIONS' ? OPTIONS() : await GET(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
  return {
    name: 'lyrics-proxy',
    configureServer: (server) => void server.middlewares.use(handle),
    configurePreviewServer: (server) => void server.middlewares.use(handle),
  };
}

export default defineConfig({
  plugins: [react(), lyricsProxy()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
});
