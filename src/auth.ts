export type AuthUser = {
  id: string;
  name: string;
};

const KEY = 'blank.profile';

function read(): AuthUser | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { name?: string } | null;
    return raw?.name ? { id: 'local', name: raw.name } : null;
  } catch {
    return null;
  }
}

/** The profile is just a name kept on this device. There is no account to sign in to. */
export const profile = {
  read,
  save(name: string): AuthUser {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Enter a name');
    localStorage.setItem(KEY, JSON.stringify({ name: trimmed }));
    return { id: 'local', name: trimmed };
  },
};
