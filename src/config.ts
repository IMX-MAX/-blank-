export const AUTH_URL: string = import.meta.env.VITE_NEON_AUTH_URL ?? '';
export const API_URL: string = (import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:8787' : '')).replace(/\/$/, '');

export const LOCAL_AUTH = !AUTH_URL && import.meta.env.DEV;

export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'aiff', 'aif', 'alac'];

/** This build keeps everything on the phone: a local profile instead of an account, and no server. */
export const LOCAL_ONLY = true;
