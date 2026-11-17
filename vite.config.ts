import type { ClientRequest, IncomingMessage } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Dev-only fetch of googlevideo audio. The phone app calls YouTube directly. */
function youtubeMediaProxy(): Plugin {
  return {
    name: 'youtube-media-proxy',
    configureServer(server) {
      server.middlewares.use('/gvideo', async (req, res) => {
        try {
          const target = new URL(req.url ?? '', 'http://localhost').searchParams.get('u');
          if (!target || !/^https:\/\/([a-z0-9.-]+\.)?googlevideo\.com\//.test(target)) {
            res.statusCode = 400;
            res.end('Unsupported media host');
            return;
          }
          const upstream = await fetch(target, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
          });
          res.statusCode = upstream.status;
          const type = upstream.headers.get('content-type');
          if (type) res.setHeader('content-type', type);
          res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch {
          res.statusCode = 502;
          res.end('Media proxy failed');
        }
      });
    },
  };
}

function forwardYouTube(targetOrigin: string) {
  return (proxy: { on: (event: 'proxyReq', handler: (proxyReq: ClientRequest, req: IncomingMessage) => void) => void }) => {
    proxy.on('proxyReq', (proxyReq, req) => {
      for (const header of ['origin', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform']) {
        proxyReq.removeHeader(header);
      }
      const ua = req.headers['x-blank-ua'];
      proxyReq.setHeader(
        'User-Agent',
        typeof ua === 'string' ? ua : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      );
      proxyReq.setHeader('Origin', targetOrigin);
      proxyReq.setHeader('Referer', `${targetOrigin}/`);
    });
  };
}

export default defineConfig({
  plugins: [react(), youtubeMediaProxy()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/ytmusic': {
        target: 'https://music.youtube.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ytmusic/, ''),
        configure: forwardYouTube('https://music.youtube.com'),
      },
      '/yt': {
        target: 'https://www.youtube.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/yt/, ''),
        configure: forwardYouTube('https://www.youtube.com'),
      },
    },
  },
});
