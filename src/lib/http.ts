import { Capacitor, CapacitorHttp } from '@capacitor/core';

export type TextFetch = (url: string, signal?: AbortSignal) => Promise<string | null>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const BROWSER_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

/** Hosts that send no CORS headers. The web app reaches them through the pass-through in `api/lyrics-proxy.ts`. */
const NO_CORS = new Set(['music.163.com', 'lyrics-api.boidu.dev']);
const PROXY: string = import.meta.env?.VITE_LYRICS_PROXY ?? '/lyrics-proxy';
let proxyMissing = false;

/**
 * GET as text. Some lyric services send no CORS headers, so the Android app asks through the native HTTP client
 * and the web app through the lyrics pass-through; where that is not hosted the service counts as "not available".
 * 404 gives null, other errors throw.
 */
export function textFetcher(headers: Record<string, string> = {}): TextFetch {
  return async (url, signal) => {
    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.get({
        url,
        headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json, text/plain, */*', ...headers },
        responseType: 'text',
        readTimeout: 15000,
        connectTimeout: 8000,
      });
      if (response.status === 404) return null;
      if (response.status >= 400) throw new HttpError(response.status, `Lookup failed (${response.status})`);
      return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    }
    const proxied = NO_CORS.has(new URL(url).hostname);
    if (proxied && proxyMissing) return null;
    let response: Response;
    try {
      response = await fetch(proxied ? `${PROXY}?url=${encodeURIComponent(url)}` : url, { signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      return null;
    }
    if (proxied && !response.headers.has('x-lyrics-proxy')) {
      proxyMissing = true;
      return null;
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new HttpError(response.status, `Lookup failed (${response.status})`);
    return response.text();
  };
}
