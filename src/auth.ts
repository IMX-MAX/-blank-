import { createAuthClient } from '@neondatabase/auth';
import { Capacitor, CapacitorHttp, type HttpResponse } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { AUTH_URL, LOCAL_AUTH } from './config';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  /** The saved sign-in no longer works, so only downloaded songs and the saved library are available. */
  stale?: boolean;
};

type Backend = {
  session(): Promise<AuthUser | null>;
  signIn(email: string, password: string): Promise<AuthUser>;
  signUp(name: string, email: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  token(force?: boolean): Promise<string | null>;
  /** The last user who signed in on this device, kept until they sign out. */
  remembered(): Promise<AuthUser | null>;
};

type Failure = { message?: string } | null | undefined;

function fail(error: Failure, fallback: string): never {
  throw new Error(error?.message || fallback);
}

function toUser(raw: { id: string; name?: string | null; email?: string | null }): AuthUser {
  return { id: raw.id, name: raw.name?.trim() || raw.email?.split('@')[0] || 'You', email: raw.email ?? '' };
}

export const SESSION_EXPIRED = 'blank:session-expired';

const USER_KEY = 'blank.lastUser';

function readUser(): AuthUser | null {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null');
  } catch {
    return null;
  }
}

function writeUser(user: AuthUser | null) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* private mode: the user is simply not remembered */
  }
}

