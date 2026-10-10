import { API_URL } from './config';
import { auth } from './auth';
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
  const token = await auth().token();
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'Could not reach the server');
  }
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

export const api = {
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
    const response = await request('/files/audio', {
      method: 'PUT',
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: file,
    });
    return response.json();
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
};

const coverUrls = new Map<string, string>();
const audioUrls = new Map<string, string>();
const MAX_AUDIO = 3;

export async function coverObjectUrl(fileId: string): Promise<string> {
  const cached = coverUrls.get(fileId);
  if (cached) return cached;
  const url = URL.createObjectURL(await api.file('cover', fileId));
  coverUrls.set(fileId, url);
  return url;
}

export function forgetCover(fileId: string) {
  const url = coverUrls.get(fileId);
  if (!url) return;
  URL.revokeObjectURL(url);
  coverUrls.delete(fileId);
}

export async function audioObjectUrl(fileId: string): Promise<string> {
  const cached = audioUrls.get(fileId);
  if (cached) {
    audioUrls.delete(fileId);
    audioUrls.set(fileId, cached);
    return cached;
  }
  const url = URL.createObjectURL(await api.file('audio', fileId));
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
