import { useMemo } from 'react';
import type { CatalogExercise, SearchSource } from '../../types';

export type EquipFilter = 'machine' | 'free_weight' | 'cable' | 'body_weight';

export type FilterState = {
  search: string;
  muscle: string;
  equipment: EquipFilter[];
  compoundOnly: boolean;
  source: SearchSource;
};

export const EMPTY_FILTERS: FilterState = {
  search: '',
  muscle: 'All',
  equipment: [],
  compoundOnly: false,
  source: 'all',
};

export function filterCount(f: FilterState): number {
  let n = 0;
  if (f.muscle !== 'All') n++;
  n += f.equipment.length;
  if (f.compoundOnly) n++;
  if (f.source !== 'all') n++;
  return n;
}

function norm(s: string) {
  return s.toLowerCase().trim();
}

export type GroupedResults = Array<{ muscle: string; exercises: CatalogExercise[] }>;

export function useExerciseFilters(
  exercises: CatalogExercise[],
  filters: FilterState,
) {
  return useMemo(() => {
    const q = norm(filters.search);

    const filtered = exercises.filter((ex) => {
      if (q && !norm(ex.name).includes(q)) return false;
      if (filters.muscle !== 'All' && norm(ex.primaryMuscle) !== norm(filters.muscle)) return false;
      if (filters.equipment.length > 0) {
        const hasEquip =
          (filters.equipment.includes('machine') && ex.machine) ||
          (filters.equipment.includes('free_weight') && ex.freeWeight) ||
          (filters.equipment.includes('cable') && ex.cable) ||
          (filters.equipment.includes('body_weight') && ex.bodyWeight);
        if (!hasEquip) return false;
      }
      if (filters.compoundOnly && !ex.isCompound) return false;
      if (filters.source === 'defaults' && ex.isCustom) return false;
      if (filters.source === 'home_made' && !ex.isCustom) return false;
      return true;
    });

    // Group by primaryMuscle, sorted alphabetically
    const groups = new Map<string, CatalogExercise[]>();
    for (const ex of filtered) {
      const m = ex.primaryMuscle || 'Other';
      if (!groups.has(m)) groups.set(m, []);
      groups.get(m)!.push(ex);
    }
    const grouped: GroupedResults = Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([muscle, exs]) => ({
        muscle,
        exercises: [...exs].sort((a, b) => a.name.localeCompare(b.name)),
      }));

    return { filtered, grouped };
  }, [exercises, filters]);
}
