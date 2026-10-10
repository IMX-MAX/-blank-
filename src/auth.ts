import { createAuthClient } from '@neondatabase/auth';
import { AUTH_URL, LOCAL_AUTH } from './config';

export type AuthUser = { id: string; name: string; email: string };

type Backend = {
  session(): Promise<AuthUser | null>;
  signIn(email: string, password: string): Promise<AuthUser>;
  signUp(name: string, email: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  token(): Promise<string | null>;
};

type Failure = { message?: string } | null | undefined;

function fail(error: Failure, fallback: string): never {
  throw new Error(error?.message || fallback);
}

function toUser(raw: { id: string; name?: string | null; email?: string | null }): AuthUser {
  return { id: raw.id, name: raw.name?.trim() || raw.email?.split('@')[0] || 'You', email: raw.email ?? '' };
}

const REMEMBERED = 'blank.lastUser';

function remembered(): AuthUser | null {
  try {
    return JSON.parse(localStorage.getItem(REMEMBERED) ?? 'null');
  } catch {
    return null;
  }
}

function remember(user: AuthUser | null) {
  try {
    if (user) localStorage.setItem(REMEMBERED, JSON.stringify(user));
    else localStorage.removeItem(REMEMBERED);
  } catch {
    /* private mode: offline sign-in is simply not remembered */
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
    // With no connection the session cannot be checked, so the last signed-in user keeps the library and
    // downloaded songs reachable. Requests that need the server still fail until the connection is back.
    async session() {
      if (navigator.onLine === false) return remembered();
      try {
        const { data, error } = await get().getSession();
        if (data?.user) {
          const user = toUser(data.user);
          remember(user);
          return user;
        }
        const status = (error as { status?: number } | null)?.status;
        if (error && !status) return remembered();
        remember(null);
        return null;
      } catch {
        return remembered();
      }
    },
    async signIn(email, password) {
      const { data, error } = await get().signIn.email({ email, password });
      if (error || !data?.user) fail(error, 'Could not sign in');
      const user = toUser(data.user);
      remember(user);
      return user;
    },
    async signUp(name, email, password) {
      const { data, error } = await get().signUp.email({ email, password, name });
      if (error || !data?.user) fail(error, 'Could not create the account');
      const user = toUser(data.user);
      remember(user);
      return user;
    },
    async signOut() {
      remember(null);
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
    session: async () => read(),
    signIn: async (email) => write({ id: idFor(email), name: email.split('@')[0] ?? 'You', email }),
    signUp: async (name, email) => write({ id: idFor(email), name, email }),
    signOut: async () => localStorage.removeItem(key),
    token: async () => {
      const user = read();
      return user ? `dev:${user.id}` : null;
    },
  };
}

let backend: Backend | null = null;

export function auth(): Backend {
  backend ??= LOCAL_AUTH ? localBackend() : neonBackend();
  return backend;
}
