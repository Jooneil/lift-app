import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { getUserPrefs, upsertUserPrefs } from '../api/userPrefs'
import type { UserPrefs } from '../api/userPrefs'

export function useUserPrefs() {
  const [prefs, setPrefs] = useState<UserPrefs | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const p = await getUserPrefs()
      setPrefs(p)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
      setPrefs(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    const { data: sub } = supabase.auth.onAuthStateChange(() => refresh())
    return () => sub.subscription.unsubscribe()
  }, [])

  return {
    prefs,
    loading,
    error,
    refresh,
    upsert: async (partial: Partial<UserPrefs>) => {
      const next = await upsertUserPrefs(partial)
      setPrefs(next)
      return next
    },
  }
}
