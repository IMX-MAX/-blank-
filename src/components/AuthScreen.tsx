import { useState, type FormEvent } from 'react';
import { errorMessage } from '../lib/format';
import { useAuth } from '../state/AuthProvider';

export function AuthScreen() {
  const { saveName } = useAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      saveName(name);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h1>[blank]</h1>
        <p>Your music, kept on this device.</p>
        <input
          autoComplete="name"
          placeholder="Your name"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          required
        />
        {error ? <p className="form-error">{error}</p> : null}
        <button className="white-btn" type="submit" disabled={!name.trim()}>
          Create profile
        </button>
      </form>
    </div>
  );
}
