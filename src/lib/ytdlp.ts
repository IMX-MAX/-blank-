import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  classify,
  downloadArgs,
  infoArgs,
  parseInfoFile,
  parseListing,
  safeName,
  type YtEntry,
  type YtListing,
} from './ytdlp-parse';

export type { YtEntry, YtListing } from './ytdlp-parse';

export type YtStatus = { available: true; version: string } | { available: false; reason: string };

/** A downloaded song, ready to be added like any other file. */
export type YtDownload = { audio: File; cover: File | null; entry: YtEntry };

export type YtSource = {
  status(): Promise<YtStatus>;
  /** Songs for a pasted link or a search. */
  listing(input: string): Promise<YtListing>;
  /** Downloads one song. `onProgress` gets 0 to 1. */
  download(entry: YtEntry, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<YtDownload>;
};

const NOT_HERE =
  'yt-dlp is not available here. Run the app with npm run dev or npm run preview on a computer that has yt-dlp installed, or use the Android app.';

const EXTENSION = /\.([a-z0-9]{2,5})$/i;

/** Square, so a 16:9 video still becomes cover art that fits the album tiles. */
export async function squareCover(blob: Blob, name: string): Promise<File> {
  try {
    const bitmap = await createImageBitmap(blob);
    const side = Math.min(bitmap.width, bitmap.height);
    const wide = Math.max(bitmap.width, bitmap.height) / side;
    if (wide < 1.05) {
      bitmap.close();
      return new File([blob], name, { type: blob.type || 'image/jpeg' });
    }
    const out = Math.min(side, 1000);
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    canvas.getContext('2d')?.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out);
    bitmap.close();
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (jpeg) return new File([jpeg], name.replace(EXTENSION, '.jpg'), { type: 'image/jpeg' });
  } catch {
    /* an unreadable picture is used as it is */
  }
  return new File([blob], name, { type: blob.type || 'image/jpeg' });
}

async function assemble(entry: YtEntry, audio: Blob, audioName: string, cover: Blob | null, info: string | null): Promise<YtDownload> {
  const full = (info ? safeParse(info) : null) ?? entry;
  const extension = EXTENSION.exec(audioName)?.[1] ?? 'm4a';
  const file = new File([audio], safeName(full.title, extension), { type: audio.type || 'audio/mp4' });
  return { audio: file, cover: cover ? await squareCover(cover, `${full.id}.jpg`) : null, entry: full };
}

function safeParse(info: string): YtEntry | null {
  try {
    return parseInfoFile(info);
  } catch {
    return null;
  }
}

const webSource = (() => {
  let cached: Promise<YtStatus> | null = null;

  async function failure(response: Response): Promise<Error> {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return new Error(body?.error || `yt-dlp failed (${response.status})`);
  }

  const source: YtSource = {
    status() {
      cached ??= (async (): Promise<YtStatus> => {
        try {
          const response = await fetch('/ytdlp/status');
          const body = (await response.json()) as { available?: boolean; version?: string; reason?: string };
          if (body.available && body.version) return { available: true, version: body.version };
          return { available: false, reason: body.reason ? `${body.reason}. ${NOT_HERE}` : NOT_HERE };
        } catch {
          return { available: false, reason: NOT_HERE };
        }
      })();
      return cached;
    },

    async listing(input) {
      const target = classify(input);
      if (target.kind === 'invalid') throw new Error(target.reason);
      const response = await fetch(`/ytdlp/info?q=${encodeURIComponent(input.trim())}`);
      if (!response.ok) throw await failure(response);
      return parseListing(await response.text());
    },

    async download(entry, onProgress, signal) {
      const response = await fetch(`/ytdlp/download?url=${encodeURIComponent(entry.url)}`, { signal });
      if (!response.ok || !response.body) throw await failure(response);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      type Done = { token: string; files: { audio: string; cover: string | null; info: string | null } };
      let done: Done | null = null;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line) as { progress?: number; error?: string; done?: Done };
          if (message.error) throw new Error(message.error);
          if (typeof message.progress === 'number') onProgress(message.progress);
          if (message.done) done = message.done;
        }
      }
      if (!done) throw new Error('The download stopped early');
      const { token, files } = done;
      const get = async (name: string) => {
        const file = await fetch(`/ytdlp/file/${token}/${encodeURIComponent(name)}`, { signal });
        if (!file.ok) throw await failure(file);
        return file.blob();
      };
      try {
        const audio = await get(files.audio);
        const cover = files.cover ? await get(files.cover).catch(() => null) : null;
        const info = files.info ? await (await get(files.info)).text().catch(() => null) : null;
        return await assemble(entry, audio, files.audio, cover, info);
      } finally {
        void fetch(`/ytdlp/file/${token}`, { method: 'DELETE' }).catch(() => undefined);
      }
    },
  };
  return source;
})();

type NativeYtDlp = {
  status(): Promise<{ version: string }>;
  info(options: { target: string; args: string[] }): Promise<{ json: string }>;
  download(options: { url: string; args: string[] }): Promise<{ token: string; audioPath: string; coverPath?: string; infoPath?: string }>;
  release(options: { token: string }): Promise<void>;
  cancel(): Promise<void>;
  addListener(event: 'progress', listener: (event: { value: number }) => void): Promise<{ remove: () => Promise<void> }>;
};

const nativeSource = (() => {
  const plugin = registerPlugin<NativeYtDlp>('YtDlp');

  const read = async (path: string) => {
    const response = await fetch(Capacitor.convertFileSrc(path));
    if (!response.ok) throw new Error('Could not read the downloaded file');
    return response.blob();
  };

  const source: YtSource = {
    async status() {
      try {
        return { available: true, version: (await plugin.status()).version };
      } catch (error) {
        return { available: false, reason: error instanceof Error ? error.message : 'yt-dlp could not start' };
      }
    },

    async listing(input) {
      const target = classify(input);
      if (target.kind === 'invalid') throw new Error(target.reason);
      const { json } = await plugin.info({ target: target.target, args: infoArgs(target.kind) });
      return parseListing(json);
    },

    async download(entry, onProgress, signal) {
      const listener = await plugin.addListener('progress', (event) => onProgress(event.value));
      const stop = () => void plugin.cancel().catch(() => undefined);
      signal?.addEventListener('abort', stop);
      let token: string | null = null;
      try {
        const result = await plugin.download({ url: entry.url, args: downloadArgs('%(id)s.%(ext)s') });
        token = result.token;
        const audio = await read(result.audioPath);
        const cover = result.coverPath ? await read(result.coverPath).catch(() => null) : null;
        const info = result.infoPath ? await (await read(result.infoPath)).text().catch(() => null) : null;
        return await assemble(entry, audio, result.audioPath, cover, info);
      } finally {
        signal?.removeEventListener('abort', stop);
        void listener.remove();
        if (token) void plugin.release({ token }).catch(() => undefined);
      }
    },
  };
  return source;
})();

export const ytdlp: YtSource = Capacitor.isNativePlatform() ? nativeSource : webSource;
