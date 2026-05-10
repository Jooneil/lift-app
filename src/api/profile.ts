import { supabase } from '../supabaseClient';
import { sessionApi } from '../api';

export type ProfileStats = {
  totalSessions: number;
  totalSets: number;
  totalVolume: number;
  memberSince: string | null;
};

export type PR = {
  exerciseName: string;
  weight: number;
  reps: number;
};

export type ProfileData = {
  stats: ProfileStats;
  prs: PR[];
};

const norm = (s: string) => s.trim().toLowerCase();

export async function getProfileData(): Promise<ProfileData> {
  const [allSessions, { data: { user } }] = await Promise.all([
    sessionApi.listAll(),
    supabase.auth.getUser(),
  ]);

  const real = allSessions.filter((r) => r.data && !r.data.ghostSeed);

  let totalSets = 0;
  let totalVolume = 0;
  const prMap = new Map<string, PR>();

  for (const row of real) {
    for (const entry of row.data?.entries ?? []) {
      for (const set of entry.sets) {
        if (set.weight == null || set.reps == null) continue;
        totalSets++;
        totalVolume += set.weight * set.reps;
        if (set.weight === 0) continue;
        const key = norm(entry.exerciseName);
        const current = prMap.get(key);
        if (!current || set.weight > current.weight) {
          prMap.set(key, { exerciseName: entry.exerciseName, weight: set.weight, reps: set.reps });
        }
      }
    }
  }

  return {
    stats: {
      totalSessions: real.length,
      totalSets,
      totalVolume,
      memberSince: user?.created_at ?? null,
    },
    prs: Array.from(prMap.values()).sort((a, b) => b.weight - a.weight),
  };
}
