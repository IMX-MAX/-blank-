import * as local from './lib/local-store';
import type { Album, Folder, PlaylistTrack, Track } from './types';

export type Library = {
  folders: Folder[];
  albums: Album[];
  tracks: Track[];
  playlistTracks: PlaylistTrack[];
};

export const api = {
  library: local.localLibrary,
  createFolder: local.localCreateFolder,
  renameFolder: local.localRenameFolder,
  deleteFolder: local.localDeleteFolder,
  createAlbum: local.localCreateAlbum,
  updateAlbum: local.localUpdateAlbum,
  deleteAlbum: local.localDeleteAlbum,
  setCover: local.localSetCover,
  setTrackCover: local.localSetTrackCover,
  uploadAudio: local.localStoreAudio,
  createTrack: local.localCreateTrack,
  deleteTrack: local.localDeleteTrack,
  addToPlaylist: local.localAddToPlaylist,
  removeFromPlaylist: local.localRemoveFromPlaylist,
  file: local.localFile,
};

const coverUrls = new Map<string, string>();
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

const audioUrls = new Map<string, string>();
const MAX_AUDIO = 3;

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
    URL.revokeObjectURL(audioUrls.get(oldest)!);
    audioUrls.delete(oldest);
  }
  return url;
}
