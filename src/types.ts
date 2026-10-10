export type AlbumKind = 'album' | 'playlist';

export type Folder = {
  $id: string;
  $createdAt: string;
  name: string;
  ownerId: string;
};

export type Album = {
  $id: string;
  $createdAt: string;
  name: string;
  artist: string;
  kind: AlbumKind;
  coverFileId: string | null;
  hue: number | null;
  folderId: string | null;
  ownerId: string;
};

export type Track = {
  $id: string;
  $createdAt: string;
  title: string;
  artist: string;
  albumId: string | null;
  audioFileId: string;
  coverFileId: string | null;
  durationMs: number;
  trackNumber: number | null;
  year: number | null;
  hue: number | null;
  waveform: string | null;
  ownerId: string;
};

export type PlaylistTrack = {
  $id: string;
  playlistId: string;
  trackId: string;
  position: number;
  ownerId: string;
};

export type UploadProgress = {
  current: number;
  total: number;
  name: string;
};
