import { Account, Client, Permission, Query, Realtime, Role, Storage, TablesDB } from 'appwrite';
import { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, BUCKETS, DATABASE_ID } from './config';

export const client = new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID);

export const account = new Account(client);
export const tables = new TablesDB(client);
export const storage = new Storage(client);
export const realtime = new Realtime(client);

export function ownerPermissions(userId: string): string[] {
  const role = Role.user(userId);
  return [Permission.read(role), Permission.update(role), Permission.delete(role)];
}

export async function listAllRows(tableId: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  for (;;) {
    const queries = [Query.orderDesc('$createdAt'), Query.limit(100)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const page = await tables.listRows({
      databaseId: DATABASE_ID,
      tableId,
      queries,
      total: false,
      ttl: 0,
    });
    for (const row of page.rows) rows.push(row as unknown as Record<string, unknown>);
    if (page.rows.length < 100) break;
    cursor = page.rows[page.rows.length - 1]?.$id;
    if (!cursor) break;
  }
  return rows;
}

const objectUrls = new Map<string, string>();
const audioUrls = new Map<string, string>();
const MAX_AUDIO = 3;

async function fetchPrivateBlob(bucketId: string, fileId: string): Promise<Blob> {
  const url = storage.getFileView({ bucketId, fileId });
  const headers: Record<string, string> = {
    'X-Appwrite-Project': APPWRITE_PROJECT_ID,
  };
  const fallback = window.localStorage.getItem('cookieFallback');
  if (fallback) headers['X-Fallback-Cookies'] = fallback;
  const response = await fetch(url, { headers, credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Could not load file (${response.status})`);
  }
  return response.blob();
}

export async function coverObjectUrl(fileId: string): Promise<string> {
  const cached = objectUrls.get(fileId);
  if (cached) return cached;
  const blob = await fetchPrivateBlob(BUCKETS.covers, fileId);
  const url = URL.createObjectURL(blob);
  objectUrls.set(fileId, url);
  return url;
}

export function forgetCover(fileId: string) {
  const url = objectUrls.get(fileId);
  if (!url) return;
  URL.revokeObjectURL(url);
  objectUrls.delete(fileId);
}

export async function audioObjectUrl(fileId: string): Promise<string> {
  const cached = audioUrls.get(fileId);
  if (cached) {
    audioUrls.delete(fileId);
    audioUrls.set(fileId, cached);
    return cached;
  }
  const blob = await fetchPrivateBlob(BUCKETS.audio, fileId);
  const url = URL.createObjectURL(blob);
  audioUrls.set(fileId, url);
  while (audioUrls.size > MAX_AUDIO) {
    const oldest = audioUrls.keys().next().value;
    if (!oldest || oldest === fileId) break;
    const oldUrl = audioUrls.get(oldest);
    audioUrls.delete(oldest);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
  }
  return url;
}

export { DATABASE_ID, BUCKETS, Query };
