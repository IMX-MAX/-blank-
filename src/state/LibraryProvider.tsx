import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ID } from 'appwrite';
import { Channel } from 'appwrite';
import { BUCKETS, DATABASE_ID, TABLES } from '../config';
import { client, forgetCover, listAllRows, ownerPermissions, storage, tables } from '../appwrite';
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
  syncing: boolean;
  upload: UploadProgress | null;
  folders: Folder[];
  albums: Album[];
  tracks: Track[];
  playlistTracks: PlaylistTrack[];
  refresh: () => Promise<void>;
  importFiles: (files: File[], target?: ImportTarget) => Promise<Track[]>;
  createFolder: (name: string) => Promise<Folder>;
  createPlaylist: (name: string, folderId?: string | null) => Promise<Album>;
  renameAlbum: (id: string, name: string) => Promise<void>;
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

function asAlbum(row: Record<string, unknown>): Album {
  return {
    $id: String(row.$id),
    $createdAt: String(row.$createdAt),
    name: String(row.name ?? 'Untitled'),
    artist: String(row.artist ?? ''),
    kind: row.kind === 'playlist' ? 'playlist' : 'album',
    coverFileId: row.coverFileId ? String(row.coverFileId) : null,
    hue: typeof row.hue === 'number' ? row.hue : null,
    folderId: row.folderId ? String(row.folderId) : null,
    ownerId: String(row.ownerId ?? ''),
  };
}

function asTrack(row: Record<string, unknown>): Track {
  return {
    $id: String(row.$id),
    $createdAt: String(row.$createdAt),
    title: String(row.title ?? 'Untitled'),
    artist: String(row.artist ?? ''),
    albumId: row.albumId ? String(row.albumId) : null,
    audioFileId: String(row.audioFileId ?? ''),
    coverFileId: row.coverFileId ? String(row.coverFileId) : null,
    durationMs: typeof row.durationMs === 'number' ? row.durationMs : 0,
    trackNumber: typeof row.trackNumber === 'number' ? row.trackNumber : null,
    year: typeof row.year === 'number' ? row.year : null,
    hue: typeof row.hue === 'number' ? row.hue : null,
    waveform: row.waveform ? String(row.waveform) : null,
    ownerId: String(row.ownerId ?? ''),
  };
}

function asFolder(row: Record<string, unknown>): Folder {
  return {
    $id: String(row.$id),
    $createdAt: String(row.$createdAt),
    name: String(row.name ?? 'Folder'),
    ownerId: String(row.ownerId ?? ''),
  };
}

function asLink(row: Record<string, unknown>): PlaylistTrack {
  return {
    $id: String(row.$id),
    playlistId: String(row.playlistId ?? ''),
    trackId: String(row.trackId ?? ''),
    position: typeof row.position === 'number' ? row.position : 0,
    ownerId: String(row.ownerId ?? ''),
  };
}

