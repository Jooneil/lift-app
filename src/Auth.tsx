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
    <div style={{ maxWidth: 360, margin: "40px auto", padding: 16, border: "1px solid #444", borderRadius: 12 }}>
      <h2>
        {mode === 'login'
          ? 'Sign In'
          : mode === 'register'
            ? 'Sign Up'
            : mode === 'forgot'
              ? 'Reset Password'
              : 'Set New Password'}
      </h2>
      <form onSubmit={submit}>
        <div style={{ display: "grid", gap: 8 }}>
          {mode !== 'reset' && (
            <input placeholder="email" type="email" value={email} onChange={(e)=>setEmail(e.target.value)} style={{ padding: 8 }} />
          )}
          {(mode === 'login' || mode === 'register' || mode === 'reset') && (
            <input placeholder={mode === 'reset' ? 'new password' : 'password'} type="password" value={password} onChange={(e)=>setPassword(e.target.value)} style={{ padding: 8 }} />
          )}
          {mode === 'reset' && (
            <input placeholder="confirm new password" type="password" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} style={{ padding: 8 }} />
          )}
          {err && <div style={{ color: 'tomato' }}>{err}</div>}
          {message && <div style={{ color: '#7fc47f' }}>{message}</div>}
          <button type="submit" style={{ padding: 10 }} disabled={busy}>
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
      <div style={{ marginTop: 8 }}>
        {mode === 'login' && (
          <div style={{ display: 'grid', gap: 8 }}>
            <button onClick={()=>setMode('register')}>Need an account? Sign Up</button>
            <button onClick={()=>setMode('forgot')}>Forgot password?</button>
          </div>
        )}
        {mode === 'register' && (
          <button onClick={()=>setMode('login')}>Have an account? Sign In</button>
        )}
        {(mode === 'forgot' || mode === 'reset') && !isForcedReset && (
          <button onClick={()=>setMode('login')}>Back to Sign In</button>
        )}
      </div>
    </div>
  );
}
