import { audioObjectUrl } from '../api';
import type { Track } from '../types';
import { detectBeats, type Beat } from './beat-detect';

export type { Beat } from './beat-detect';

const ANALYSIS_RATE = 22050;
const VERSION = 1;

type Stored = { id: string; version: number; times: number[]; strengths: number[] };

const DB_NAME = 'blank-beats';
const STORE = 'beats';
let opened: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opened = null;
      reject(request.error ?? new Error('Beat storage is unavailable'));
    };
  });
  return opened;
}

async function readStored(id: string): Promise<Beat[] | null> {
  const db = await open();
  const stored = await new Promise<Stored | undefined>((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result as Stored | undefined);
    request.onerror = () => reject(request.error);
  });
  if (!stored || stored.version !== VERSION) return null;
  return stored.times.map((time, i) => ({ time, strength: stored.strengths[i] ?? 0.6 }));
}

async function writeStored(id: string, beats: Beat[]): Promise<void> {
  const db = await open();
  const entry: Stored = { id, version: VERSION, times: beats.map((b) => b.time), strengths: beats.map((b) => b.strength) };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Beats for a song, from the cache when it has been analysed before. */
export async function beatsForTrack(track: Pick<Track, 'audioFileId'>, signal?: AbortSignal): Promise<Beat[]> {
  const cached = await readStored(track.audioFileId).catch(() => null);
  if (cached) return cached;
  const response = await fetch(await audioObjectUrl(track.audioFileId), { signal });
  const encoded = await response.arrayBuffer();
  const decoded = await new OfflineAudioContext(1, 1, ANALYSIS_RATE).decodeAudioData(encoded);
  const mono = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
    const data = decoded.getChannelData(channel);
    for (let i = 0; i < mono.length; i += 1) mono[i] = mono[i]! + data[i]! / decoded.numberOfChannels;
  }
  const beats = detectBeats(mono, decoded.sampleRate);
  void writeStored(track.audioFileId, beats).catch(() => undefined);
  return beats;
}
