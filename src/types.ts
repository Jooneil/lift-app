export type Plan = { id: string; serverId?: string; predecessorPlanId?: string; name: string; weeks: PlanWeek[]; ghostMode?: 'default' | 'full-body' };
export type PlanWeek = { id: string; name: string; days: PlanDay[] };
export type PlanDay = { id: string; name: string; items: PlanExercise[] };
export type PlanExercise = { id: string; exerciseId?: string; exerciseName: string; targetSets: number; targetReps?: string; myoReps?: boolean };
export type Exercise = { id: string; name: string };
export type CatalogExercise = {
  id: string;
  name: string;
  primaryMuscle: string;
  machine: boolean;
  freeWeight: boolean;
  cable: boolean;
  bodyWeight: boolean;
  isCompound: boolean;
  secondaryMuscles: string[];
  isCustom?: boolean;
};
export type ImportedExerciseMeta = {
  isCustom?: boolean;
  primaryMuscle?: string;
  equipment?: "machine" | "free_weight" | "cable" | "body_weight";
  isCompound?: boolean;
  secondaryMuscles?: string[];
};
export type PlanImportResult = { plan: Plan; exerciseMeta: Map<string, ImportedExerciseMeta> };

export type Session = {
  id: string;
  planId: string;
  planWeekId: string;
  planDayId: string;
  date: string;
  entries: SessionEntry[];
  completed?: boolean;
  ghostSeed?: boolean;
};
export type SessionEntry = { id: string; exerciseId?: string; exerciseName: string; sets: SessionSet[]; note?: string | null; myoRepMatch?: boolean };
export type SessionSet = { id: string; setIndex: number; weight: number | null; reps: number | null };

export type ArchivedSessionMap = Record<string, Record<string, Session | null>>;
export type GhostSet = { weight: number | null; reps: number | null };
export type Mode = "builder" | "workout";
export type SearchSource = "all" | "defaults" | "home_made";

export const SET_COUNT_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

export const MUSCLE_GROUPS = [
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Chest', 'Front Delt',
  'Side Delt', 'Rear Delt', 'Lats', 'Upper Back', 'Traps',
  'Bicep', 'Tricep', 'Abs', 'Lower Back', 'Forearm',
] as const;
