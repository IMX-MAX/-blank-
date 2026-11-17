import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { parseAlbum, parseSearch, streamFromPlayer, type YtAlbum, type YtAlbumPage, type YtSearch } from './youtube';

const MUSIC = 'https://music.youtube.com';
const YOUTUBE = 'https://www.youtube.com';
const CLIENT_VERSION = '1.20241127.01.00';

/** Songs only, then albums only. Same filters YouTube Music's own search chips use. */
const SONGS = 'EgWKAQIIAWoKEAMQBBAJEAoQBQ%3D%3D';
const ALBUMS = 'EgWKAQIYAWoKEAMQBBAJEAoQBQ%3D%3D';

export class YoutubeError extends Error {}

let visitorData: string | undefined;

type PlayerClient = {
  name: string;
  version: string;
  origin: string;
  ua: string;
  client: Record<string, string | number>;
};

const PLAYERS: PlayerClient[] = [
  {
    name: 'ANDROID',
    version: '20.10.38',
    origin: YOUTUBE,
    ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
    client: { androidSdkVersion: 34, osName: 'Android', osVersion: '14' },
  },
  {
    name: 'IOS',
    version: '20.10.4',
    origin: YOUTUBE,
    ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_1 like Mac OS X)',
    client: { deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iOS', osVersion: '18.1.0.22B83' },
  },
  {
    name: 'WEB_REMIX',
    version: CLIENT_VERSION,
    origin: MUSIC,
    ua: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    client: {},
  },
];

function endpoint(origin: string, path: string): string {
  if (Capacitor.isNativePlatform() || !import.meta.env.DEV) return `${origin}${path}`;
  const prefix = origin === MUSIC ? '/ytmusic' : '/yt';
  return `${prefix}${path}`;
}

