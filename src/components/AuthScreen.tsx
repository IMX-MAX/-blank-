import { useState, type FormEvent } from 'react';
import { errorMessage } from '../lib/format';
import { useAuth } from '../state/AuthProvider';

export function AuthScreen() {
  const { signIn, signUp, offlineUser, continueOffline } = useAuth();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'up') await signUp(name.trim(), email.trim(), password);
      else await signIn(email.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h1>[blank]</h1>
        <p>Your music, in one place.</p>
        {mode === 'up' ? (
          <input
            autoComplete="name"
            placeholder="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        ) : null}
        <input
          type="email"
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <input
          type="password"
          autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
          placeholder="Password"
          value={password}
          minLength={8}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        {error ? <p className="form-error">{error}</p> : null}
        <button className="white-btn" type="submit" disabled={busy}>
          {busy ? 'Please wait' : mode === 'up' ? 'Create account' : 'Continue'}
        </button>
        <button
          type="button"
          className="text-btn"
          onClick={() => {
            setMode(mode === 'up' ? 'in' : 'up');
            setError('');
          }}
        >
          {mode === 'up' ? 'I already have an account' : 'Create an account'}
        </button>
        {offlineUser ? (
          <button type="button" className="text-btn" onClick={continueOffline}>
            Play downloaded songs
          </button>
        ) : null}
      </form>
    </div>
  );
}
