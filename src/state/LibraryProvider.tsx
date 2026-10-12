import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, forgetCover, type Library } from '../api';
import { hueFromName } from '../lib/format';
import { coverFileFromPicture, isAudioFile, readMetadata } from '../lib/metadata';
import { peaksForUpload } from '../lib/peaks';
import type { Album, Folder, PlaylistTrack, Track, UploadProgress } from '../types';
import { useAuth } from './AuthProvider';

type ImportTarget = {
  albumId?: string;
  folderId?: string | null;
};

type LibraryContextValue = {
  ready: boolean;
  upload: UploadProgress | null;
  folders: Folder[];
  albums: Album[];
  tracks: Track[];
  playlistTracks: PlaylistTrack[];
  refresh: () => Promise<void>;
  importFiles: (files: File[], target?: ImportTarget) => Promise<Track[]>;
  createFolder: (name: string) => Promise<Folder>;
  createProject: (name: string, folderId?: string | null) => Promise<Album>;
  createPlaylist: (name: string, folderId?: string | null) => Promise<Album>;
  renameAlbum: (id: string, name: string) => Promise<void>;
  setAlbumCover: (id: string, file: File) => Promise<void>;
  renameFolder: (id: string, name: string) => Promise<void>;
  moveAlbum: (id: string, folderId: string | null) => Promise<void>;
  deleteAlbum: (id: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  deleteTrack: (id: string) => Promise<void>;
  addTracksToPlaylist: (playlistId: string, trackIds: string[]) => Promise<void>;
  removeFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  tracksFor: (album: Album) => Track[];
};

const LibraryContext = createContext<LibraryContextValue | null>(null);

function pictureKey(bytes: Uint8Array): string {
  const sample = (from: number) => Array.from(bytes.subarray(from, from + 48)).join(',');
  const middle = Math.max(0, Math.floor(bytes.byteLength / 2) - 24);
  return `${bytes.byteLength}:${sample(0)}:${sample(middle)}:${sample(Math.max(0, bytes.byteLength - 48))}`;
}

function albumKey(name: string, artist: string, folderId: string | null) {
  return `${folderId ?? ''}|${name.trim().toLowerCase()}|${artist.trim().toLowerCase()}`;
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [ready, setReady] = useState(false);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlistTracks, setPlaylistTracks] = useState<PlaylistTrack[]>([]);
  const importing = useRef(false);

  const apply = useCallback((next: Library) => {
    setFolders(next.folders);
    setAlbums(next.albums);
    setTracks(next.tracks);
    setPlaylistTracks(next.playlistTracks);
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await api.library());
    } finally {
      setReady(true);
    }
  }, [apply]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const tracksFor = useCallback(
    (album: Album) => {
      if (album.kind === 'playlist') {
        const links = playlistTracks
          .filter((link) => link.playlistId === album.id)
          .sort((a, b) => a.position - b.position);
        const byId = new Map(tracks.map((track) => [track.id, track]));
        return links.flatMap((link) => {
          const track = byId.get(link.trackId);
          return track ? [track] : [];
        });
      }
      return tracks
        .filter((track) => track.albumId === album.id)
        .sort((a, b) => {
          const an = a.trackNumber ?? 9999;
          const bn = b.trackNumber ?? 9999;
          if (an !== bn) return an - bn;
          return a.title.localeCompare(b.title);
        });
    },
    [playlistTracks, tracks],
  );

  const createAlbumRow = useCallback(
    async (input: { name: string; artist: string; kind: Album['kind']; folderId?: string | null; hue?: number }) => {
      const album = await api.createAlbum({
        name: input.name,
        artist: input.artist,
        kind: input.kind,
        hue: input.hue ?? hueFromName(input.name),
        folderId: input.folderId ?? null,
      });
      setAlbums((current) => [album, ...current.filter((item) => item.id !== album.id)]);
      return album;
    },
    [],
  );

  const createFolder = useCallback(async (name: string) => {
    const folder = await api.createFolder(name.trim());
    setFolders((current) => [folder, ...current]);
    return folder;
  }, []);

  const createProject = useCallback(
    async (name: string, folderId?: string | null) => {
      const artist = user?.name?.trim() || 'You';
      return createAlbumRow({ name: name.trim(), artist, kind: 'album', folderId });
    },
    [createAlbumRow, user?.name],
  );

  const createPlaylist = useCallback(
    async (name: string, folderId?: string | null) => {
      const artist = user?.name?.trim() || 'You';
      return createAlbumRow({ name: name.trim(), artist, kind: 'playlist', folderId });
    },
    [createAlbumRow, user?.name],
  );

  const renameAlbum = useCallback(async (id: string, name: string) => {
    const next = await api.updateAlbum(id, { name: name.trim() });
    setAlbums((current) => current.map((album) => (album.id === id ? next : album)));
  }, []);

  const setAlbumCover = useCallback(
    async (id: string, file: File) => {
      if (!file.type.startsWith('image/')) throw new Error('Choose an image: jpg, png, webp, or gif');
      if (file.size > 8 * 1024 * 1024) throw new Error('That image is over 8 MB');
      const previous = albums.find((item) => item.id === id)?.coverFileId;
      const next = await api.setCover(id, file);
      setAlbums((current) => current.map((item) => (item.id === id ? next : item)));
      if (previous) forgetCover(previous);
    },
    [albums],
  );

  const renameFolder = useCallback(async (id: string, name: string) => {
    const next = await api.renameFolder(id, name.trim());
    setFolders((current) => current.map((folder) => (folder.id === id ? next : folder)));
  }, []);

  const moveAlbum = useCallback(async (id: string, folderId: string | null) => {
    const next = await api.updateAlbum(id, { folderId });
    setAlbums((current) => current.map((album) => (album.id === id ? next : album)));
  }, []);

  const deleteTrack = useCallback(async (id: string) => {
    await api.deleteTrack(id);
    setTracks((current) => current.filter((item) => item.id !== id));
    setPlaylistTracks((current) => current.filter((link) => link.trackId !== id));
  }, []);

  const deleteAlbum = useCallback(
    async (id: string) => {
      const album = albums.find((item) => item.id === id);
      if (!album) return;
      await api.deleteAlbum(id);
      if (album.coverFileId) forgetCover(album.coverFileId);
      if (album.kind === 'playlist') {
        setPlaylistTracks((current) => current.filter((link) => link.playlistId !== id));
      } else {
        const gone = new Set(tracks.filter((track) => track.albumId === id).map((track) => track.id));
        setTracks((current) => current.filter((track) => track.albumId !== id));
        setPlaylistTracks((current) => current.filter((link) => !gone.has(link.trackId)));
      }
      setAlbums((current) => current.filter((item) => item.id !== id));
    },
    [albums, tracks],
  );

  const deleteFolder = useCallback(async (id: string) => {
    await api.deleteFolder(id);
    setAlbums((current) => current.map((album) => (album.folderId === id ? { ...album, folderId: null } : album)));
    setFolders((current) => current.filter((folder) => folder.id !== id));
  }, []);

  const addTracksToPlaylist = useCallback(async (playlistId: string, trackIds: string[]) => {
    const { added } = await api.addToPlaylist(playlistId, trackIds);
    if (added.length) setPlaylistTracks((current) => [...current, ...added]);
  }, []);

  const removeFromPlaylist = useCallback(async (playlistId: string, trackId: string) => {
    await api.removeFromPlaylist(playlistId, trackId);
    setPlaylistTracks((current) =>
      current.filter((item) => !(item.playlistId === playlistId && item.trackId === trackId)),
    );
  }, []);

  const importFiles = useCallback(
    async (files: File[], target?: ImportTarget) => {
      const accepted = files.filter(isAudioFile);
      if (!accepted.length || !user) return [];
      importing.current = true;
      const fallbackArtist = user.name?.trim() || 'Unknown';
      const localAlbums = [...albums];
      const created: Track[] = [];
      const albumPictures = new Map<string, string>();
      try {
        for (let index = 0; index < accepted.length; index += 1) {
          const file = accepted[index]!;
          setUpload({ current: index + 1, total: accepted.length, name: file.name });
          const meta = await readMetadata(file, fallbackArtist);
          const peaks = await peaksForUpload(file);

          let album: Album | undefined;
          if (target?.albumId) {
            album = localAlbums.find((item) => item.id === target.albumId);
          } else {
            const folderId = target?.folderId ?? null;
            const key = albumKey(meta.album, meta.albumArtist, folderId);
            album = localAlbums.find(
              (item) => item.kind === 'album' && albumKey(item.name, item.artist, item.folderId) === key,
            );
            if (!album) {
              album = await createAlbumRow({
                name: meta.album,
                artist: meta.albumArtist,
                kind: 'album',
                folderId,
              });
              localAlbums.unshift(album);
            }
          }
          if (!album) continue;

          if (!album.coverFileId && meta.picture && meta.picture.bytes.byteLength < 8_000_000) {
            albumPictures.set(album.id, pictureKey(meta.picture.bytes));
            const updated = await api.setCover(album.id, coverFileFromPicture(meta.picture, album.id));
            album = updated;
            localAlbums.splice(
              localAlbums.findIndex((item) => item.id === updated.id),
              1,
              updated,
            );
            setAlbums((current) => current.map((item) => (item.id === updated.id ? updated : item)));
          }

          const audio = await api.uploadAudio(file);
          const track = await api.createTrack({
            title: meta.title,
            artist: meta.artist,
            albumId: album.id,
            audioFileId: audio.fileId,
            durationMs: meta.durationMs,
            hue: album.hue ?? hueFromName(album.name),
            waveform: JSON.stringify(peaks),
            trackNumber: meta.trackNumber || null,
            year: meta.year || null,
          });
          let stored = track;
          const ownPicture = meta.picture && meta.picture.bytes.byteLength < 8_000_000 ? meta.picture : null;
          if (ownPicture && albumPictures.get(album.id) !== pictureKey(ownPicture.bytes)) {
            // The song's own artwork is a nice-to-have; a failed upload must not lose the song.
            stored = await api
              .setTrackCover(track.id, coverFileFromPicture(ownPicture, track.id))
              .catch(() => track);
          }
          setTracks((current) => [stored, ...current]);
          created.push(stored);
        }
      } finally {
        importing.current = false;
        setUpload(null);
      }
      return created;
    },
    [albums, createAlbumRow, user],
  );

  const value = useMemo<LibraryContextValue>(
    () => ({
      ready,
      upload,
      folders,
      albums,
      tracks,
      playlistTracks,
      refresh,
      importFiles,
      createFolder,
      createProject,
      createPlaylist,
      renameAlbum,
      setAlbumCover,
      renameFolder,
      moveAlbum,
      deleteAlbum,
      deleteFolder,
      deleteTrack,
      addTracksToPlaylist,
      removeFromPlaylist,
      tracksFor,
    }),
    [
      ready,
      upload,
      folders,
      albums,
      tracks,
      playlistTracks,
      refresh,
      importFiles,
      createFolder,
      createProject,
      createPlaylist,
      renameAlbum,
      setAlbumCover,
      renameFolder,
      moveAlbum,
      deleteAlbum,
      deleteFolder,
      deleteTrack,
      addTracksToPlaylist,
      removeFromPlaylist,
      tracksFor,
    ],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used within LibraryProvider');
  return ctx;
}
