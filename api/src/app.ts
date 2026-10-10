import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Db, FileKind, ObjectStore, Queryable, Row, VerifyToken } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AUDIO_BYTES = 500 * 1024 * 1024;
const MAX_COVER_BYTES = 8 * 1024 * 1024;
const URL_TTL_SECONDS = 12 * 60 * 60;
const AUDIO_TYPES = /^(audio\/|application\/ogg$|video\/ogg$|application\/octet-stream$)/;
const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif)$/;

export interface AppDeps {
  db: Db;
  store: ObjectStore;
  verify: VerifyToken;
  origins?: string[];
}

type Env = { Variables: { userId: string } };

class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 413 | 415,
    message: string,
  ) {
    super(message);
  }
}

const isId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

function requireId(value: unknown, label: string): string {
  if (!isId(value)) throw new HttpError(400, `Invalid ${label}`);
  return value;
}

function text(value: unknown, label: string, max: number, required = true): string {
  if (typeof value !== 'string') {
    if (required) throw new HttpError(400, `${label} is required`);
    return '';
  }
  const trimmed = value.trim().slice(0, max);
  if (required && !trimmed) throw new HttpError(400, `${label} is required`);
  return trimmed;
}

function int(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export const objectKey = (ownerId: string, kind: FileKind, fileId: string) => `${ownerId}/${kind}/${fileId}`;

const folderOut = (r: Row) => ({
  id: r.id,
  createdAt: r.created_at,
  name: r.name,
});

const albumOut = (r: Row) => ({
  id: r.id,
  createdAt: r.created_at,
  name: r.name,
  artist: r.artist,
  kind: r.kind,
  coverFileId: r.cover_file_id ?? null,
  hue: r.hue ?? null,
  folderId: r.folder_id ?? null,
});

const trackOut = (r: Row) => ({
  id: r.id,
  createdAt: r.created_at,
  title: r.title,
  artist: r.artist,
  albumId: r.album_id ?? null,
  audioFileId: r.audio_file_id,
  coverFileId: r.cover_file_id ?? null,
  durationMs: r.duration_ms,
  trackNumber: r.track_number ?? null,
  year: r.year ?? null,
  hue: r.hue ?? null,
  waveform: r.waveform ?? null,
});

const linkOut = (r: Row) => ({
  id: r.id,
  playlistId: r.playlist_id,
  trackId: r.track_id,
  position: r.position,
});

async function bodyBytes(request: Request, max: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > max) throw new HttpError(413, 'That file is too large');
  const buffer = new Uint8Array(await request.arrayBuffer());
  if (buffer.byteLength === 0) throw new HttpError(400, 'Empty upload');
  if (buffer.byteLength > max) throw new HttpError(413, 'That file is too large');
  return buffer;
}

async function removeFiles(store: ObjectStore, ownerId: string, files: Array<[FileKind, unknown]>) {
  const keys = files.filter(([, id]) => isId(id)).map(([kind, id]) => objectKey(ownerId, kind, id as string));
  if (keys.length) await store.remove(keys).catch(() => undefined);
}

