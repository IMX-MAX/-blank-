import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, downloadArgs, infoArgs, isYoutubeUrl, progressFrom, sortFiles } from '../src/lib/ytdlp-parse';

/**
 * Lets the web app use the yt-dlp installed on the machine that runs `npm run dev` or `npm run preview`.
 * It is a local helper, not a hosted service: it only answers requests from this machine, only for YouTube
 * addresses, and keeps downloads in a temporary folder until the app has taken them.
 */
const BINARY = process.env.BLANK_YTDLP || 'yt-dlp';
const ROOT = join(tmpdir(), 'blank-ytdlp');
const KEEP_MS = 30 * 60 * 1000;
const INFO_TIMEOUT_MS = 90_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

const CONTENT_TYPES: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  webm: 'audio/webm',
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  json: 'application/json',
};

type Run = { code: number; out: string; err: string };

function lastLine(text: string): string {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  return (lines.at(-1) ?? 'yt-dlp failed').replace(/^ERROR:\s*/, '').slice(0, 300);
}

function run(args: string[], options: { timeout: number; onLine?: (line: string) => void }): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(BINARY, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let pending = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeout);
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      out += text;
      if (!options.onLine) return;
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      lines.forEach(options.onLine);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: error.code === 'ENOENT' ? 'yt-dlp is not installed on this computer' : error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out, err });
    });
  });
}

/** Recent yt-dlp needs a JavaScript runtime to read YouTube; this process already has one. */
async function ytdlp(args: string[], options: { timeout: number; onLine?: (line: string) => void }): Promise<Run> {
  const withRuntime = await run(['--js-runtimes', `node:${process.execPath}`, ...args], options);
  if (withRuntime.code !== 0 && /no such option: --js-runtimes/i.test(withRuntime.err)) return run(args, options);
  return withRuntime;
}

function local(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress ?? '';
  const site = req.headers['sec-fetch-site'];
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) && (!site || site === 'same-origin' || site === 'none');
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

async function sweep() {
  const names = await readdir(ROOT).catch((): string[] => []);
  for (const name of names) {
    const info = await stat(join(ROOT, name)).catch(() => null);
    if (info && Date.now() - info.mtimeMs > KEEP_MS) await rm(join(ROOT, name), { recursive: true, force: true });
  }
}

async function handleDownload(url: string, res: ServerResponse) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  const send = (value: unknown) => res.write(`${JSON.stringify(value)}\n`);
  const token = randomBytes(12).toString('hex');
  const dir = join(ROOT, token);
  try {
    await sweep();
    await mkdir(dir, { recursive: true });
    const result = await ytdlp([...downloadArgs(join(dir, '%(id)s.%(ext)s')), '--', url], {
      timeout: DOWNLOAD_TIMEOUT_MS,
      onLine: (line) => {
        const progress = progressFrom(line);
        if (progress !== null) send({ progress });
      },
    });
    const files = sortFiles(await readdir(dir));
    if (result.code !== 0 || !files.audio) {
      await rm(dir, { recursive: true, force: true });
      send({ error: lastLine(result.err) });
    } else {
      send({ done: { token, files } });
    }
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    send({ error: error instanceof Error ? error.message : 'Download failed' });
  }
  res.end();
}

async function handleFile(token: string, name: string | undefined, req: IncomingMessage, res: ServerResponse) {
  if (!/^[a-f0-9]{24}$/.test(token)) return json(res, 404, { error: 'Not found' });
  const dir = join(ROOT, token);
  if (req.method === 'DELETE') {
    await rm(dir, { recursive: true, force: true });
    return json(res, 200, { ok: true });
  }
  const names = await readdir(dir).catch((): string[] => []);
  if (!name || !names.includes(name)) return json(res, 404, { error: 'Not found' });
  const info = await stat(join(dir, name));
  res.statusCode = 200;
  res.setHeader('content-type', CONTENT_TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream');
  res.setHeader('content-length', info.size);
  res.setHeader('cache-control', 'no-store');
  createReadStream(join(dir, name)).pipe(res);
}

export async function ytdlpMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/ytdlp/')) return next();
  if (!local(req)) return json(res, 403, { error: 'yt-dlp is only available from this computer' });
  const route = url.pathname.slice('/ytdlp/'.length);
  try {
    if (route === 'status') {
      const version = await run(['--version'], { timeout: 10_000 });
      return json(res, 200, version.code === 0 ? { available: true, version: version.out.trim() } : { available: false, reason: lastLine(version.err) });
    }
    if (route === 'info') {
      const target = classify(url.searchParams.get('q') ?? '');
      if (target.kind === 'invalid') return json(res, 400, { error: target.reason });
      const result = await ytdlp([...infoArgs(target.kind), '--', target.target], { timeout: INFO_TIMEOUT_MS });
      if (result.code !== 0 || !result.out.trim()) return json(res, 502, { error: lastLine(result.err) });
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      return void res.end(result.out);
    }
    if (route === 'download') {
      const target = url.searchParams.get('url') ?? '';
      if (!isYoutubeUrl(target)) return json(res, 400, { error: 'Only YouTube and YouTube Music links work here' });
      return await handleDownload(target, res);
    }
    if (route.startsWith('file/')) {
      const [token, name] = route.slice('file/'.length).split('/');
      return await handleFile(token ?? '', name ? decodeURIComponent(name) : undefined, req, res);
    }
    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : 'yt-dlp failed' });
  }
}
