import { useState } from 'react';
import { api, ApiError, type User } from './api.js';
import { Icon } from './icons.js';

export function AuthGate({ onAuth }: { onAuth: (u: User) => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const user =
        mode === 'in'
          ? await api.login(email, password)
          : await api.register(email, name, password);
      onAuth(user);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Something went wrong');
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-aside">
        <div className="auth-aside-inner">
          <div className="brandmark"><Icon name="logo" size={26} strokeWidth={1.2} /><span>Guide Studio</span></div>
          <h1 className="serif">Press-ready pocket guides,<br />assembled with intent.</h1>
          <p className="muted">Pick businesses, give each a size, and a beautifully laid-out guide appears — map included. Then take precise control of every element on a true-to-print canvas.</p>
          <div className="auth-aside-foot eyebrow">An in-house instrument · Atelier North</div>
        </div>
      </div>

      <div className="auth-main">
        <form className="auth-card pop" onSubmit={submit}>
          <div className="seg auth-seg">
            <button type="button" className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>Sign in</button>
            <button type="button" className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')}>Create account</button>
          </div>

          <div className="auth-fields">
            {mode === 'up' && (
              <div className="field">
                <label>Name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Wynn Ashcombe" autoComplete="name" required />
              </div>
            )}
            <div className="field">
              <label>Email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@atelier.studio" autoComplete="email" required />
            </div>
            <div className="field">
              <label>Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required minLength={6} />
            </div>
          </div>

          {err && <div className="auth-err"><Icon name="alert" size={14} /> {err}</div>}

          <button className="btn accent auth-submit" disabled={busy}>
            {busy ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Create account'}
            <Icon name="chevron" size={14} />
          </button>
          <p className="faint auth-note">
            {mode === 'up' ? 'The first account created becomes the studio owner.' : 'Welcome back.'}
          </p>
        </form>
      </div>
    </div>
  );
}
