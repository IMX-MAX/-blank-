import { parseBlob } from 'music-metadata';
import { AUDIO_EXTENSIONS } from '../config';

export type TrackMetadata = {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNumber: number | null;
  year: number | null;
  durationMs: number;
  picture: { mime: string; bytes: Uint8Array } | null;
};

export function isAudioFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return AUDIO_EXTENSIONS.includes(ext);
}

export function fileTitle(file: File): string {
  return file.name.replace(/\.[^.]+$/, '').trim() || 'Untitled';
}

function pictureExtension(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'jpg';
}

export function coverFileFromPicture(picture: { mime: string; bytes: Uint8Array }, name: string): File {
  const ext = pictureExtension(picture.mime);
  const type = picture.mime.startsWith('image/') ? picture.mime : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  const bytes = new Uint8Array(picture.bytes);
  return new File([bytes], `${name}.${ext}`, { type });
}

function durationFromElement(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    const finish = (ms: number) => {
      URL.revokeObjectURL(url);
      resolve(ms);
    };
    audio.preload = 'metadata';
    audio.src = url;
    audio.onloadedmetadata = () => {
      finish(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0);
    };
    audio.onerror = () => finish(0);
  });
}

export async function readMetadata(file: File, fallbackArtist: string): Promise<TrackMetadata> {
  let title = fileTitle(file);
  let artist = fallbackArtist;
  let album = 'Untitled';
  let albumArtist = fallbackArtist;
  let trackNumber: number | null = null;
  let year: number | null = null;
  let durationMs = 0;
  let picture: TrackMetadata['picture'] = null;

  try {
    const metadata = await parseBlob(file, { duration: true });
    const common = metadata.common;
    if (common.title?.trim()) title = common.title.trim();
    if (common.artist?.trim()) artist = common.artist.trim();
    if (common.album?.trim()) album = common.album.trim();
    const albumArtistTag = common.albumartist?.trim();
    if (albumArtistTag) albumArtist = albumArtistTag;
    else if (common.artist?.trim()) albumArtist = common.artist.trim();
    if (common.track?.no) trackNumber = common.track.no;
    if (common.year) year = common.year;
    if (metadata.format.duration) durationMs = Math.round(metadata.format.duration * 1000);
    const art = common.picture?.[0];
    if (art?.data?.byteLength) {
      picture = { mime: art.format || 'image/jpeg', bytes: art.data };
    }
  } catch {
    /* keep filename fallbacks */
  }

  if (!durationMs) durationMs = await durationFromElement(file);
  return { title, artist, album, albumArtist, trackNumber, year, durationMs, picture };
}
