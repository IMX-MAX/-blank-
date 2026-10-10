import { PGlite } from '@electric-sql/pglite';
import type { Db, Queryable } from './types';

export function pgliteDb(pg: PGlite): Db {
  const wrap = (target: Pick<PGlite, 'query'>): Queryable => ({
    query: async (sql, params) => ({ rows: (await target.query(sql, params as unknown[] | undefined)).rows as never }),
  });
  return {
    ...wrap(pg),
    tx: (work) => pg.transaction((t) => work(wrap(t))),
  };
}