/** googlevideo does not send CORS headers, so the dev server fetches it. The phone app does not need that. */
export function playableUrl(url: string): string {
  if (Capacitor.isNativePlatform() || !import.meta.env.DEV) return url;
  if (/^https:\/\/([a-z0-9.-]+\.)?googlevideo\.com\//.test(url)) return `/gvideo?u=${encodeURIComponent(url)}`;
  return url;
}

async function postJson(origin: string, path: string, body: unknown, signal?: AbortSignal, ua?: string): Promise<unknown> {
  const url = endpoint(origin, path);
  const userAgent = ua || 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.post({
      url,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: origin,
        Referer: `${origin}/`,
        'User-Agent': userAgent,
      },
      data: body,
      responseType: 'json',
      readTimeout: 20000,
      connectTimeout: 10000,
    });
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (response.status >= 400) throw new YoutubeError(`YouTube Music didn't answer (${response.status})`);
    return response.data;
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Blank-UA': userAgent },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new YoutubeError(`YouTube Music didn't answer (${response.status})`);
  return response.json();
}

function context(extra: Record<string, string | number> = {}, name = 'WEB_REMIX', version = CLIENT_VERSION) {
  return {
    client: {
      clientName: name,
      clientVersion: version,
      hl: 'en',
      gl: 'US',
      ...(visitorData ? { visitorData } : {}),
      ...extra,
    },
  };
}

function takeVisitor(data: unknown) {
  if (!data || typeof data !== 'object') return;
  const value = (data as { responseContext?: { visitorData?: string } }).responseContext?.visitorData;
  if (typeof value === 'string' && value) visitorData = value;
}

/** Guest search: no Google account. Songs and albums come back as two lists. */
export async function searchYoutube(query: string, signal?: AbortSignal): Promise<YtSearch> {
  const text = query.trim();
  if (!text) return { songs: [], albums: [] };
  const [songs, albums] = await Promise.all([
    postJson(MUSIC, '/youtubei/v1/search?prettyPrint=false', { context: context(), query: text, params: SONGS }, signal).catch((error) => {
      if (signal?.aborted) throw error;
      return null;
    }),
    postJson(MUSIC, '/youtubei/v1/search?prettyPrint=false', { context: context(), query: text, params: ALBUMS }, signal).catch((error) => {
      if (signal?.aborted) throw error;
      return null;
    }),
  ]);
  if (!songs && !albums) throw new YoutubeError("Couldn't reach YouTube Music");
  takeVisitor(songs ?? albums);
  const songList = songs ? parseSearch(songs).songs : [];
  const albumList = albums ? parseSearch(albums).albums : [];
  return { songs: songList, albums: albumList };
}

export async function youtubeAlbum(album: YtAlbum, signal?: AbortSignal): Promise<YtAlbumPage> {
  const data = await postJson(MUSIC, '/youtubei/v1/browse?prettyPrint=false', { context: context(), browseId: album.browseId }, signal);
  takeVisitor(data);
  return parseAlbum(data, album);
}

const blobs = new Map<string, Blob>();
const recent: string[] = [];

function keepBlob(videoId: string, blob: Blob) {
  blobs.set(videoId, blob);
  const at = recent.indexOf(videoId);
  if (at >= 0) recent.splice(at, 1);
  recent.push(videoId);
  while (recent.length > 3) {
    const old = recent.shift();
    if (old && old !== videoId) blobs.delete(old);
  }
}

async function bytesFrom(url: string, onProgress?: (fraction: number) => void): Promise<{ bytes: Uint8Array; type: string }> {
  const target = playableUrl(url);
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({ url: target, responseType: 'arraybuffer', readTimeout: 120000, connectTimeout: 15000 });
    if (response.status >= 400) throw new YoutubeError(`Download failed (${response.status})`);
    const raw = response.data;
    let bytes: Uint8Array;
    if (raw instanceof ArrayBuffer) bytes = new Uint8Array(raw);
    else if (typeof raw === 'string') {
      const binary = atob(raw);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    } else throw new YoutubeError('Download failed');
    onProgress?.(1);
    const type = response.headers?.['Content-Type'] || response.headers?.['content-type'] || '';
    return { bytes, type };
  }
  const response = await fetch(target);
  if (!response.ok) throw new YoutubeError(`Download failed (${response.status})`);
  const type = response.headers.get('content-type') ?? '';
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    onProgress?.(1);
    return { bytes: buffer, type };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total) onProgress?.(Math.min(1, received / total));
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress?.(1);
  return { bytes, type };
}

async function resolveStream(videoId: string): Promise<{ url: string; mimeType: string }> {
  let last = 'YouTube did not provide a playable stream';
  for (const player of PLAYERS) {
    let data: unknown;
    try {
      data = await postJson(
        player.origin,
        '/youtubei/v1/player?prettyPrint=false',
        {
          context: context(player.client, player.name, player.version),
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        },
        undefined,
        player.ua,
      );
    } catch (error) {
      if (error instanceof YoutubeError) last = error.message;
      else last = "YouTube Music didn't answer";
      continue;
    }
    const stream = streamFromPlayer(data);
    if ('url' in stream) return stream;
    last = stream.error;
  }
  throw new YoutubeError(last);
}

/** The audio for a video, kept in memory so a download right after play does not fetch it again. */
export async function loadYoutubeAudio(videoId: string, onProgress?: (fraction: number) => void): Promise<Blob> {
  const cached = blobs.get(videoId);
  if (cached) {
    onProgress?.(1);
    return cached;
  }
  const stream = await resolveStream(videoId);
  const { bytes, type } = await bytesFrom(stream.url, onProgress);
  const mime = type || stream.mimeType || 'audio/mp4';
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: mime.split(';')[0] || 'audio/mp4' });
  keepBlob(videoId, blob);
  return blob;
}

export async function youtubeObjectUrl(videoId: string): Promise<string> {
  const blob = await loadYoutubeAudio(videoId);
  return URL.createObjectURL(blob);
}

export async function fetchRemoteBlob(url: string): Promise<Blob> {
  const { bytes, type } = await bytesFrom(url);
  return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: type.split(';')[0] || 'image/jpeg' });
}
