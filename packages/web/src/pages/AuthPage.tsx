import { useState, type FormEvent } from 'react';
import { errorMessage } from '../errors.js';
import { useSession } from '../session.js';

export function AuthPage() {
  const { login, register } = useSession();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await (mode === 'login' ? login(username.trim(), password) : register(username.trim(), password));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <h1>Card Game</h1>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
          Log in
        </button>
        <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
          Create account
        </button>
      </div>
      <form onSubmit={submit} className="panel" data-testid="auth-form">
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required data-testid="username" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            data-testid="password"
          />
        </label>
        {mode === 'register' && (
          <p className="muted small">Username: 3–20 letters, digits or underscores. Password: at least 10 characters.</p>
        )}
        {error && (
          <p className="error" role="alert" data-testid="auth-error">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy} data-testid="auth-submit">
          {mode === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>
    </main>
  );
}
