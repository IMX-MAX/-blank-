import { API_URL, LOCAL_ONLY } from './config';
import * as local from './lib/local-store';
import { auth, SESSION_EXPIRED } from './auth';
import { getOfflineAudio, getOfflineCover } from './lib/offline';
import type { Album, Folder, PlaylistTrack, Track } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const send = async (force: boolean) => {
    const token = await auth().token(force);
    const headers = new Headers(init.headers);
    if (token) headers.set('authorization', `Bearer ${token}`);
    try {
      return await fetch(`${API_URL}${path}`, { ...init, headers });
    } catch {
      throw new ApiError(0, 'Could not reach the server');
    }
  };
  let response = await send(false);
  if (response.status === 401) response = await send(true);
  if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED));
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(response.status, body?.error ?? `Request failed (${response.status})`);
  }
  return response;
}

async function json<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await request(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response.json() as Promise<T>;
}

export type Library = {
  folders: Folder[];
  albums: Album[];
  tracks: Track[];
  playlistTracks: PlaylistTrack[];
};

const cloudApi = {
  library: () => json<Library>('/library', 'GET'),
  createFolder: (name: string) => json<Folder>('/folders', 'POST', { name }),
  renameFolder: (id: string, name: string) => json<Folder>(`/folders/${id}`, 'PATCH', { name }),
  deleteFolder: (id: string) => json<{ ok: true }>(`/folders/${id}`, 'DELETE'),
  createAlbum: (input: { name: string; artist: string; kind: Album['kind']; hue?: number; folderId?: string | null }) =>
    json<Album>('/albums', 'POST', input),
  updateAlbum: (id: string, patch: { name?: string; folderId?: string | null }) =>
    json<Album>(`/albums/${id}`, 'PATCH', patch),
  deleteAlbum: (id: string) => json<{ ok: true }>(`/albums/${id}`, 'DELETE'),
  async setCover(albumId: string, file: Blob): Promise<Album> {
    const response = await request(`/albums/${albumId}/cover`, {
      method: 'PUT',
      headers: { 'content-type': file.type || 'image/jpeg' },
      body: file,
    });
    return response.json();
  },
  async uploadAudio(file: Blob): Promise<{ fileId: string; contentType: string }> {
    const contentType = file.type || 'application/octet-stream';
    const init = await json<{ fileId: string; contentType: string; uploadUrl: string | null }>('/files/audio', 'POST', {
      contentType,
    });
    if (init.uploadUrl) {
      let response: Response;
      try {
        response = await fetch(init.uploadUrl, { method: 'PUT', headers: { 'content-type': init.contentType }, body: file });
      } catch {
        throw new ApiError(0, 'Could not upload the file');
      }
      if (!response.ok) throw new ApiError(response.status, `Upload failed (${response.status})`);
    } else {
      await request(`/files/audio/${init.fileId}`, {
        method: 'PUT',
        headers: { 'content-type': init.contentType },
        body: file,
      });
    }
    return { fileId: init.fileId, contentType: init.contentType };
  },
  createTrack: (input: {
    title: string;
    artist: string;
    albumId: string;
    audioFileId: string;
    audioType?: string;
    durationMs: number;
    trackNumber?: number | null;
    year?: number | null;
    hue?: number | null;
    waveform?: string | null;
  }) => json<Track>('/tracks', 'POST', input),
  deleteTrack: (id: string) => json<{ ok: true }>(`/tracks/${id}`, 'DELETE'),
  addToPlaylist: (playlistId: string, trackIds: string[]) =>
    json<{ added: PlaylistTrack[] }>(`/playlists/${playlistId}/tracks`, 'POST', { trackIds }),
  removeFromPlaylist: (playlistId: string, trackId: string) =>
    json<{ ok: true }>(`/playlists/${playlistId}/tracks/${trackId}`, 'DELETE'),
  async file(kind: 'audio' | 'cover', id: string): Promise<Blob> {
    return (await request(`/files/${kind}/${id}`)).blob();
  },
  async fileUrl(kind: 'audio' | 'cover', id: string): Promise<{ url: string | null; expiresIn?: number }> {
    return json(`/files/${kind}/${id}/url`, 'GET');
  },
};