function neonBackend(): Backend {
  const make = (url: string) => createAuthClient(url);
  let instance: ReturnType<typeof make> | null = null;
  const get = () => {
    if (!AUTH_URL) {
      throw new Error('VITE_NEON_AUTH_URL was not set when this app was built, so sign-in has nowhere to go.');
    }
    return (instance ??= make(AUTH_URL));
  };
  return {
    async remembered() {
      return readUser();
    },
    // With no connection the session cannot be checked, so the last signed-in user keeps the library and
    // downloaded songs reachable. Requests that need the server still fail until the connection is back.
    async session() {
      if (navigator.onLine === false) return readUser();
      try {
        const { data, error } = await get().getSession();
        if (data?.user) {
          const user = toUser(data.user);
          writeUser(user);
          return user;
        }
        const status = (error as { status?: number } | null)?.status;
        return error && !status ? readUser() : null;
      } catch {
        return readUser();
      }
    },
    async signIn(email, password) {
      const { data, error } = await get().signIn.email({ email, password });
      if (error || !data?.user) fail(error, 'Could not sign in');
      const user = toUser(data.user);
      writeUser(user);
      return user;
    },
    async signUp(name, email, password) {
      const { data, error } = await get().signUp.email({ email, password, name });
      if (error || !data?.user) fail(error, 'Could not create the account');
      const user = toUser(data.user);
      writeUser(user);
      return user;
    },
    async signOut() {
      writeUser(null);
      await get().signOut();
    },
    async token() {
      try {
        const { data } = await get().token();
        return data?.token ?? null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * The Android app signs in over native HTTP and keeps the session cookie itself. The web view treats Neon Auth's
 * cookie as a third-party cookie and drops it, which used to sign people out every time the app closed.
 */
function nativeBackend(): Backend {
  const COOKIE = '__Secure-neon-auth.session_token';
  const SESSION_KEY = 'blank.session';
  let jwt: { value: string; expires: number } | null = null;

  const stored = async () => (await Preferences.get({ key: SESSION_KEY })).value;
  const store = async (value: string | null) => {
    jwt = null;
    if (value) await Preferences.set({ key: SESSION_KEY, value });
    else await Preferences.remove({ key: SESSION_KEY });
  };

  const header = (response: HttpResponse, name: string): string | null => {
    const key = Object.keys(response.headers).find((item) => item.toLowerCase() === name);
    const value = key ? (response.headers[key] as string | string[] | undefined) : undefined;
    return Array.isArray(value) ? value.join(', ') : (value ?? null);
  };

  const cookieFrom = (response: HttpResponse): string | null => {
    const match = new RegExp(`${COOKIE}=([^;,\\s]+)`).exec(header(response, 'set-cookie') ?? '');
    return match?.[1] ?? null;
  };

  const rememberJwt = (response: HttpResponse) => {
    const value = header(response, 'set-auth-jwt');
    if (!value) return;
    let expires = Date.now() + 10 * 60 * 1000;
    try {
      const payload = JSON.parse(atob(value.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
      if (payload.exp) expires = payload.exp * 1000;
    } catch {
      /* keep the short default */
    }
    jwt = { value, expires };
  };

  const call = (method: 'GET' | 'POST', path: string, cookie?: string | null, data?: unknown) =>
    CapacitorHttp.request({
      url: `${AUTH_URL}${path}`,
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}) },
      data,
      responseType: 'json',
      connectTimeout: 15000,
      readTimeout: 20000,
    });

  const finish = async (response: HttpResponse, fallback: string): Promise<AuthUser> => {
    const body = response.data as { user?: { id: string; name?: string; email?: string }; message?: string } | null;
    const cookie = cookieFrom(response);
    if (response.status >= 400 || !body?.user || !cookie) {
      throw new Error(response.status === 401 || response.status === 400 ? body?.message || fallback : fallback);
    }
    await store(cookie);
    const user = toUser(body.user);
    writeUser(user);
    return user;
  };

  return {
    async remembered() {
      return readUser();
    },
    async session() {
      const cookie = await stored();
      if (!cookie) return null;
      try {
        const response = await call('GET', '/get-session', cookie);
        const body = response.data as { user?: { id: string; name?: string; email?: string } } | null;
        if (response.status === 200 && body?.user) {
          const refreshed = cookieFrom(response);
          if (refreshed && refreshed !== cookie) await store(refreshed);
          rememberJwt(response);
          const user = toUser(body.user);
          writeUser(user);
          return user;
        }
        if (response.status >= 500) return readUser();
        await store(null);
        return null;
      } catch {
        return readUser();
      }
    },
    async signIn(email, password) {
      const response = await call('POST', '/sign-in/email', null, { email, password }).catch(() => {
        throw new Error('Could not reach the server');
      });
      return finish(response, 'Could not sign in');
    },
    async signUp(name, email, password) {
      const response = await call('POST', '/sign-up/email', null, { email, password, name }).catch(() => {
        throw new Error('Could not reach the server');
      });
      return finish(response, 'Could not create the account');
    },
    async signOut() {
      const cookie = await stored();
      await store(null);
      writeUser(null);
      if (cookie) await call('POST', '/sign-out', cookie, {}).catch(() => undefined);
    },
    async token(force) {
      if (!force && jwt && jwt.expires - Date.now() > 60_000) return jwt.value;
      const cookie = await stored();
      if (!cookie) return null;
      try {
        const response = await call('GET', '/get-session', cookie);
        if (response.status !== 200) return null;
        rememberJwt(response);
        return jwt?.value ?? null;
      } catch {
        return null;
      }
    },
  };
}

// Dev-only stand-in so the UI can run against `npm run dev:api` with no Neon project.
function localBackend(): Backend {
  const key = 'blank.devUser';
  const read = (): AuthUser | null => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      return null;
    }
  };
  const write = (user: AuthUser) => {
    localStorage.setItem(key, JSON.stringify(user));
    return user;
  };
  const idFor = (email: string) => email.toLowerCase().replace(/[^a-z0-9]/g, '_');
  return {
    session: async () => (localStorage.getItem('blank.devExpired') ? null : read()),
    remembered: async () => read(),
    signIn: async (email) => write({ id: idFor(email), name: email.split('@')[0] ?? 'You', email }),
    signUp: async (name, email) => write({ id: idFor(email), name, email }),
    signOut: async () => localStorage.removeItem(key),
    token: async () => {
      const user = localStorage.getItem('blank.devExpired') ? null : read();
      return user ? `dev:${user.id}` : null;
    },
  };
}

let backend: Backend | null = null;

export function auth(): Backend {
  backend ??= LOCAL_AUTH ? localBackend() : Capacitor.isNativePlatform() ? nativeBackend() : neonBackend();
  return backend;
}
