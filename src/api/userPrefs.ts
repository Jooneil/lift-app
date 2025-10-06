import { supabase } from '../supabaseClient'

export type UserPrefs = {
  user_id: string
  last_plan_server_id?: string | null
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
  last_plan_server_id?: string | null
  last_week_id?: string | null
  last_day_id?: string | null
}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')

  // Write only to prefs JSON to avoid column type mismatches
  const prefs: Record<string, unknown> = {
    last_plan_server_id: typeof partial.last_plan_server_id === 'string' || partial.last_plan_server_id === null ? partial.last_plan_server_id : null,
    last_week_id: typeof partial.last_week_id === 'string' || partial.last_week_id === null ? partial.last_week_id : null,
    last_day_id: typeof partial.last_day_id === 'string' || partial.last_day_id === null ? partial.last_day_id : null,
  }
  // Try update-first: if a row exists for this user, update it; otherwise insert.
  const upd = await supabase
    .from('user_prefs')
    .update({ prefs })
    .eq('user_id', user.id)
    .select()
    .maybeSingle()
  if (upd.error && upd.error.code && upd.error.code !== 'PGRST116') {
    // unexpected error
    throw upd.error
  }
  if (upd.data) return upd.data as UserPrefs

  // No row updated; insert one
  const ins = await supabase
    .from('user_prefs')
    .insert([{ user_id: user.id, prefs }])
    .select()
    .single()
  if (ins.error) {
    // If a concurrent insert or existing row caused conflict, try update again
    const code = (ins.error as { code?: string }).code
    if (code === '23505' || code === '409' || ins.error.message.toLowerCase().includes('conflict')) {
      const retry = await supabase
        .from('user_prefs')
        .update({ prefs })
        .eq('user_id', user.id)
        .select()
        .maybeSingle()
      if (retry.error) throw retry.error
      if (retry.data) return retry.data as UserPrefs
    }
    throw ins.error
  }
  return ins.data as UserPrefs
}
