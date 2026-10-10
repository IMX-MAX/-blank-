import type { Pool } from 'pg';
import type { Db, Queryable } from './types';

export function pgDb(pool: Pool): Db {
  return {
    query: (sql, params) => pool.query(sql, params as unknown[] | undefined).then((r) => ({ rows: r.rows })),
    async tx<T>(work: (q: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await work({
          query: (sql, params) => client.query(sql, params as unknown[] | undefined).then((r) => ({ rows: r.rows })),
        });
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
