import type { Album, Folder, PlaylistTrack, Track } from '../types';

type Library = { folders: Folder[]; albums: Album[]; tracks: Track[]; playlistTracks: PlaylistTrack[] };
type StoredFile = { id: string; kind: 'audio' | 'cover'; blob: Blob };
type Link = PlaylistTrack;

const DB = 'blank-local';
const STORES = ['folders', 'albums', 'tracks', 'links', 'files'] as const;
type StoreName = (typeof STORES)[number];

let opened: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  void navigator.storage?.persist?.().catch(() => undefined);
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      for (const name of STORES) request.result.createObjectStore(name, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opened = null;
      reject(request.error);
    };
  });
  return opened;
}

const wrap = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

async function transact<T>(names: StoreName[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await open();
  const tx = db.transaction(names, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Storage failed'));
  });
  try {
    const result = await work(tx);
    await done;
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* already finished */
    }
    done.catch(() => undefined);
    throw error;
  }
}

const getAll = <T>(tx: IDBTransaction, name: StoreName) => wrap(tx.objectStore(name).getAll() as IDBRequest<T[]>);
const get = <T>(tx: IDBTransaction, name: StoreName, id: string) => wrap(tx.objectStore(name).get(id) as IDBRequest<T | undefined>);
const put = (tx: IDBTransaction, name: StoreName, value: unknown) => wrap(tx.objectStore(name).put(value));
const remove = (tx: IDBTransaction, name: StoreName, id: string) => wrap(tx.objectStore(name).delete(id));

