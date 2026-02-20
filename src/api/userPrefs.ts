import { supabase } from '../supabaseClient'
import { CACHE_KEYS } from '../api'

function cachedFetch<T>(key: string, fetcher: () => Promise<T>, ttlMs: number): Promise<T> {
  const raw = localStorage.getItem(key);
  if (raw) {
    try {
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts < ttlMs) {
        fetcher().then(fresh => {
          try { localStorage.setItem(key, JSON.stringify({ data: fresh, ts: Date.now() })); } catch { /* quota */ }
        }).catch(() => {});
        return Promise.resolve(data as T);
      }
    } catch { /* corrupt cache, fall through */ }
  }
  return fetcher().then(data => {
    try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch { /* quota */ }
    return data;
  });
}

// Streak types
export type StreakScheduleMode = 'daily' | 'rolling' | 'weekly'

export type StreakConfig = {
  enabled: boolean
  scheduleMode: StreakScheduleMode
  rollingDaysOn?: number      // For rolling mode (e.g., 3)
  rollingDaysOff?: number     // For rolling mode (e.g., 1)
  weeklyDays?: number[]       // For weekly mode (0=Sun, 1=Mon, etc.)
  startDate: string           // ISO date when streak was configured
  timezone: string            // User's timezone for date calculations
}

export type StreakState = {
  currentStreak: number
  longestStreak: number
  lastWorkoutDate: string | null  // ISO date of last completed workout
}

export type UserPrefsData = {
  last_plan_server_id?: string | null
  last_week_id?: string | null
  last_day_id?: string | null
  streak_config?: StreakConfig | null
  streak_state?: StreakState | null
}

export type UserPrefs = {
  user_id: string
  last_plan_server_id?: string | null
  last_week_id?: string | null
  last_day_id?: string | null
  prefs?: UserPrefsData | null
}

async function _fetchUserPrefs(): Promise<UserPrefs | null> {
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

export function getUserPrefs(): Promise<UserPrefs | null> {
  return cachedFetch(CACHE_KEYS.userPrefs, _fetchUserPrefs, 30 * 60 * 1000);
}

export async function upsertUserPrefs(partial: {
  last_plan_server_id?: string | null
  last_week_id?: string | null
  last_day_id?: string | null
  streak_config?: StreakConfig | null
  streak_state?: StreakState | null
}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')

  // Fetch existing prefs to merge (don't overwrite streak data when saving nav state)
  let existingPrefs: UserPrefsData = {}
  try {
    const existing = await supabase
      .from('user_prefs')
      .select('prefs')
      .eq('user_id', user.id)
      .maybeSingle()
    if (existing.data?.prefs) {
      existingPrefs = existing.data.prefs as UserPrefsData
    }
  } catch { /* ignore - will use empty object */ }

  // Merge new values with existing prefs
  const prefs: UserPrefsData = {
    ...existingPrefs,
    ...(partial.last_plan_server_id !== undefined && { last_plan_server_id: partial.last_plan_server_id }),
    ...(partial.last_week_id !== undefined && { last_week_id: partial.last_week_id }),
    ...(partial.last_day_id !== undefined && { last_day_id: partial.last_day_id }),
    ...(partial.streak_config !== undefined && { streak_config: partial.streak_config }),
    ...(partial.streak_state !== undefined && { streak_state: partial.streak_state }),
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
  if (upd.data) { localStorage.removeItem(CACHE_KEYS.userPrefs); return upd.data as UserPrefs; }

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
      if (retry.data) { localStorage.removeItem(CACHE_KEYS.userPrefs); return retry.data as UserPrefs; }
    }
    throw ins.error
  }
  localStorage.removeItem(CACHE_KEYS.userPrefs);
  return ins.data as UserPrefs
}
