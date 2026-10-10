import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { auth, SESSION_EXPIRED, type AuthUser } from '../auth';
import { listOffline } from '../lib/offline';

type AuthContextValue = {
  user: AuthUser | null;
  ready: boolean;
  offlineUser: AuthUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  continueOffline: () => void;
  leaveOffline: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function downloadedUser(): Promise<AuthUser | null> {
  try {
    const remembered = await auth().remembered();
    if (!remembered) return null;
    const saved = await listOffline();
    return saved.length > 0 ? { ...remembered, stale: true } : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [offlineUser, setOfflineUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: AuthUser | null = null;
      try {
        next = await auth().session();
      } catch {
        next = null;
      }
      const fallback = next ? null : await downloadedUser();
      if (cancelled) return;
      setUser(next ?? fallback);
      setOfflineUser(fallback);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const expired = () => {
      const current = userRef.current;
      if (!current || current.stale) return;
      void downloadedUser().then((fallback) => {
        setOfflineUser(fallback);
        setUser(fallback);
      });
    };
    window.addEventListener(SESSION_EXPIRED, expired);
    return () => window.removeEventListener(SESSION_EXPIRED, expired);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setUser(await auth().signIn(email, password));
    setOfflineUser(null);
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    setUser(await auth().signUp(name, email, password));
    setOfflineUser(null);
  }, []);

  const signOut = useCallback(async () => {
    await auth().signOut();
    setUser(null);
    setOfflineUser(null);
  }, []);

  const continueOffline = useCallback(() => {
    setOfflineUser((fallback) => {
      if (fallback) setUser(fallback);
      return fallback;
    });
  }, []);

  const leaveOffline = useCallback(() => setUser(null), []);

  const value = useMemo(
    () => ({ user, ready, offlineUser, signIn, signUp, signOut, continueOffline, leaveOffline }),
    [user, ready, offlineUser, signIn, signUp, signOut, continueOffline, leaveOffline],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
