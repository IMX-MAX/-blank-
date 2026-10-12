import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { profile, type AuthUser } from '../auth';

type AuthContextValue = {
  user: AuthUser | null;
  saveName: (name: string) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => profile.read());
  const saveName = useCallback((name: string) => setUser(profile.save(name)), []);
  const value = useMemo(() => ({ user, saveName }), [user, saveName]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
