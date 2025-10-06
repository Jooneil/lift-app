import { useState } from "react";
import { api } from "./api";
import { supabase } from "./supabaseClient";

export default function Auth({ onAuthed }: { onAuthed: (u:{id:number,username:string})=>void }) {
  const [mode, setMode] = useState<'login'|'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string|null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (mode === 'register') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const access = data.session?.access_token;
      if (!access) throw new Error('No access token');
      const me = await api.supaSession(access);
      onAuthed(me);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 360, margin: "40px auto", padding: 16, border: "1px solid #444", borderRadius: 12 }}>
      <h2>{mode === 'login' ? 'Sign In' : 'Sign Up'}</h2>
      <form onSubmit={submit}>
        <div style={{ display: "grid", gap: 8 }}>
          <input placeholder="email" type="email" value={email} onChange={(e)=>setEmail(e.target.value)} style={{ padding: 8 }} />
          <input placeholder="password" type="password" value={password} onChange={(e)=>setPassword(e.target.value)} style={{ padding: 8 }} />
          {err && <div style={{ color: 'tomato' }}>{err}</div>}
          <button type="submit" style={{ padding: 10 }} disabled={busy}>{busy ? 'Please wait...' : (mode === 'login' ? 'Sign In' : 'Sign Up')}</button>
        </div>
      </form>
      <div style={{ marginTop: 8 }}>
        {mode === 'login'
          ? <button onClick={()=>setMode('register')}>Need an account? Sign Up</button>
          : <button onClick={()=>setMode('login')}>Have an account? Sign In</button>}
      </div>
    </div>
  );
}
