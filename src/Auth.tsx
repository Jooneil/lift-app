import { useEffect, useState } from "react";
// no direct API calls needed for auth
import { supabase } from "./supabaseClient";

type AuthMode = 'login' | 'register' | 'forgot' | 'reset';

export default function Auth({
  onAuthed,
  forceMode,
  onResetComplete,
}: {
  onAuthed: (u: { id: number; username: string }) => void;
  forceMode?: AuthMode;
  onResetComplete?: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [err, setErr] = useState<string|null>(null);
  const [message, setMessage] = useState<string|null>(null);
  const [busy, setBusy] = useState(false);
  const isForcedReset = forceMode === 'reset';

  useEffect(() => {
    if (forceMode) setMode(forceMode);
  }, [forceMode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMessage(null);
    setBusy(true);
    try {
      if (mode === 'forgot') {
        if (!email.trim()) throw new Error('Enter your email.');
        const redirectTo = typeof window !== 'undefined'
          ? `${window.location.origin}?reset=1`
          : undefined;
        const { error } = await supabase.auth.resetPasswordForEmail(
          email,
          redirectTo ? { redirectTo } : undefined
        );
        if (error) throw error;
        setMessage('Check your email for a reset link.');
        return;
      }
      if (mode === 'reset') {
        if (!password) throw new Error('Enter a new password.');
        if (password !== confirmPassword) throw new Error('Passwords do not match.');
        const { data, error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        const userEmail = data.user?.email || email || 'user';
        onResetComplete?.();
        onAuthed({ id: 0, username: userEmail });
        setMessage('Password updated.');
        return;
      }
      if (mode === 'register') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const userEmail = data.user?.email || email;
      onAuthed({ id: 0, username: userEmail });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      maxWidth: 380,
      margin: "60px auto",
      padding: 24,
      background: "var(--bg-elevated)",
      border: "1px solid var(--border-subtle)",
      borderRadius: 16,
      boxShadow: "var(--shadow-lg)"
    }}>
      <h2 style={{ marginTop: 0, marginBottom: 24, textAlign: 'center', fontSize: 24, fontWeight: 600 }}>
        {mode === 'login'
          ? 'Sign In'
          : mode === 'register'
            ? 'Sign Up'
            : mode === 'forgot'
              ? 'Reset Password'
              : 'Set New Password'}
      </h2>
      <form onSubmit={submit}>
        <div style={{ display: "grid", gap: 12 }}>
          {mode !== 'reset' && (
            <input
              placeholder="Email"
              type="email"
              value={email}
              onChange={(e)=>setEmail(e.target.value)}
              style={{
                padding: '12px 14px',
                borderRadius: 10,
                border: '1px solid var(--border-default)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: 16,
              }}
            />
          )}
          {(mode === 'login' || mode === 'register' || mode === 'reset') && (
            <input
              placeholder={mode === 'reset' ? 'New password' : 'Password'}
              type="password"
              value={password}
              onChange={(e)=>setPassword(e.target.value)}
              style={{
                padding: '12px 14px',
                borderRadius: 10,
                border: '1px solid var(--border-default)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: 16,
              }}
            />
          )}
          {mode === 'reset' && (
            <input
              placeholder="Confirm new password"
              type="password"
              value={confirmPassword}
              onChange={(e)=>setConfirmPassword(e.target.value)}
              style={{
                padding: '12px 14px',
                borderRadius: 10,
                border: '1px solid var(--border-default)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: 16,
              }}
            />
          )}
          {err && (
            <div style={{
              color: '#f88',
              padding: '10px 12px',
              background: 'rgba(255, 136, 136, 0.1)',
              borderRadius: 8,
              fontSize: 14
            }}>{err}</div>
          )}
          {message && (
            <div style={{
              color: 'var(--success)',
              padding: '10px 12px',
              background: 'var(--success-muted)',
              borderRadius: 8,
              fontSize: 14
            }}>{message}</div>
          )}
          <button
            type="submit"
            style={{
              padding: '14px 16px',
              marginTop: 8,
              borderRadius: 10,
              border: '1px solid var(--border-strong)',
              background: 'var(--text-primary)',
              color: 'var(--bg-base)',
              fontWeight: 600,
              fontSize: 16,
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.7 : 1,
            }}
            disabled={busy}
          >
            {busy
              ? 'Please wait...'
              : mode === 'login'
                ? 'Sign In'
                : mode === 'register'
                  ? 'Sign Up'
                  : mode === 'forgot'
                    ? 'Send Reset Link'
                    : 'Update Password'}
          </button>
        </div>
      </form>
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {mode === 'login' && (
          <>
            <button
              onClick={()=>setMode('register')}
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >Need an account? Sign Up</button>
            <button
              onClick={()=>setMode('forgot')}
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                border: 'none',
                background: 'transparent',
                color: 'var(--text-muted)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >Forgot password?</button>
          </>
        )}
        {mode === 'register' && (
          <button
            onClick={()=>setMode('login')}
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid var(--border-subtle)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >Have an account? Sign In</button>
        )}
        {(mode === 'forgot' || mode === 'reset') && !isForcedReset && (
          <button
            onClick={()=>setMode('login')}
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid var(--border-subtle)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >Back to Sign In</button>
        )}
      </div>
    </div>
  );
}