export function createApp({ db, store, verify, origins }: AppDeps) {
  const app = new Hono<Env>();

  app.use(
    '*',
    cors({
      origin: origins?.length ? origins : (origin) => origin || '*',
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      maxAge: 86400,
    }),
  );

  app.get('/health', (c) => c.json({ ok: true }));

  app.use('*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    const identity = token ? await verify(token).catch(() => null) : null;
    if (!identity) return c.json({ error: 'Sign in to continue' }, 401);
    c.set('userId', identity.userId);
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: 'Something went wrong' }, 500);
  });

  app.get('/library', async (c) => {
    const owner = c.get('userId');
    const [folders, albums, tracks, links] = await Promise.all([
      db.query('select * from folders where owner_id = $1 order by created_at desc', [owner]),
      db.query('select * from albums where owner_id = $1 order by created_at desc', [owner]),
      db.query('select * from tracks where owner_id = $1 order by created_at desc', [owner]),
      db.query('select * from playlist_tracks where owner_id = $1 order by playlist_id, position', [owner]),
    ]);
    return c.json({
      folders: folders.rows.map(folderOut),
      albums: albums.rows.map(albumOut),
      tracks: tracks.rows.map(trackOut),
      playlistTracks: links.rows.map(linkOut),
    });
  });

  app.post('/folders', async (c) => {
    const owner = c.get('userId');
    const body = await c.req.json().catch(() => ({}));
    const name = text(body.name, 'Name', 256);
    const { rows } = await db.query('insert into folders (owner_id, name) values ($1, $2) returning *', [owner, name]);
    return c.json(folderOut(rows[0]!), 201);
  });

  app.patch('/folders/:id', async (c) => {
    const owner = c.get('userId');
    const id = requireId(c.req.param('id'), 'folder');
    const body = await c.req.json().catch(() => ({}));
    const name = text(body.name, 'Name', 256);
    const { rows } = await db.query('update folders set name = $3 where id = $1 and owner_id = $2 returning *', [
      id,
      owner,
      name,
    ]);
    if (!rows[0]) throw new HttpError(404, 'Folder not found');
    return c.json(folderOut(rows[0]));
  });

  app.delete('/folders/:id', async (c) => {
    const owner = c.get('userId');
    const id = requireId(c.req.param('id'), 'folder');
    const { rows } = await db.query('delete from folders where id = $1 and owner_id = $2 returning id', [id, owner]);
    if (!rows[0]) throw new HttpError(404, 'Folder not found');
    return c.json({ ok: true });
  });

  async function assertFolder(q: Queryable, owner: string, folderId: unknown) {
    if (folderId === null || folderId === undefined) return null;
    const id = requireId(folderId, 'folder');
    const { rows } = await q.query('select id from folders where id = $1 and owner_id = $2', [id, owner]);
    if (!rows[0]) throw new HttpError(404, 'Folder not found');
    return id;
  }

  app.post('/albums', async (c) => {
    const owner = c.get('userId');
    const body = await c.req.json().catch(() => ({}));
    const name = text(body.name, 'Name', 256);
    const artist = text(body.artist, 'Artist', 256, false);
    const kind = body.kind === 'playlist' ? 'playlist' : 'album';
    const hue = int(body.hue, 0, 360);
    const folderId = await assertFolder(db, owner, body.folderId);
    const { rows } = await db.query(
      'insert into albums (owner_id, name, artist, kind, hue, folder_id) values ($1, $2, $3, $4, $5, $6) returning *',
      [owner, name, artist, kind, hue, folderId],
    );
    return c.json(albumOut(rows[0]!), 201);
  });

  app.patch('/albums/:id', async (c) => {
    const owner = c.get('userId');
    const id = requireId(c.req.param('id'), 'album');
    const body = await c.req.json().catch(() => ({}));
    const sets: string[] = [];
    const params: unknown[] = [id, owner];
    if ('name' in body) {
      params.push(text(body.name, 'Name', 256));
      sets.push(`name = $${params.length}`);
    }
    if ('folderId' in body) {
      params.push(await assertFolder(db, owner, body.folderId));
      sets.push(`folder_id = $${params.length}`);
    }
    if (!sets.length) throw new HttpError(400, 'Nothing to update');
    const { rows } = await db.query(
      `update albums set ${sets.join(', ')} where id = $1 and owner_id = $2 returning *`,
      params,
    );
    if (!rows[0]) throw new HttpError(404, 'Album not found');
    return c.json(albumOut(rows[0]));
  });

  app.delete('/albums/:id', async (c) => {
    const owner = c.get('userId');
    const id = requireId(c.req.param('id'), 'album');
    const files = await db.tx(async (q) => {
      const album = (await q.query('select * from albums where id = $1 and owner_id = $2 for update', [id, owner])).rows[0];
      if (!album) throw new HttpError(404, 'Album not found');
      const doomed: Array<[FileKind, unknown]> = [['cover', album.cover_file_id]];
      if (album.kind === 'album') {
        const owned = await q.query('select audio_file_id, cover_file_id from tracks where album_id = $1 and owner_id = $2', [
          id,
          owner,
        ]);
        for (const t of owned.rows) {
          doomed.push(['audio', t.audio_file_id]);
          if (t.cover_file_id && t.cover_file_id !== album.cover_file_id) doomed.push(['cover', t.cover_file_id]);
        }
      }
      await q.query('delete from albums where id = $1 and owner_id = $2', [id, owner]);
      return doomed;
    });
    await removeFiles(store, owner, files);
    return c.json({ ok: true });
  });

  app.put('/albums/:id/cover', async (c) => {
    const owner = c.get('userId');
    const id = requireId(c.req.param('id'), 'album');
    const type = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!IMAGE_TYPES.test(type)) throw new HttpError(415, 'Choose an image: jpg, png, webp, or gif');
    const existing = (await db.query('select cover_file_id from albums where id = $1 and owner_id = $2', [id, owner])).rows[0];
    if (!existing) throw new HttpError(404, 'Album not found');
    const bytes = await bodyBytes(c.req.raw, MAX_COVER_BYTES);
    const fileId = crypto.randomUUID();
    await store.put(objectKey(owner, 'cover', fileId), bytes, type);
    let row: Row | undefined;
    try {
      row = (
        await db.query('update albums set cover_file_id = $3 where id = $1 and owner_id = $2 returning *', [id, owner, fileId])
      ).rows[0];
    } catch (err) {
      await removeFiles(store, owner, [['cover', fileId]]);
      throw err;
    }
    if (!row) {
      await removeFiles(store, owner, [['cover', fileId]]);
      throw new HttpError(404, 'Album not found');
    }
    await removeFiles(store, owner, [['cover', existing.cover_file_id]]);
    return c.json(albumOut(row));
  });

  app.post('/files/audio', async (c) => {
    const owner = c.get('userId');
    const body = await c.req.json().catch(() => ({}));
    const type = text(body.contentType, 'Content type', 120, false).split(';')[0]!.trim().toLowerCase() || 'application/octet-stream';
    if (!AUDIO_TYPES.test(type)) throw new HttpError(415, 'That is not an audio file');
    const fileId = crypto.randomUUID();
    const uploadUrl = store.presign
      ? await store.presign('PUT', objectKey(owner, 'audio', fileId), { contentType: type, expiresIn: 3600 })
      : null;
    return c.json({ fileId, contentType: type, uploadUrl }, 201);
  });

  app.put('/files/audio/:id', async (c) => {
    const owner = c.get('userId');
    const fileId = requireId(c.req.param('id'), 'file');
    const type = (c.req.header('content-type') ?? 'application/octet-stream').split(';')[0]!.trim().toLowerCase();
    if (!AUDIO_TYPES.test(type)) throw new HttpError(415, 'That is not an audio file');
    const bytes = await bodyBytes(c.req.raw, MAX_AUDIO_BYTES);
    await store.put(objectKey(owner, 'audio', fileId), bytes, type);
    return c.json({ fileId, contentType: type });
  });

  app.get('/files/:kind/:id/url', async (c) => {
    const owner = c.get('userId');
    const kind = c.req.param('kind');
    if (kind !== 'audio' && kind !== 'cover') throw new HttpError(404, 'Not found');
    const id = requireId(c.req.param('id'), 'file');
    if (!store.presign) return c.json({ url: null });
    const key = objectKey(owner, kind, id);
    if (!(await store.exists(key))) throw new HttpError(404, 'Not found');
    return c.json({ url: await store.presign('GET', key, { expiresIn: URL_TTL_SECONDS }), expiresIn: URL_TTL_SECONDS });
  });

  app.get('/files/:kind/:id', async (c) => {
    const owner = c.get('userId');
    const kind = c.req.param('kind');
    if (kind !== 'audio' && kind !== 'cover') throw new HttpError(404, 'Not found');
    const id = requireId(c.req.param('id'), 'file');
    const object = await store.get(objectKey(owner, kind, id));
    if (!object) throw new HttpError(404, 'Not found');
    const headers = new Headers({
      'content-type': object.contentType ?? 'application/octet-stream',
      'cache-control': 'private, max-age=31536000, immutable',
    });
    if (object.size !== undefined) headers.set('content-length', String(object.size));
    return new Response(object.body as BodyInit, { headers });
  });

  app.post('/tracks', async (c) => {
    const owner = c.get('userId');
    const body = await c.req.json().catch(() => ({}));
    const audioFileId = requireId(body.audioFileId, 'audio file');
    const coverFileId = body.coverFileId ? requireId(body.coverFileId, 'cover file') : null;
    const albumId = body.albumId ? requireId(body.albumId, 'album') : null;
    const title = text(body.title, 'Title', 512);
    const artist = text(body.artist, 'Artist', 256, false);
    const waveform = typeof body.waveform === 'string' ? body.waveform.slice(0, 20000) : null;
    const audioType = typeof body.audioType === 'string' ? body.audioType.slice(0, 120) : 'audio/mpeg';

    if (!(await store.exists(objectKey(owner, 'audio', audioFileId)))) throw new HttpError(400, 'Upload the audio first');

    const row = await db.tx(async (q) => {
      if (albumId) {
        const album = (await q.query('select id from albums where id = $1 and owner_id = $2', [albumId, owner])).rows[0];
        if (!album) throw new HttpError(404, 'Album not found');
      }
      return (
        await q.query(
          `insert into tracks (owner_id, album_id, title, artist, audio_file_id, audio_type, cover_file_id,
                               duration_ms, track_number, year, hue, waveform)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning *`,
          [
            owner,
            albumId,
            title,
            artist,
            audioFileId,
            audioType,
            coverFileId,
            int(body.durationMs, 0, 2_147_483_000) ?? 0,
            int(body.trackNumber, 0, 100000),
            int(body.year, 0, 9999),
            int(body.hue, 0, 360),
            waveform,
          ],
        )
      ).rows[0]!;
    });
    return c.json(trackOut(row), 201);
  });

  app.delete('/tracks/:id', async (c) => {
    const owner = c.get('userId');
    const id = requireId(c.req.param('id'), 'track');
    const track = (await db.query('delete from tracks where id = $1 and owner_id = $2 returning *', [id, owner])).rows[0];
    if (!track) throw new HttpError(404, 'Track not found');
    await removeFiles(store, owner, [['audio', track.audio_file_id]]);
    return c.json({ ok: true });
  });

  app.post('/playlists/:id/tracks', async (c) => {
    const owner = c.get('userId');
    const playlistId = requireId(c.req.param('id'), 'playlist');
    const body = await c.req.json().catch(() => ({}));
    const trackIds: string[] = Array.isArray(body.trackIds) ? body.trackIds.map((v: unknown) => requireId(v, 'track')) : [];
    if (!trackIds.length) throw new HttpError(400, 'Choose at least one track');
    const created = await db.tx(async (q) => {
      const playlist = (
        await q.query("select id from albums where id = $1 and owner_id = $2 and kind = 'playlist' for update", [playlistId, owner])
      ).rows[0];
      if (!playlist) throw new HttpError(404, 'Playlist not found');
      const owned = await q.query('select id from tracks where owner_id = $1 and id = any($2::uuid[])', [owner, trackIds]);
      const allowed = new Set(owned.rows.map((r) => r.id as string));
      const next = (
        await q.query('select coalesce(max(position), -1) + 1 as next from playlist_tracks where playlist_id = $1', [playlistId])
      ).rows[0]!;
      let position = Number(next.next);
      const out: Row[] = [];
      for (const trackId of trackIds) {
        if (!allowed.has(trackId)) continue;
        const inserted = await q.query(
          `insert into playlist_tracks (owner_id, playlist_id, track_id, position) values ($1, $2, $3, $4)
           on conflict (playlist_id, track_id) do nothing returning *`,
          [owner, playlistId, trackId, position],
        );
        if (inserted.rows[0]) {
          out.push(inserted.rows[0]);
          position += 1;
        }
      }
      return out;
    });
    return c.json({ added: created.map(linkOut) }, 201);
  });

  app.delete('/playlists/:id/tracks/:trackId', async (c) => {
    const owner = c.get('userId');
    const playlistId = requireId(c.req.param('id'), 'playlist');
    const trackId = requireId(c.req.param('trackId'), 'track');
    await db.query('delete from playlist_tracks where playlist_id = $1 and track_id = $2 and owner_id = $3', [
      playlistId,
      trackId,
      owner,
    ]);
    return c.json({ ok: true });
  });

  return app;
}