function albumKey(name: string, artist: string, folderId: string | null) {
  return `${folderId ?? ''}|${name.trim().toLowerCase()}|${artist.trim().toLowerCase()}`;
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlistTracks, setPlaylistTracks] = useState<PlaylistTrack[]>([]);
  const importing = useRef(false);
  const userId = user?.$id ?? '';

  const refresh = useCallback(async () => {
    setSyncing(true);
    try {
      const [folderRows, albumRows, trackRows, linkRows] = await Promise.all([
        listAllRows(TABLES.folders),
        listAllRows(TABLES.albums),
        listAllRows(TABLES.tracks),
        listAllRows(TABLES.playlistTracks),
      ]);
      setFolders(folderRows.map(asFolder));
      setAlbums(albumRows.map(asAlbum));
      setTracks(trackRows.map(asTrack));
      setPlaylistTracks(linkRows.map(asLink));
    } finally {
      setSyncing(false);
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => setReady(true));
  }, [refresh]);

  useEffect(() => {
    return client.subscribe(
      [
        Channel.tablesdb(DATABASE_ID).table(TABLES.albums).row(),
        Channel.tablesdb(DATABASE_ID).table(TABLES.tracks).row(),
        Channel.tablesdb(DATABASE_ID).table(TABLES.folders).row(),
        Channel.tablesdb(DATABASE_ID).table(TABLES.playlistTracks).row(),
      ],
      () => {
        if (importing.current) return;
        void refresh();
      },
    );
  }, [refresh]);

  const tracksFor = useCallback(
    (album: Album) => {
      if (album.kind === 'playlist') {
        const links = playlistTracks
          .filter((link) => link.playlistId === album.$id)
          .sort((a, b) => a.position - b.position);
        const byId = new Map(tracks.map((track) => [track.$id, track]));
        return links.flatMap((link) => {
          const track = byId.get(link.trackId);
          return track ? [track] : [];
        });
      }
      return tracks
        .filter((track) => track.albumId === album.$id)
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
      const hue = input.hue ?? hueFromName(input.name);
      const row = await tables.createRow({
        databaseId: DATABASE_ID,
        tableId: TABLES.albums,
        rowId: ID.unique(),
        data: {
          name: input.name,
          artist: input.artist,
          kind: input.kind,
          hue,
          ownerId: userId,
          ...(input.folderId ? { folderId: input.folderId } : {}),
        },
        permissions: ownerPermissions(userId),
      });
      const album = asAlbum(row as unknown as Record<string, unknown>);
      setAlbums((current) => [album, ...current.filter((item) => item.$id !== album.$id)]);
      return album;
    },
    [userId],
  );

  const createFolder = useCallback(
    async (name: string) => {
      const row = await tables.createRow({
        databaseId: DATABASE_ID,
        tableId: TABLES.folders,
        rowId: ID.unique(),
        data: { name: name.trim(), ownerId: userId },
        permissions: ownerPermissions(userId),
      });
      const folder = asFolder(row as unknown as Record<string, unknown>);
      setFolders((current) => [folder, ...current]);
      return folder;
    },
    [userId],
  );

  const createPlaylist = useCallback(
    async (name: string, folderId?: string | null) => {
      const artist = user?.name?.trim() || 'You';
      return createAlbumRow({ name: name.trim(), artist, kind: 'playlist', folderId });
    },
    [createAlbumRow, user?.name],
  );

  const renameAlbum = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim();
    await tables.updateRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.albums,
      rowId: id,
      data: { name: trimmed },
    });
    setAlbums((current) => current.map((album) => (album.$id === id ? { ...album, name: trimmed } : album)));
  }, []);

  const renameFolder = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim();
    await tables.updateRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.folders,
      rowId: id,
      data: { name: trimmed },
    });
    setFolders((current) => current.map((folder) => (folder.$id === id ? { ...folder, name: trimmed } : folder)));
  }, []);

  const moveAlbum = useCallback(async (id: string, folderId: string | null) => {
    await tables.updateRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.albums,
      rowId: id,
      data: { folderId },
    });
    setAlbums((current) => current.map((album) => (album.$id === id ? { ...album, folderId } : album)));
  }, []);

  const deleteTrack = useCallback(
    async (id: string) => {
      const track = tracks.find((item) => item.$id === id);
      const links = playlistTracks.filter((link) => link.trackId === id);
      await Promise.all(
        links.map((link) =>
          tables.deleteRow({ databaseId: DATABASE_ID, tableId: TABLES.playlistTracks, rowId: link.$id }),
        ),
      );
      await tables.deleteRow({ databaseId: DATABASE_ID, tableId: TABLES.tracks, rowId: id });
      if (track?.audioFileId) {
        await storage.deleteFile({ bucketId: BUCKETS.audio, fileId: track.audioFileId }).catch(() => undefined);
      }
      setTracks((current) => current.filter((item) => item.$id !== id));
      setPlaylistTracks((current) => current.filter((link) => link.trackId !== id));
    },
    [playlistTracks, tracks],
  );

  const deleteAlbum = useCallback(
    async (id: string) => {
      const album = albums.find((item) => item.$id === id);
      if (!album) return;
      if (album.kind === 'playlist') {
        const links = playlistTracks.filter((link) => link.playlistId === id);
        await Promise.all(
          links.map((link) =>
            tables.deleteRow({ databaseId: DATABASE_ID, tableId: TABLES.playlistTracks, rowId: link.$id }),
          ),
        );
        setPlaylistTracks((current) => current.filter((link) => link.playlistId !== id));
      } else {
        const owned = tracks.filter((track) => track.albumId === id);
        for (const track of owned) {
          await deleteTrack(track.$id);
        }
      }
      await tables.deleteRow({ databaseId: DATABASE_ID, tableId: TABLES.albums, rowId: id });
      if (album.coverFileId) {
        forgetCover(album.coverFileId);
        await storage.deleteFile({ bucketId: BUCKETS.covers, fileId: album.coverFileId }).catch(() => undefined);
      }
      setAlbums((current) => current.filter((item) => item.$id !== id));
    },
    [albums, deleteTrack, playlistTracks, tracks],
  );

  const deleteFolder = useCallback(
    async (id: string) => {
      const inside = albums.filter((album) => album.folderId === id);
      await Promise.all(inside.map((album) => moveAlbum(album.$id, null)));
      await tables.deleteRow({ databaseId: DATABASE_ID, tableId: TABLES.folders, rowId: id });
      setFolders((current) => current.filter((folder) => folder.$id !== id));
    },
    [albums, moveAlbum],
  );

  const addTracksToPlaylist = useCallback(
    async (playlistId: string, trackIds: string[]) => {
      const existing = new Set(
        playlistTracks.filter((link) => link.playlistId === playlistId).map((link) => link.trackId),
      );
      let position =
        playlistTracks.filter((link) => link.playlistId === playlistId).reduce((max, link) => Math.max(max, link.position), -1) +
        1;
      const created: PlaylistTrack[] = [];
      for (const trackId of trackIds) {
        if (existing.has(trackId)) continue;
        const row = await tables.createRow({
          databaseId: DATABASE_ID,
          tableId: TABLES.playlistTracks,
          rowId: ID.unique(),
          data: { playlistId, trackId, position, ownerId: userId },
          permissions: ownerPermissions(userId),
        });
        created.push(asLink(row as unknown as Record<string, unknown>));
        position += 1;
      }
      if (created.length) setPlaylistTracks((current) => [...current, ...created]);
    },
    [playlistTracks, userId],
  );

  const removeFromPlaylist = useCallback(
    async (playlistId: string, trackId: string) => {
      const link = playlistTracks.find((item) => item.playlistId === playlistId && item.trackId === trackId);
      if (!link) return;
      await tables.deleteRow({ databaseId: DATABASE_ID, tableId: TABLES.playlistTracks, rowId: link.$id });
      setPlaylistTracks((current) => current.filter((item) => item.$id !== link.$id));
    },
    [playlistTracks],
  );

  const importFiles = useCallback(
    async (files: File[], target?: ImportTarget) => {
      const accepted = files.filter(isAudioFile);
      if (!accepted.length || !user) return [];
      importing.current = true;
      const fallbackArtist = user.name?.trim() || 'Unknown';
      const localAlbums = [...albums];
      const created: Track[] = [];
      try {
        for (let index = 0; index < accepted.length; index += 1) {
          const file = accepted[index]!;
          setUpload({ current: index + 1, total: accepted.length, name: file.name });
          const meta = await readMetadata(file, fallbackArtist);
          const peaks = await peaksForUpload(file);
          let album: Album | undefined;
          if (target?.albumId) {
            album = localAlbums.find((item) => item.$id === target.albumId);
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

          let coverFileId = album.coverFileId;
          if (!coverFileId && meta.picture && meta.picture.bytes.byteLength < 12_000_000) {
            const cover = coverFileFromPicture(meta.picture, album.$id);
            const uploaded = await storage.createFile({
              bucketId: BUCKETS.covers,
              fileId: ID.unique(),
              file: cover,
              permissions: ownerPermissions(userId),
            });
            coverFileId = uploaded.$id;
            await tables.updateRow({
              databaseId: DATABASE_ID,
              tableId: TABLES.albums,
              rowId: album.$id,
              data: { coverFileId },
            });
            album = { ...album, coverFileId };
            const updated = album;
            localAlbums.splice(
              localAlbums.findIndex((item) => item.$id === updated.$id),
              1,
              updated,
            );
            setAlbums((current) => current.map((item) => (item.$id === updated.$id ? updated : item)));
          }

          const audio = await storage.createFile({
            bucketId: BUCKETS.audio,
            fileId: ID.unique(),
            file,
            permissions: ownerPermissions(userId),
          });

          const row = await tables.createRow({
            databaseId: DATABASE_ID,
            tableId: TABLES.tracks,
            rowId: ID.unique(),
            data: {
              title: meta.title,
              artist: meta.artist,
              albumId: album.$id,
              audioFileId: audio.$id,
              durationMs: meta.durationMs,
              hue: album.hue ?? hueFromName(album.name),
              waveform: JSON.stringify(peaks),
              ownerId: userId,
              ...(coverFileId ? { coverFileId } : {}),
              ...(meta.trackNumber ? { trackNumber: meta.trackNumber } : {}),
              ...(meta.year ? { year: meta.year } : {}),
            },
            permissions: ownerPermissions(userId),
          });
          const track = asTrack(row as unknown as Record<string, unknown>);
          setTracks((current) => [track, ...current]);
          created.push(track);
        }
      } finally {
        importing.current = false;
        setUpload(null);
      }
      return created;
    },
    [albums, createAlbumRow, user, userId],
  );

  const value = useMemo<LibraryContextValue>(
    () => ({
      ready,
      syncing,
      upload,
      folders,
      albums,
      tracks,
      playlistTracks,
      refresh,
      importFiles,
      createFolder,
      createPlaylist,
      renameAlbum,
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
      syncing,
      upload,
      folders,
      albums,
      tracks,
      playlistTracks,
      refresh,
      importFiles,
      createFolder,
      createPlaylist,
      renameAlbum,
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
