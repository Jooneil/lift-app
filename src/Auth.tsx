import { useEffect, useState } from "react";
// no direct API calls needed for auth
import { supabase } from "./supabaseClient";
import { Button } from "./components";

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
    <div className="max-w-[380px] mx-auto mt-[60px] p-6 bg-elevated border border-subtle rounded-lg shadow-modal">
      <h2 className="mt-0 mb-7 text-center text-[22px] font-bold tracking-[-0.02em]">
        {mode === 'login'
          ? 'Sign In'
          : mode === 'register'
            ? 'Sign Up'
            : mode === 'forgot'
              ? 'Reset Password'
              : 'Set New Password'}
      </h2>
      <form onSubmit={submit}>
        <div className="grid gap-3">
          {mode !== 'reset' && (
            <input
              placeholder="Email"
              type="email"
              value={email}
              onChange={(e)=>setEmail(e.target.value)}
            />
          )}
          {(mode === 'login' || mode === 'register' || mode === 'reset') && (
            <input
              placeholder={mode === 'reset' ? 'New password' : 'Password'}
              type="password"
              value={password}
              onChange={(e)=>setPassword(e.target.value)}
            />
          )}
          {mode === 'reset' && (
            <input
              placeholder="Confirm new password"
              type="password"
              value={confirmPassword}
              onChange={(e)=>setConfirmPassword(e.target.value)}
            />
          )}
          {err && (
            <div className="text-error px-3 py-2.5 bg-error-muted rounded-sm text-sm">{err}</div>
          )}
          {message && (
            <div className="text-success px-3 py-2.5 bg-success-muted rounded-sm text-sm">{message}</div>
          )}
          <Button
            type="submit"
            variant="primary"
            block
            className="mt-2 text-base"
            style={{
              padding: '14px 16px',
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
          </Button>
        </div>
      </form>
      <div className="mt-4 flex flex-col gap-2">
        {mode === 'login' && (
          <>
            <Button
              onClick={()=>setMode('register')}
              variant="ghost"
              className="text-sm"
            >Need an account? Sign Up</Button>
            <Button
              onClick={()=>setMode('forgot')}
              variant="ghost"
              className="text-[13px] text-muted"
            >Forgot password?</Button>
          </>
        )}
        {mode === 'register' && (
          <Button
            onClick={()=>setMode('login')}
            variant="ghost"
            className="text-sm"
          >Have an account? Sign In</Button>
        )}
        {(mode === 'forgot' || mode === 'reset') && !isForcedReset && (
          <Button
            onClick={()=>setMode('login')}
            variant="ghost"
            className="text-sm"
          >Back to Sign In</Button>
        )}
      </div>
    </div>
  );
}
