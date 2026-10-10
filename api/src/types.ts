export type Row = Record<string, unknown>;

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

export interface Db extends Queryable {
  tx<T>(work: (db: Queryable) => Promise<T>): Promise<T>;
}

export type FileKind = 'audio' | 'cover';

export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream<Uint8Array> | Uint8Array; contentType?: string; size?: number } | null>;
  remove(keys: string[]): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Direct-to-storage URLs. Absent for stores that can only be reached through the API. */
  presign?(method: 'GET' | 'PUT', key: string, options: { contentType?: string; expiresIn: number }): Promise<string>;
}

export type VerifyToken = (token: string) => Promise<{ userId: string; name?: string } | null>;
