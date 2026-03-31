// Stale-while-revalidate cache helper
// Returns cached data instantly if available and fresh, then refreshes in the background.
export function cachedFetch<T>(key: string, fetcher: () => Promise<T>, ttlMs: number): Promise<T> {
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

export function invalidateCache(...keys: string[]) {
  for (const k of keys) localStorage.removeItem(k);
}

export const CACHE_KEYS = {
  plans: 'cache:plans',
  exercises: 'cache:exercises',
  customExercises: 'cache:custom_exercises',
  catalog: 'cache:exercise_catalog',
  userPrefs: 'cache:user_prefs',
} as const;
