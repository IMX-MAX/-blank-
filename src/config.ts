export const APPWRITE_ENDPOINT = 'https://tor.cloud.appwrite.io/v1';
export const APPWRITE_PROJECT_ID = '69928cbb002d9fe2510a';
export const DATABASE_ID = 'blank';

export const TABLES = {
  albums: 'albums',
  tracks: 'tracks',
  playlistTracks: 'playlist_tracks',
  folders: 'folders',
} as const;

export const BUCKETS = {
  audio: 'blank-audio',
  covers: 'blank-covers',
} as const;

export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'aiff', 'aif', 'alac'];