const localApi: typeof cloudApi = {
  library: local.localLibrary,
  createFolder: local.localCreateFolder,
  renameFolder: local.localRenameFolder,
  deleteFolder: async (id) => {
    await local.localDeleteFolder(id);
    return { ok: true };
  },
  createAlbum: local.localCreateAlbum,
  updateAlbum: local.localUpdateAlbum,
  deleteAlbum: async (id) => {
    await local.localDeleteAlbum(id);
    return { ok: true };
  },
  setCover: local.localSetCover,
  uploadAudio: local.localStoreAudio,
  createTrack: local.localCreateTrack,
  deleteTrack: async (id) => {
    await local.localDeleteTrack(id);
    return { ok: true };
  },
  addToPlaylist: local.localAddToPlaylist,
  removeFromPlaylist: async (playlistId, trackId) => {
    await local.localRemoveFromPlaylist(playlistId, trackId);
    return { ok: true };
  },
  file: local.localFile,
  fileUrl: async () => ({ url: null }),
};

export const api: typeof cloudApi = LOCAL_ONLY ? localApi : cloudApi;

const coverUrls = new Map<string, string>();
export async function coverObjectUrl(fileId: string): Promise<string> {
  const cached = coverUrls.get(fileId);
  if (cached) return cached;
  const saved = await getOfflineCover(fileId).catch(() => null);
  const url = URL.createObjectURL(saved ?? (await api.file('cover', fileId)));
  coverUrls.set(fileId, url);
  return url;
}

export function forgetCover(fileId: string) {
  const url = coverUrls.get(fileId);
  if (!url) return;
  URL.revokeObjectURL(url);
  coverUrls.delete(fileId);
}

const audioUrls = new Map<string, { url: string; blob: boolean; expires: number }>();
const MAX_AUDIO = 3;

function dropAudio(fileId: string) {
  const entry = audioUrls.get(fileId);
  audioUrls.delete(fileId);
  if (entry?.blob) URL.revokeObjectURL(entry.url);
}

export async function audioObjectUrl(fileId: string): Promise<string> {
  const cached = audioUrls.get(fileId);
  if (cached && cached.expires > Date.now()) {
    audioUrls.delete(fileId);
    audioUrls.set(fileId, cached);
    return cached.url;
  }
  if (cached) dropAudio(fileId);
  const saved = await getOfflineAudio(fileId).catch(() => null);
  let entry: { url: string; blob: boolean; expires: number };
  if (saved) {
    entry = { url: URL.createObjectURL(saved), blob: true, expires: Infinity };
  } else {
    const direct = await api.fileUrl('audio', fileId);
    entry = direct.url
      ? { url: direct.url, blob: false, expires: Date.now() + ((direct.expiresIn ?? 3600) * 1000) / 2 }
      : { url: URL.createObjectURL(await api.file('audio', fileId)), blob: true, expires: Infinity };
  }
  audioUrls.set(fileId, entry);
  while (audioUrls.size > MAX_AUDIO) {
    const oldest = audioUrls.keys().next().value;
    if (!oldest || oldest === fileId) break;
    dropAudio(oldest);
  }
  return entry.url;
}

async function readWithProgress(response: Response, onProgress?: (fraction: number) => void): Promise<Blob> {
  const type = response.headers.get('content-type') ?? '';
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) return response.blob();
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as BlobPart);
    received += value.byteLength;
    if (total) onProgress?.(Math.min(1, received / total));
  }
  return new Blob(chunks, { type });
}

/** Downloads the whole audio file so it can be kept for offline playback. */
export async function downloadAudio(fileId: string, onProgress?: (fraction: number) => void): Promise<Blob> {
  const direct = await api.fileUrl('audio', fileId);
  let response: Response;
  try {
    response = direct.url ? await fetch(direct.url) : await request(`/files/audio/${fileId}`);
  } catch {
    throw new ApiError(0, 'Could not reach the server');
  }
  if (!response.ok) throw new ApiError(response.status, `Download failed (${response.status})`);
  return readWithProgress(response, onProgress);
}

export async function downloadCover(fileId: string): Promise<Blob> {
  return api.file('cover', fileId);
}
