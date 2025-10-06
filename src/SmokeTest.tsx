import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

export default function SmokeTest() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [plans, setPlans] = useState<Array<{ id: string; name: string }> | null>(null)

  // show current user on load
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser()
      setStatus(data.user ? `Signed in as ${data.user.email}` : 'Not signed in')
    })()
  }, [])

  async function handleSignUp() {
    setStatus('Signing up…')
    const { error } = await supabase.auth.signUp({ email, password })
    setStatus(error ? `Sign-up error: ${error.message}` : 'Sign-up OK (check inbox if email confirm is on)')
  }

  async function handleSignIn() {
    setStatus('Signing in…')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    setStatus(error ? `Sign-in error: ${error.message}` : `Signed in as ${data.user?.email}`)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    setStatus('Signed out')
    setPlans(null)
  }

  async function createPlan() {
    setStatus('Creating plan…')
    const { error } = await supabase.from('plans').insert([{ name: 'Push/Pull/Legs' }])
    setStatus(error ? `Create error: ${error.message}` : 'Plan created')
  }

  async function fetchPlans() {
    setStatus('Loading plans…')
    const { data, error } = await supabase
      .from('plans')
      .select('id,name')
      .order('name', { ascending: true })
    if (error) setStatus(`Read error: ${error.message}`)
    else {
      setPlans(data ?? [])
      setStatus(`Loaded ${data?.length ?? 0} plan(s)`)
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '40px auto', display: 'grid', gap: 12 }}>
      <h2>Supabase Smoke Test</h2>
      <div style={{ display: 'grid', gap: 8 }}>
        <input placeholder="email" value={email} onChange={e => setEmail(e.target.value)} />
        <input placeholder="password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={handleSignUp}>Sign up</button>
          <button onClick={handleSignIn}>Sign in</button>
          <button onClick={handleSignOut}>Sign out</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={createPlan}>Create “Push/Pull/Legs” plan</button>
        <button onClick={fetchPlans}>Fetch my plans</button>
      </div>

      {status && <p><b>Status:</b> {status}</p>}

      {plans && (
        <div>
          <b>Plans</b>
          <ul>
            {plans.map(p => <li key={p.id}>{p.name} — {p.id}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
