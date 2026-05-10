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

const norm = (s: string) => s.trim().toLowerCase();

export async function getProfileStats(): Promise<ProfileStats> {
  const [allSessions, { data: { user } }] = await Promise.all([
    sessionApi.listAll(),
    supabase.auth.getUser(),
  ]);

  const real = allSessions.filter((r) => r.data && !r.data.ghostSeed);
  const totalSessions = real.length;
  const totalSets = real.reduce((acc, row) =>
    acc + (row.data?.entries ?? []).reduce((ea, entry) =>
      ea + entry.sets.filter((s) => s.weight != null && s.reps != null).length, 0), 0);

  const totalVolume = real.reduce((acc, row) =>
    acc + (row.data?.entries ?? []).reduce((ea, entry) =>
      ea + entry.sets
        .filter((s) => s.weight != null && s.reps != null)
        .reduce((sv, s) => sv + s.weight! * s.reps!, 0), 0), 0);

  return { totalSessions, totalSets, totalVolume, memberSince: user?.created_at ?? null };
}

export async function getPersonalRecords(): Promise<PR[]> {
  const allSessions = await sessionApi.listAll();
  const real = allSessions.filter((r) => r.data && !r.data.ghostSeed);

  const prMap = new Map<string, PR>();
  for (const row of real) {
    for (const entry of row.data?.entries ?? []) {
      for (const set of entry.sets) {
        if (set.weight == null || set.reps == null || set.weight === 0) continue;
        const key = norm(entry.exerciseName);
        const current = prMap.get(key);
        if (!current || set.weight > current.weight) {
          prMap.set(key, { exerciseName: entry.exerciseName, weight: set.weight, reps: set.reps });
        }
      }
    }
  }

  return Array.from(prMap.values()).sort((a, b) => b.weight - a.weight);
}