const newest = <T extends { createdAt: string }>(items: T[]) =>
  [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

const now = () => new Date().toISOString();
const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function required(value: unknown, label: string, max: number) {
  const text = clean(value, max);
  if (!text) throw new Error(`${label} is required`);
  return text;
}

export async function localLibrary(): Promise<Library> {
  return transact(['folders', 'albums', 'tracks', 'links'], 'readonly', async (tx) => {
    const [folders, albums, tracks, links] = await Promise.all([
      getAll<Folder>(tx, 'folders'),
      getAll<Album>(tx, 'albums'),
      getAll<Track>(tx, 'tracks'),
      getAll<Link>(tx, 'links'),
    ]);
    return {
      folders: newest(folders),
      albums: newest(albums),
      tracks: newest(tracks),
      playlistTracks: links.sort((a, b) => (a.playlistId === b.playlistId ? a.position - b.position : a.playlistId < b.playlistId ? -1 : 1)),
    };
  });
}

export async function localCreateFolder(name: string): Promise<Folder> {
  const folder: Folder = { id: crypto.randomUUID(), createdAt: now(), name: required(name, 'Name', 256) };
  await transact(['folders'], 'readwrite', (tx) => put(tx, 'folders', folder));
  return folder;
}

export async function localRenameFolder(id: string, name: string): Promise<Folder> {
  return transact(['folders'], 'readwrite', async (tx) => {
    const folder = await get<Folder>(tx, 'folders', id);
    if (!folder) throw new Error('Folder not found');
    const next = { ...folder, name: required(name, 'Name', 256) };
    await put(tx, 'folders', next);
    return next;
  });
}

export async function localDeleteFolder(id: string): Promise<void> {
  await transact(['folders', 'albums'], 'readwrite', async (tx) => {
    if (!(await get<Folder>(tx, 'folders', id))) throw new Error('Folder not found');
    for (const album of await getAll<Album>(tx, 'albums')) {
      if (album.folderId === id) await put(tx, 'albums', { ...album, folderId: null });
    }
    await remove(tx, 'folders', id);
  });
}

export async function localCreateAlbum(input: {
  name: string;
  artist: string;
  kind: Album['kind'];
  hue?: number;
  folderId?: string | null;
}): Promise<Album> {
  return transact(['folders', 'albums'], 'readwrite', async (tx) => {
    if (input.folderId && !(await get<Folder>(tx, 'folders', input.folderId))) throw new Error('Folder not found');
    const album: Album = {
      id: crypto.randomUUID(),
      createdAt: now(),
      name: required(input.name, 'Name', 256),
      artist: clean(input.artist, 256),
      kind: input.kind === 'playlist' ? 'playlist' : 'album',
      coverFileId: null,
      hue: typeof input.hue === 'number' ? Math.min(360, Math.max(0, Math.round(input.hue))) : null,
      folderId: input.folderId ?? null,
    };
    await put(tx, 'albums', album);
    return album;
  });
}

export async function localUpdateAlbum(id: string, patch: { name?: string; folderId?: string | null }): Promise<Album> {
  return transact(['folders', 'albums'], 'readwrite', async (tx) => {
    const album = await get<Album>(tx, 'albums', id);
    if (!album) throw new Error('Album not found');
    const next = { ...album };
    if (patch.name !== undefined) next.name = required(patch.name, 'Name', 256);
    if ('folderId' in patch) {
      if (patch.folderId && !(await get<Folder>(tx, 'folders', patch.folderId))) throw new Error('Folder not found');
      next.folderId = patch.folderId ?? null;
    }
    await put(tx, 'albums', next);
    return next;
  });
}

export async function localSetCover(albumId: string, file: Blob): Promise<Album> {
  return transact(['albums', 'files'], 'readwrite', async (tx) => {
    const album = await get<Album>(tx, 'albums', albumId);
    if (!album) throw new Error('Album not found');
    const fileId = crypto.randomUUID();
    await put(tx, 'files', { id: fileId, kind: 'cover', blob: file } satisfies StoredFile);
    if (album.coverFileId) await remove(tx, 'files', album.coverFileId);
    const next = { ...album, coverFileId: fileId };
    await put(tx, 'albums', next);
    return next;
  });
}

export async function localDeleteAlbum(id: string): Promise<void> {
  await transact(['albums', 'tracks', 'links', 'files'], 'readwrite', async (tx) => {
    const album = await get<Album>(tx, 'albums', id);
    if (!album) throw new Error('Album not found');
    const links = await getAll<Link>(tx, 'links');
    const doomedTracks = album.kind === 'album' ? (await getAll<Track>(tx, 'tracks')).filter((track) => track.albumId === id) : [];
    const doomedIds = new Set(doomedTracks.map((track) => track.id));
    for (const link of links) {
      if (link.playlistId === id || doomedIds.has(link.trackId)) await remove(tx, 'links', link.id);
    }
    for (const track of doomedTracks) {
      await remove(tx, 'tracks', track.id);
      await remove(tx, 'files', track.audioFileId);
      if (track.coverFileId && track.coverFileId !== album.coverFileId) await remove(tx, 'files', track.coverFileId);
    }
    if (album.coverFileId) await remove(tx, 'files', album.coverFileId);
    await remove(tx, 'albums', id);
  });
}

export async function localUpdateTrack(id: string, patch: { title?: string; albumId?: string }): Promise<Track> {
  return transact(['albums', 'tracks'], 'readwrite', async (tx) => {
    const track = await get<Track>(tx, 'tracks', id);
    if (!track) throw new Error('Track not found');
    const next = { ...track };
    if (patch.title !== undefined) next.title = required(patch.title, 'Title', 512);
    if (patch.albumId !== undefined) {
      const album = await get<Album>(tx, 'albums', patch.albumId);
      if (!album || album.kind !== 'album') throw new Error('Project not found');
      next.albumId = album.id;
    }
    await put(tx, 'tracks', next);
    return next;
  });
}

export async function localSetTrackCover(trackId: string, file: Blob): Promise<Track> {
  return transact(['tracks', 'files'], 'readwrite', async (tx) => {
    const track = await get<Track>(tx, 'tracks', trackId);
    if (!track) throw new Error('Track not found');
    const fileId = crypto.randomUUID();
    await put(tx, 'files', { id: fileId, kind: 'cover', blob: file } satisfies StoredFile);
    if (track.coverFileId) await remove(tx, 'files', track.coverFileId);
    const next = { ...track, coverFileId: fileId };
    await put(tx, 'tracks', next);
    return next;
  });
}

export async function localStoreAudio(file: Blob): Promise<{ fileId: string; contentType: string }> {
  const fileId = crypto.randomUUID();
  const contentType = file.type || 'application/octet-stream';
  await transact(['files'], 'readwrite', (tx) => put(tx, 'files', { id: fileId, kind: 'audio', blob: file } satisfies StoredFile));
  return { fileId, contentType };
}

export async function localCreateTrack(input: {
  title: string;
  artist: string;
  albumId: string;
  audioFileId: string;
  durationMs: number;
  trackNumber?: number | null;
  year?: number | null;
  hue?: number | null;
  waveform?: string | null;
}): Promise<Track> {
  return transact(['albums', 'tracks', 'files'], 'readwrite', async (tx) => {
    if (!(await get<StoredFile>(tx, 'files', input.audioFileId))) throw new Error('Add the audio first');
    if (!(await get<Album>(tx, 'albums', input.albumId))) throw new Error('Album not found');
    const track: Track = {
      id: crypto.randomUUID(),
      createdAt: now(),
      title: required(input.title, 'Title', 512),
      artist: clean(input.artist, 256),
      albumId: input.albumId,
      audioFileId: input.audioFileId,
      coverFileId: null,
      durationMs: Math.max(0, Math.round(input.durationMs || 0)),
      trackNumber: input.trackNumber ?? null,
      year: input.year ?? null,
      hue: input.hue ?? null,
      waveform: typeof input.waveform === 'string' ? input.waveform.slice(0, 20000) : null,
    };
    await put(tx, 'tracks', track);
    return track;
  });
}

export async function localDeleteTrack(id: string): Promise<void> {
  await transact(['tracks', 'links', 'files'], 'readwrite', async (tx) => {
    const track = await get<Track>(tx, 'tracks', id);
    if (!track) throw new Error('Track not found');
    for (const link of await getAll<Link>(tx, 'links')) {
      if (link.trackId === id) await remove(tx, 'links', link.id);
    }
    await remove(tx, 'tracks', id);
    await remove(tx, 'files', track.audioFileId);
    if (track.coverFileId) await remove(tx, 'files', track.coverFileId);
  });
}

export async function localAddToPlaylist(playlistId: string, trackIds: string[]): Promise<{ added: PlaylistTrack[] }> {
  return transact(['albums', 'tracks', 'links'], 'readwrite', async (tx) => {
    const playlist = await get<Album>(tx, 'albums', playlistId);
    if (!playlist || playlist.kind !== 'playlist') throw new Error('Playlist not found');
    const existing = (await getAll<Link>(tx, 'links')).filter((link) => link.playlistId === playlistId);
    const present = new Set(existing.map((link) => link.trackId));
    let position = existing.reduce((max, link) => Math.max(max, link.position), -1) + 1;
    const added: PlaylistTrack[] = [];
    for (const trackId of trackIds) {
      if (present.has(trackId) || !(await get<Track>(tx, 'tracks', trackId))) continue;
      const link: Link = { id: crypto.randomUUID(), playlistId, trackId, position };
      await put(tx, 'links', link);
      present.add(trackId);
      added.push(link);
      position += 1;
    }
    return { added };
  });
}

export async function localRemoveFromPlaylist(playlistId: string, trackId: string): Promise<void> {
  await transact(['links'], 'readwrite', async (tx) => {
    for (const link of await getAll<Link>(tx, 'links')) {
      if (link.playlistId === playlistId && link.trackId === trackId) await remove(tx, 'links', link.id);
    }
  });
}

export async function localFile(kind: 'audio' | 'cover', id: string): Promise<Blob> {
  const stored = await transact(['files'], 'readonly', (tx) => get<StoredFile>(tx, 'files', id));
  if (!stored || stored.kind !== kind) throw new Error('That file is missing from this device');
  return stored.blob;
}
