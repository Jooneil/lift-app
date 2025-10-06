import { supabase } from '../supabaseClient'

export type UserPrefs = {
  user_id: string
  last_plan_server_id?: number | null
  last_week_id?: string | null
  last_day_id?: string | null
  prefs?: Record<string, unknown> | null
}

export async function getUserPrefs() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')

  const { data, error } = await supabase
    .from('user_prefs')
    .select('user_id,last_plan_server_id,last_week_id,last_day_id,prefs')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) throw error
  return (data as UserPrefs) || null
}

export async function upsertUserPrefs(partial: {
  last_plan_server_id?: number | null
  last_week_id?: string | null
  last_day_id?: string | null
}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')

  const payload = { user_id: user.id, ...partial }

  const { data, error } = await supabase
    .from('user_prefs')
    .upsert(payload, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) throw error
  return data as UserPrefs
}
