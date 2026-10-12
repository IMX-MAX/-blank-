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

/**
 * GET as text. Some lyric services send no CORS headers, so the app asks through the native HTTP client; a
 * plain browser tries once and treats a blocked request as "not available". 404 gives null, other errors throw.
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
    let response: Response;
    try {
      response = await fetch(url, { signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      return null;
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new HttpError(response.status, `Lookup failed (${response.status})`);
    return response.text();
  };
}
