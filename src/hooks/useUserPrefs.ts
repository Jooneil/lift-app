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
      const next = await upsertUserPrefs({
        last_plan_server_id: (partial as { last_plan_server_id?: string|null }).last_plan_server_id ?? null,
        last_week_id: (partial as { last_week_id?: string|null }).last_week_id ?? null,
        last_day_id: (partial as { last_day_id?: string|null }).last_day_id ?? null,
      })
      setPrefs(next)
      return next
    },
  }
}
