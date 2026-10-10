import { attachDatabasePool } from '@neon/functions';
import { Pool } from 'pg';
import { createApp } from './app';
import { jwksVerifier } from './auth';
import { pgDb } from './pg-db';
import { SCHEMA_SQL } from './schema';
import { s3Store } from './stores';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const pool = new Pool({ connectionString: required('DATABASE_URL'), max: 5 });
attachDatabasePool(pool);

const db = pgDb(pool);
let ready: Promise<unknown> | null = null;
const ensureSchema = () => (ready ??= pool.query(SCHEMA_SQL).catch((err) => {
  ready = null;
  throw err;
}));

const app = createApp({
  db: { ...db, query: async (sql, params) => (await ensureSchema(), db.query(sql, params)), tx: async (work) => (await ensureSchema(), db.tx(work)) },
  store: s3Store(process.env.UPLOADS_BUCKET ?? 'uploads'),
  verify: jwksVerifier(required('NEON_AUTH_JWKS_URL')),
});

export default app;
