import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { serve } from '@hono/node-server';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from './app';
import { pgliteDb } from './pglite-db';
import { SCHEMA_SQL } from './schema';
import type { ObjectStore } from './types';

const root = join(process.cwd(), '.dev');
const port = Number(process.env.PORT ?? 8787);

function fsStore(dir: string): ObjectStore {
  const path = (key: string) => join(dir, key);
  return {
    async put(key, body, contentType) {
      await mkdir(dirname(path(key)), { recursive: true });
      await writeFile(path(key), body);
      await writeFile(`${path(key)}.type`, contentType);
    },
    async get(key) {
      try {
        const [bytes, info] = await Promise.all([readFile(path(key)), stat(path(key))]);
        const contentType = await readFile(`${path(key)}.type`, 'utf8').catch(() => undefined);
        return { body: new Uint8Array(bytes), contentType, size: info.size };
      } catch {
        return null;
      }
    },
    async exists(key) {
      return stat(path(key)).then(
        () => true,
        () => false,
      );
    },
    async remove(keys) {
      await Promise.all(keys.map((key) => Promise.all([rm(path(key), { force: true }), rm(`${path(key)}.type`, { force: true })])));
    },
  };
}

await mkdir(root, { recursive: true });
const pg = new PGlite(join(root, 'pg'));
await pg.exec(SCHEMA_SQL);

const app = createApp({
  db: pgliteDb(pg),
  store: fsStore(join(root, 'files')),
  verify: async (token) => (token.startsWith('dev:') ? { userId: token.slice(4), name: token.slice(4) } : null),
});

serve({ fetch: app.fetch, port }, () => console.log(`dev api (local PGlite, no Neon) on http://localhost:${port}`));
