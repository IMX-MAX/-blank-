/**
 * A stateless pass-through for the two lyric services that send no CORS headers, so a plain browser can use them
 * like the Android app does. It only ever fetches the hosts below, stores nothing and has no accounts.
 * Vercel serves this file as /api/lyrics-proxy; `vite.config.ts` serves the same code on /lyrics-proxy for
 * `npm run dev` and `npm run preview`.
 */
const ALLOWED: Record<string, Record<string, string>> = {
  'music.163.com': { Referer: 'https://music.163.com' },
  'lyrics-api.boidu.dev': {},
};

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const answer = (status: number, body: string, type = 'text/plain; charset=utf-8') =>
  new Response(body, {
    status,
    headers: {
      'content-type': type,
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
      'access-control-expose-headers': 'x-lyrics-proxy',
      'x-lyrics-proxy': '1',
    },
  });

export function allowedTarget(raw: string | null): URL | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  return url.hostname in ALLOWED ? url : null;
}

export async function GET(request: Request): Promise<Response> {
  const target = allowedTarget(new URL(request.url).searchParams.get('url'));
  if (!target) return answer(400, 'This address cannot be fetched');
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json, text/plain, */*', ...ALLOWED[target.hostname] },
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return answer(502, 'The lyrics service did not answer');
  }
  if (upstream.status >= 300 && upstream.status < 400) return answer(502, 'The lyrics service redirected');
  return answer(upstream.status, await upstream.text(), upstream.headers.get('content-type') ?? undefined);
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET' } });
}
