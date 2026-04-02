
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Auth from "./Auth";
import { Badge, Button, Card, EmptyState, Modal, Skeleton } from "./components";
import { api, aiApi, exerciseApi, exerciseCatalogApi, planApi, sessionApi, templateApi } from "./api";
import { getUserPrefs, upsertUserPrefs, type StreakConfig, type StreakState, type StreakScheduleMode, type UserPrefsData } from './api/userPrefs';
import { supabase } from "./supabaseClient";
import type {
  ServerPlanRow,
  ServerPlanWeek,
  ServerPlanData,
  ServerPlanDay as ServerPlanDayRow,
  ServerPlanItem as ServerPlanItemRow,
  SessionPayload,
  SessionEntryPayload,
  SessionSetPayload,
  SessionRow,
  ExerciseCatalogRow,
  CustomExerciseRow,
} from "./api";

type Plan = { id: string; serverId?: string; predecessorPlanId?: string; name: string; weeks: PlanWeek[]; ghostMode?: 'default' | 'full-body' };
type PlanWeek = { id: string; name: string; days: PlanDay[] };
type PlanDay = { id: string; name: string; items: PlanExercise[] };
type PlanExercise = { id: string; exerciseId?: string; exerciseName: string; targetSets: number; targetReps?: string; myoReps?: boolean };
type Exercise = { id: string; name: string };
type CatalogExercise = {
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
type ImportedExerciseMeta = {
  isCustom?: boolean;
  primaryMuscle?: string;
  equipment?: "machine" | "free_weight" | "cable" | "body_weight";
  isCompound?: boolean;
  secondaryMuscles?: string[];
};
type PlanImportResult = { plan: Plan; exerciseMeta: Map<string, ImportedExerciseMeta> };

type Session = {
  id: string;
  planId: string;
  planWeekId: string;
  planDayId: string;
  date: string;
  entries: SessionEntry[];
  completed?: boolean;
  ghostSeed?: boolean;
};
type SessionEntry = { id: string; exerciseId?: string; exerciseName: string; sets: SessionSet[]; note?: string | null; myoRepMatch?: boolean };
type SessionSet = { id: string; setIndex: number; weight: number | null; reps: number | null };

type ArchivedSessionMap = Record<string, Record<string, Session | null>>;

type GhostSet = { weight: number | null; reps: number | null };

type Mode = "builder" | "workout";
type SearchSource = "all" | "defaults" | "home_made";

const SET_COUNT_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

const MUSCLE_GROUPS = [
  'Quads','Hamstrings','Glutes','Calves','Chest','Front Delt',
  'Side Delt','Rear Delt','Lats','Upper Back','Traps',
  'Bicep','Tricep','Abs','Lower Back','Forearm',
] as const;

const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

const normalizeExerciseName = (name: string) => name.trim();
const normalizeFilterValue = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
const exerciseKey = (entry: { exerciseId?: string; exerciseName?: string | null }) => {
  if (entry.exerciseId) return `id:${entry.exerciseId}`;
  const name = normalizeExerciseName(entry.exerciseName || '').toLowerCase();
  return `name:${name}`;
};



// Streak helper functions
const getUserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
};

const toLocalDateString = (date: Date, timezone: string): string => {
  try {
    return date.toLocaleDateString('en-CA', { timeZone: timezone }); // Returns YYYY-MM-DD
  } catch {
    return date.toISOString().split('T')[0];
  }
};

const daysBetween = (startDateStr: string, endDate: Date, timezone: string): number => {
  const startStr = startDateStr.split('T')[0];
  const endStr = toLocalDateString(endDate, timezone);
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
};

const isWorkoutDay = (config: StreakConfig, date: Date): boolean => {
  if (!config.enabled) return false;
  const timezone = config.timezone || getUserTimezone();

  switch (config.scheduleMode) {
    case 'daily':
      return true;

    case 'rolling': {
      const daysOn = config.rollingDaysOn ?? 1;
      const daysOff = config.rollingDaysOff ?? 0;
      const cycleLength = daysOn + daysOff;
      if (cycleLength <= 0) return true;
      const daysSinceStart = daysBetween(config.startDate, date, timezone);
      if (daysSinceStart < 0) return false; // Before start date
      const dayInCycle = daysSinceStart % cycleLength;
      return dayInCycle < daysOn;
    }

    case 'weekly': {
      // Get day of week in user's timezone
      const dayOfWeek = new Date(toLocalDateString(date, timezone) + 'T12:00:00').getDay();
      return (config.weeklyDays ?? []).includes(dayOfWeek);
    }

    default:
      return false;
  }
};

const checkStreakStatus = (
  config: StreakConfig,
  state: StreakState | null,
  now: Date
): { currentStreak: number; isHitToday: boolean; streakBroken: boolean } => {
  if (!config.enabled || !state) {
    return { currentStreak: 0, isHitToday: false, streakBroken: false };
  }

  const timezone = config.timezone || getUserTimezone();
  const todayStr = toLocalDateString(now, timezone);
  const lastWorkoutStr = state.lastWorkoutDate;

  // Check if hit today
  const isHitToday = lastWorkoutStr === todayStr;

  // If no previous workout, no streak to check
  if (!lastWorkoutStr) {
    return { currentStreak: 0, isHitToday: false, streakBroken: false };
  }

  // Check for missed workout days between last workout and today
  let streakBroken = false;
  let checkDate = new Date(lastWorkoutStr + 'T12:00:00');
  checkDate.setDate(checkDate.getDate() + 1); // Start checking day after last workout

  const todayDate = new Date(todayStr + 'T12:00:00');

  while (checkDate < todayDate) {
    if (isWorkoutDay(config, checkDate)) {
      // Missed a scheduled workout day
      streakBroken = true;
      break;
    }
    checkDate.setDate(checkDate.getDate() + 1);
  }

  return {
    currentStreak: streakBroken ? 0 : state.currentStreak,
    isHitToday,
    streakBroken,
  };
};

// Shared CSV export helpers (used by active and archived plan exports)
const csvEscape = (val: string) => '"' + String(val ?? '').replace(/"/g, '""') + '"';

const buildCatalogByName = (catalog: CatalogExercise[]) => {
  const map = new Map<string, CatalogExercise>();
  for (const ex of catalog) {
    const key = ex.name.trim().toLowerCase();
    if (!key) continue;
    const existing = map.get(key);
    if (!existing || (ex.isCustom && !existing.isCustom)) {
      map.set(key, ex);
    }
  }
  return map;
};

const parseBool = (value: string) => /^(true|1|yes|y)$/i.test(String(value || '').trim());

function planToCSV(plan: Plan, catalogByName?: Map<string, CatalogExercise>, exerciseNotes?: Record<string, string>): string {
  const header = [
    'planName',
    'weekName',
    'dayName',
    'exerciseName',
    'targetSets',
    'targetReps',
    'myoReps',
    'note',
    'isCustom',
    'primaryMuscle',
    'equipment',
    'isCompound',
    'secondaryMuscles',
  ];
  const rows: string[] = [header.join(',')];
  for (const wk of plan.weeks) {
    const weekName = wk.name || '';
    for (let di = 0; di < wk.days.length; di++) {
      const dy = wk.days[di];
      const dayName = dy.name || '';
      if (!dy.items || dy.items.length === 0) continue;
      for (const it of dy.items) {
        const note = exerciseNotes?.[normalizeExerciseName(it.exerciseName || '').toLowerCase()] || '';
        const exerciseName = it.exerciseName || '';
        const key = exerciseName.trim().toLowerCase();
        const meta = key && catalogByName ? catalogByName.get(key) : undefined;
        const isCustom = meta ? (meta.isCustom ? 'true' : 'false') : '';
        const primaryMuscle = meta?.primaryMuscle ?? '';
        const equipment = meta
          ? meta.machine
            ? 'machine'
            : meta.freeWeight
              ? 'free_weight'
              : meta.cable
                ? 'cable'
                : meta.bodyWeight
                  ? 'body_weight'
                  : ''
          : '';
        const isCompound = meta ? (meta.isCompound ? 'true' : 'false') : '';
        const secondaryMuscles = meta?.secondaryMuscles?.length ? meta.secondaryMuscles.join(';') : '';
        rows.push([
          csvEscape(plan.name || ''),
          csvEscape(weekName),
          csvEscape(dayName),
          csvEscape(exerciseName),
          String(Number(it.targetSets) || 0),
          csvEscape(it.targetReps || ''),
          csvEscape(it.myoReps ? 'true' : ''),
          csvEscape(note),
          csvEscape(isCustom),
          csvEscape(primaryMuscle),
          csvEscape(equipment),
          csvEscape(isCompound),
          csvEscape(secondaryMuscles),
        ].join(','));
      }
    }
  }
  return rows.join('\n');
}

function downloadCSV(filename: string, csv: string) {
  try {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
  }
}

async function exportPlanCSV(plan: Plan, catalogByName?: Map<string, CatalogExercise>) {
  let notes: Record<string, string> = {};
  try {
    const up = await getUserPrefs().catch(() => null);
    const p = (up?.prefs as UserPrefsData | null) || null;
    if (p?.exercise_notes) notes = p.exercise_notes;
  } catch { /* ignore */ }
  const csv = planToCSV(plan, catalogByName, notes);
  downloadCSV(`${plan.name || 'plan'}.csv`, csv);
}

function generateExerciseCatalogCSV(exercises: CatalogExercise[]): string {
  const header = ['exerciseName','primaryMuscle','equipment','isCompound','secondaryMuscles','isCustom'];
  const rows: string[] = [header.join(',')];
  const sorted = [...exercises].sort((a, b) => a.name.localeCompare(b.name));
  for (const ex of sorted) {
    const equipment = ex.machine ? 'machine' : ex.freeWeight ? 'free_weight' : ex.cable ? 'cable' : ex.bodyWeight ? 'body_weight' : '';
    rows.push([
      csvEscape(ex.name),
      csvEscape(ex.primaryMuscle),
      csvEscape(equipment),
      csvEscape(ex.isCompound ? 'true' : 'false'),
      csvEscape(ex.secondaryMuscles?.join(';') || ''),
      csvEscape(ex.isCustom ? 'true' : 'false'),
    ].join(','));
  }
  return rows.join('\n');
}

function generateAIPrompt(prefs: {
  experience: string;
  beginnerRandom: boolean;
  daysPerWeek: number;
  sessionMinutes: string;
  trainingGoal: string;
  injuries: string;
  priorityMuscles: string[];
  deprioritizedMuscles: string[];
  knowsMyoReps: boolean;
}, exercises: CatalogExercise[]): string {
  // Build exercise summary grouped by muscle
  const byMuscle = new Map<string, string[]>();
  for (const ex of exercises) {
    const m = ex.primaryMuscle || 'Other';
    if (!byMuscle.has(m)) byMuscle.set(m, []);
    byMuscle.get(m)!.push(ex.name);
  }
  const exerciseSummary = Array.from(byMuscle.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([muscle, names]) => `${muscle}: ${names.join(', ')}`)
    .join('\n');

  const isBeginnerRandom = prefs.experience === 'beginner' && prefs.beginnerRandom;
  const days = prefs.daysPerWeek;

  // Build split recommendation based on experience + days
  let splitGuidance: string;
  if (prefs.experience === 'beginner') {
    if (days <= 3) {
      splitGuidance = `Full Body split (${days}x/week). Beginners benefit most from full body training — hit each muscle group every session with compound movements. Keep it simple: 1-2 compound lifts per major muscle group, 2-3 sets each.`;
    } else {
      splitGuidance = `Upper/Lower split (${days}x/week). Alternate upper and lower body days. Focus on fundamental compound movements with moderate volume.`;
    }
  } else if (prefs.experience === 'intermediate') {
    if (days <= 3) {
      splitGuidance = `Full Body split (${days}x/week). Vary exercise selection across days (e.g., squat Day 1, leg press Day 2). Moderate volume with some isolation work.`;
    } else if (days === 4) {
      splitGuidance = `Upper/Lower split (${days}x/week). Two upper days and two lower days with different exercise variations on each. Include both compound and isolation work.`;
    } else {
      splitGuidance = `Push/Pull/Legs split (${days}x/week). Group muscles by movement pattern. Include compound and isolation exercises with progressive volume.`;
    }
  } else {
    // advanced
    if (days <= 3) {
      splitGuidance = `Full Body split (${days}x/week). Higher intensity per session, vary rep ranges across days (strength day, hypertrophy day, etc.). Include compound and isolation work.`;
    } else if (days === 4) {
      splitGuidance = `Upper/Lower split (${days}x/week). Higher volume per session with strategic exercise selection. Vary rep ranges between the two upper and two lower days.`;
    } else {
      splitGuidance = `Push/Pull/Legs or similar specialization split (${days}x/week). Higher volume and exercise variety. Can include dedicated arm/shoulder days if 6 days.`;
    }
  }

  // Training goal guidance
  let goalGuidance: string;
  if (prefs.trainingGoal === 'strength') {
    goalGuidance = `The user is training for STRENGTH. Prioritize heavy compound movements with lower rep ranges (3-6 reps) and longer rest periods. Include some hypertrophy work (8-12 reps) as accessory movements.`;
  } else if (prefs.trainingGoal === 'hypertrophy') {
    goalGuidance = `The user is training for HYPERTROPHY (muscle size). Use moderate rep ranges (8-15 reps) with controlled tempos. Include a mix of compound and isolation movements with higher total volume.`;
  } else {
    goalGuidance = `The user wants a balanced program for both STRENGTH and SIZE. Use a mix of heavier compound work (5-8 reps) and moderate hypertrophy work (8-12 reps) with some higher rep isolation (12-15 reps).`;
  }

  let prefsSection = `- Experience level: ${prefs.experience}
- Training goal: ${prefs.trainingGoal === 'strength' ? 'Strength' : prefs.trainingGoal === 'hypertrophy' ? 'Hypertrophy (size)' : 'Both strength and size'}
- Training days per week: ${days}
- Session duration: ${prefs.sessionMinutes} minutes`;

  if (isBeginnerRandom) {
    prefsSection += `\n- The user is a beginner who wants a simple, well-rounded starter program. Keep it straightforward with basic compound movements and simple progression. Stick to well-known, beginner-friendly exercises.`;
  } else {
    if (prefs.injuries.trim()) prefsSection += `\n- Injuries/limitations: ${prefs.injuries.trim()} — AVOID exercises that would aggravate these. Suggest safe alternatives in the note column.`;
    if (prefs.priorityMuscles.length) prefsSection += `\n- Muscles to PRIORITIZE (add extra volume): ${prefs.priorityMuscles.join(', ')}`;
    if (prefs.deprioritizedMuscles.length) prefsSection += `\n- Muscles to DE-PRIORITIZE (reduce volume): ${prefs.deprioritizedMuscles.join(', ')}`;
  }

  if (prefs.experience === 'beginner') {
    prefsSection += `\n- Do NOT use myo-rep sets — the user is a beginner (leave the myoReps column empty for all exercises).`;
  } else if (prefs.knowsMyoReps) {
    prefsSection += `\n- The user is familiar with myo-rep sets. You may include them where appropriate for isolation exercises (set the myoReps column to "true").`;
  } else {
    prefsSection += `\n- Do NOT use myo-rep sets (leave the myoReps column empty for all exercises).`;
  }

  return `You are an expert strength training program designer. Create a training program based on the preferences below and provide it as a downloadable CSV file.

## User Preferences
${prefsSection}

## Training Approach
${goalGuidance}

## Split Design
${splitGuidance}

## Output Format
Output ONLY the raw CSV text — no markdown, no explanation, no code fences. The CSV must have exactly these 13 columns in this order:

planName,weekName,dayName,exerciseName,targetSets,targetReps,myoReps,note,isCustom,primaryMuscle,equipment,isCompound,secondaryMuscles

### Column Definitions
- planName: A name for the program (e.g., "Upper/Lower 4-Day", "Full Body Strength"). Use the same name for every row.
- weekName: Week label (e.g., "Week 1", "Week 2"). Create at least 1 week; up to 4 for periodization.
- dayName: Day label (e.g., "Push", "Pull", "Upper A", "Lower B", "Full Body A").
- exerciseName: The exercise name — MUST exactly match one from the exercise list below.
- targetSets: Number of working sets (integer, typically 2–5).
- targetReps: Rep range as text (e.g., "6-8", "8-12", "12-15").
- myoReps: Set to "true" ONLY if this should be a myo-rep set. Otherwise leave empty.
- note: Short coaching cue for the exercise. Include form tips, tempo guidance, or safety notes (e.g., "pause at bottom", "control the eccentric", "keep back neutral"). Add a note for EVERY exercise — especially for beginners.
- isCustom: "false" for all exercises from the provided list.
- primaryMuscle: The primary muscle group (must match the exercise list exactly).
- equipment: One of: machine, free_weight, cable, body_weight
- isCompound: "true" or "false" (must match the exercise list).
- secondaryMuscles: Semicolon-separated (e.g., "Tricep;Front Delt"). Must match the exercise list.

## Rules
1. ONLY use exercises from the "Available Exercises" list below. Do not invent exercises.
2. Every field that contains commas or quotes must be wrapped in double quotes with internal quotes escaped as "".
3. Output ONLY the raw CSV. No markdown, no code fences, no commentary before or after. Start with the header row and end with the last data row.
4. The first row of the CSV must be the header row exactly as shown above.
5. Use the split design guidance above for structuring training days.
6. Total working sets per session should fit within ~${prefs.sessionMinutes} minutes (roughly 1 set per 2-3 minutes including rest).
7. Order exercises within each day: compound movements first, then isolation.
8. For the exerciseName, primaryMuscle, equipment, isCompound, and secondaryMuscles columns, copy the values EXACTLY as they appear in the exercise list.
9. Ensure balanced programming — don't neglect any major muscle group unless the user specifically asked to de-prioritize it.
10. Include a helpful coaching note for every exercise in the "note" column — form cues, breathing tips, or things to watch out for.

## Available Exercises
${exerciseSummary}

The full exercise catalog with all metadata columns is attached as a CSV file. Use the exerciseName values EXACTLY as they appear in that list.

Generate the program CSV file now.`;
}

// Fix common mojibake (UTF‑8 shown as Windows‑1252/Latin‑1) when reading data.
function fixMojibake(value: unknown): string {
  const s = typeof value === 'string' ? value : '';
  if (!s) return '';
  const looksMojibake = /[ÃÂâ¢€™œ]/.test(s);
  if (!looksMojibake) return s;
  try {
    const bytes = new Uint8Array(Array.from(s, (ch) => ch.charCodeAt(0)));
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (/[ÃÂâ¢€™œ]/.test(decoded)) return s;
    return decoded;
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const decoded = decodeURIComponent(escape(s));
      if (/[ÃÂâ¢€™œ]/.test(decoded)) return s;
      return decoded;
    } catch {
      return s;
    }
  }
}

function startSessionFromDay(plan: Plan, weekId: string, dayId: string): Session {
  const week = plan.weeks.find((w) => w.id === weekId)!;
  const day = week.days.find((d) => d.id === dayId)!;
  return {
    id: uuid(),
    planId: plan.id,
    planWeekId: week.id,
    planDayId: day.id,
    date: new Date().toISOString(),
    entries: day.items.map((item) => ({
      id: uuid(),
      exerciseId: item.exerciseId,
      exerciseName: item.exerciseName,
      sets: Array.from({ length: item.targetSets }, (_, i) => ({
        id: uuid(),
        setIndex: i,
        weight: null,
        reps: null,
      })),
      note: null,
      myoRepMatch: item.myoReps || undefined,
    })),
    completed: false,
  };
}

// Merge an existing session with the latest plan day shape.
// - Keeps weights/reps that already exist for matching exercise names and set indices
// - Adds new exercises/sets as nulls
// - Drops exercises removed from the plan
function mergeSessionWithDay(planDay: PlanDay, prev: Session): Session {
  const itemName = (name: string) => normalizeExerciseName(name).toLowerCase();
  const nextEntries: SessionEntry[] = planDay.items.map((item) => {
    const targetName = itemName(item.exerciseName || '');
    const existing = (prev.entries || []).find((e) => {
      if (item.exerciseId && e.exerciseId) return item.exerciseId === e.exerciseId;
      const entryName = itemName(e.exerciseName || '');
      if (item.exerciseId && !e.exerciseId) return entryName === targetName;
      return entryName === targetName;
    }) || null;
    const sets: SessionSet[] = Array.from({ length: item.targetSets }, (_, i) => {
      const old = existing?.sets?.[i] || null;
      return {
        id: old?.id || uuid(),
        setIndex: i,
        weight: old?.weight ?? null,
        reps: old?.reps ?? null,
      };
    });
    return {
      id: existing?.id || uuid(),
      exerciseId: item.exerciseId ?? existing?.exerciseId,
      exerciseName: item.exerciseName,
      sets,
      note: existing?.note ?? null,
      myoRepMatch: item.myoReps || existing?.myoRepMatch || undefined,
    };
  });
  return { ...prev, entries: nextEntries };
}


function mapRowToWeeks(d: import("./api").ServerPlanData, { includeLegacyFlatDays = false } = {}): PlanWeek[] {
  if (Array.isArray(d.weeks)) {
    return (d.weeks as ServerPlanWeek[]).map((week) => ({
      id: week.id ?? uuid(),
      name: fixMojibake(week.name) || "Week",
      days: (week.days ?? []).map((day: ServerPlanDayRow) => ({
        id: day.id ?? uuid(),
        name: fixMojibake(day.name) || "Day",
        items: (day.items ?? []).map((item: ServerPlanItemRow) => ({
          id: item.id ?? uuid(),
          exerciseId: item.exerciseId != null ? String(item.exerciseId) : undefined,
          exerciseName: fixMojibake(item.exerciseName) || "Exercise",
          targetSets: Number(item.targetSets) || 0,
          targetReps: item.targetReps ?? "",
          myoReps: (item as { myoReps?: boolean }).myoReps || undefined,
        })),
      })),
    }));
  }
  // Legacy plans stored days at the top level without weeks
  if (includeLegacyFlatDays && Array.isArray(d.days) && d.days.length > 0) {
    return [{
      id: uuid(),
      name: "Week 1",
      days: (d.days as ServerPlanDayRow[]).map((day) => ({
        id: day.id ?? uuid(),
        name: fixMojibake(day.name) || "Day",
        items: (day.items ?? []).map((item: ServerPlanItemRow) => ({
          id: item.id ?? uuid(),
          exerciseId: item.exerciseId != null ? String(item.exerciseId) : undefined,
          exerciseName: fixMojibake(item.exerciseName) || "Exercise",
          targetSets: Number(item.targetSets) || 0,
          targetReps: item.targetReps ?? "",
          myoReps: (item as { myoReps?: boolean }).myoReps || undefined,
        })),
      })),
    }];
  }
  return [];
}

function firstWeekDayOf(plan: Plan) {
  const wk = plan.weeks[0] ?? null;
  const dy = wk?.days[0] ?? null;
  return { weekId: wk?.id ?? null, dayId: dy?.id ?? null };
}

function nextWeekDay(plan: Plan, currentWeekId: string, currentDayId: string) {
  const wIdx = plan.weeks.findIndex((w) => w.id === currentWeekId);
  if (wIdx < 0) return firstWeekDayOf(plan);

  const days = plan.weeks[wIdx].days;
  const dIdx = days.findIndex((d) => d.id === currentDayId);
  if (dIdx < 0) return firstWeekDayOf(plan);

  if (dIdx < days.length - 1) {
    return { weekId: plan.weeks[wIdx].id, dayId: days[dIdx + 1].id };
  }
  const nextWIdx = (wIdx + 1) % plan.weeks.length;
  return { weekId: plan.weeks[nextWIdx].id, dayId: plan.weeks[nextWIdx].days[0].id };
}

function prevWeekDay(plan: Plan, currentWeekId: string, currentDayId: string) {
  const wIdx = plan.weeks.findIndex((w) => w.id === currentWeekId);
  if (wIdx < 0) return firstWeekDayOf(plan);

  const days = plan.weeks[wIdx].days;
  const dIdx = days.findIndex((d) => d.id === currentDayId);
  if (dIdx < 0) return firstWeekDayOf(plan);

  if (dIdx > 0) {
    return { weekId: plan.weeks[wIdx].id, dayId: days[dIdx - 1].id };
  }
  const prevWIdx = (wIdx - 1 + plan.weeks.length) % plan.weeks.length;
  const prevWeek = plan.weeks[prevWIdx];
  return { weekId: prevWeek.id, dayId: prevWeek.days[prevWeek.days.length - 1].id };
}
export default function App() {
  const [user, setUser] = useState<{ id: number; username: string } | null>(null);
  const [checking, setChecking] = useState(true);
  const [forcePasswordReset, setForcePasswordReset] = useState(false);

  // Pull-to-refresh functionality
  useEffect(() => {
    let startY = 0;
    let active = false;
    let triggered = false;
    let progress = 0;
    let wasReady = false;
    const THRESHOLD = 80;
    let el: HTMLDivElement | null = null;
    const rootEl = document.getElementById('root');

    if (!document.getElementById('ptr-styles')) {
      const s = document.createElement('style');
      s.id = 'ptr-styles';
      s.textContent = `@keyframes ptr-spin{to{transform:rotate(360deg)}}`;
      document.head.appendChild(s);
    }

    const atTop = () => (window.scrollY ?? window.pageYOffset ?? 0) <= 0;

    // ── Indicator ──
    const mount = () => {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%) scale(0.4);z-index:9999;pointer-events:none;opacity:0;display:flex;flex-direction:column;align-items:center;';
      d.innerHTML = `
        <div data-bubble style="width:40px;height:40px;border-radius:50%;background:var(--bg-card);border:2px solid var(--border-default);box-shadow:0 2px 12px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;">
          <span data-arrow style="display:block;font-size:18px;line-height:1;color:var(--text-muted);transition:color .15s;">↓</span>
        </div>
        <span data-label style="font-size:11px;margin-top:6px;color:var(--text-muted);white-space:nowrap;opacity:0;"></span>`;
      document.body.appendChild(d);
      return d;
    };

    const unmount = () => {
      if (!el) return;
      const ref = el;
      ref.style.transition = 'opacity .2s, transform .2s';
      ref.style.opacity = '0';
      ref.style.transform = 'translateX(-50%) scale(0.4)';
      setTimeout(() => ref.remove(), 250);
      el = null;
      // Snap page back up
      if (rootEl) {
        rootEl.style.transition = 'transform .25s ease-out';
        rootEl.style.transform = '';
      }
    };

    // ── Touch handlers ──
    let startX = 0;
    let decided = false;   // true once we've committed to pull-to-refresh or rejected it
    const ACTIVATE_Y = 15; // min vertical px before we decide this is a pull gesture

    const onStart = (e: TouchEvent) => {
      if (triggered) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      active = false;
      decided = false;
      progress = 0;
      wasReady = false;
    };

    const onMove = (e: TouchEvent) => {
      if (triggered) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;

      // Decide once: is this a pull-to-refresh?
      if (!active) {
        if (decided) return; // already rejected this gesture
        // Wait until the finger has moved enough to decide direction
        if (Math.abs(dy) < ACTIVATE_Y && Math.abs(dx) < ACTIVATE_Y) return;
        // Must be mostly vertical (downward), page at top, and not inside a scrollable sub-container
        const isVertical = Math.abs(dy) > Math.abs(dx) * 1.5;
        if (dy > 0 && isVertical && atTop()) {
          // Check the touch didn't start inside a scrollable child (modals, menus, etc.)
          const target = e.target as HTMLElement | null;
          if (target?.closest?.('[data-no-ptr]')) { decided = true; return; }
          active = true;
        } else {
          decided = true; // not a pull-to-refresh — ignore rest of this gesture
          return;
        }
      }

      // Once active, stay active — don't cancel on transient scrollY glitches.
      // Just block native bounce and track the finger.
      e.preventDefault();

      if (!el) el = mount();

      const raw = Math.max(0, dy);
      progress = Math.min(raw / THRESHOLD, 1);
      const ready = progress >= 1;

      // Scale: 0.4 → 1.0 as progress goes 0 → 1 (immediately visible)
      const scale = 0.4 + 0.6 * progress;
      el.style.transition = 'none';
      el.style.opacity = String(Math.min(progress * 3, 1));   // fully opaque by ~33%
      el.style.transform = `translateX(-50%) scale(${ready ? 1.1 : scale})`;

      // Slide page content down so indicator sits in the gap
      if (rootEl) {
        const nudge = Math.min(raw * 0.4, 60);
        rootEl.style.transition = 'none';
        rootEl.style.transform = `translateY(${nudge}px)`;
      }

      const arrow = el.querySelector('[data-arrow]') as HTMLElement | null;
      const bubble = el.querySelector('[data-bubble]') as HTMLElement | null;
      const label = el.querySelector('[data-label]') as HTMLElement | null;

      // Arrow: ↓ rotates to ↑ as you pull
      if (arrow) {
        arrow.style.display = 'block';
        arrow.style.transform = `rotate(${progress * 180}deg)`;
        arrow.style.color = ready ? 'var(--success)' : 'var(--text-muted)';
      }

      if (bubble) {
        bubble.style.borderColor = ready ? 'var(--success)' : 'var(--border-default)';
        bubble.style.boxShadow = ready
          ? '0 0 14px rgba(74,222,128,0.4), 0 2px 12px rgba(0,0,0,0.5)'
          : '0 2px 12px rgba(0,0,0,0.5)';
        // Spring pop on first reaching ready
        if (ready && !wasReady) {
          bubble.style.transition = 'border-color .15s, box-shadow .15s';
        } else {
          bubble.style.transition = 'none';
        }
      }

      if (label) {
        label.style.opacity = progress > 0.3 ? '1' : '0';
        label.textContent = ready ? 'Release to refresh' : 'Pull to refresh';
        label.style.color = ready ? 'var(--success)' : 'var(--text-muted)';
      }

      wasReady = ready;
    };

    const onEnd = () => {
      if (triggered || !active) { active = false; return; }
      active = false;

      if (progress >= 1 && el) {
        triggered = true;
        const bubble = el.querySelector('[data-bubble]') as HTMLElement | null;
        const label = el.querySelector('[data-label]') as HTMLElement | null;
        // Settle to scale(1)
        if (el) {
          el.style.transition = 'transform .2s';
          el.style.transform = 'translateX(-50%) scale(1)';
        }
        if (bubble) {
          bubble.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" style="animation:ptr-spin .6s linear infinite"><circle cx="12" cy="12" r="10" fill="none" stroke="var(--success)" stroke-width="2.5" stroke-dasharray="45 18" stroke-linecap="round"/></svg>';
        }
        if (label) { label.textContent = 'Refreshing...'; label.style.color = 'var(--success)'; }
        setTimeout(() => window.location.reload(), 500);
      } else {
        unmount();
      }
      progress = 0;
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      el?.remove();
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const email = data?.user?.email || null;
        setUser(email ? { id: 0, username: email } : null);
      } catch {
        setUser(null);
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  useEffect(() => {
    const hasRecoveryParam = () => {
      if (typeof window === 'undefined') return false;
      const search = new URLSearchParams(window.location.search);
      if (search.get('reset') === '1') return true;
      if (search.get('type') === 'recovery') return true;
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      return hash.get('type') === 'recovery';
    };
    if (hasRecoveryParam()) setForcePasswordReset(true);
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setForcePasswordReset(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <div>
      {checking ? (
        <Skeleton lines={4} />
      ) : forcePasswordReset ? (
        <Auth
          onAuthed={setUser}
          forceMode="reset"
          onResetComplete={() => setForcePasswordReset(false)}
        />
      ) : !user ? (
        <Auth onAuthed={setUser} />
      ) : (
        <AuthedApp
          user={user}
          onLogout={async () => {
            try { await supabase.auth.signOut(); } catch { /* ignore */ }
            await api.logout();
            setUser(null);
          }}
        />
      )}
    </div>
  );
}

function AuthedApp({
  user,
  onLogout,
}: {
  user: { id: number; username: string };
  onLogout: () => void;
}) {
  const [mode, setMode] = useState<Mode>("workout");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [showPlanList, setShowPlanList] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [completed, setCompleted] = useState(false);
  const [shouldAutoNavigate, setShouldAutoNavigate] = useState(true);
  const [showArchiveList, setShowArchiveList] = useState(false);
  const [archivedPlans, setArchivedPlans] = useState<Plan[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [viewArchivedPlan, setViewArchivedPlan] = useState<Plan | null>(null);
  const [viewArchivedSessions, setViewArchivedSessions] = useState<ArchivedSessionMap>({});
  const [viewArchivedLoading, setViewArchivedLoading] = useState(false);
  const [finishingPlan, setFinishingPlan] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [exerciseLibrary, setExerciseLibrary] = useState<Exercise[]>([]);
  const [catalogExercises, setCatalogExercises] = useState<CatalogExercise[]>([]);
  const [customCatalogExercises, setCustomCatalogExercises] = useState<CatalogExercise[]>([]);
  const [exerciseLoading, setExerciseLoading] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const selectionOriginRef = useRef<"auto" | "user">("auto");

  // Streak state
  const [streakConfig, setStreakConfig] = useState<StreakConfig | null>(null);
  const [streakState, setStreakState] = useState<StreakState | null>(null);
  const [streakHitToday, setStreakHitToday] = useState(false);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [showStreakSettings, setShowStreakSettings] = useState(false);
  const [showStreakReconfigPrompt, setShowStreakReconfigPrompt] = useState(false);
  const [showPlanSettings, setShowPlanSettings] = useState(false);

  const exerciseByName = useMemo(() => {
    const map = new Map<string, Exercise>();
    for (const ex of exerciseLibrary) {
      map.set(ex.name.trim().toLowerCase(), ex);
    }
    return map;
  }, [exerciseLibrary]);

  const searchCatalogExercises = useMemo(() => {
    const byName = new Map<string, CatalogExercise>();
    const add = (ex: CatalogExercise, isCustom: boolean) => {
      const key = ex.name.trim().toLowerCase();
      if (!key) return;
      const next = { ...ex, isCustom };
      const existing = byName.get(key);
      if (!existing || (next.isCustom && !existing.isCustom)) {
        byName.set(key, next);
      }
    };
    for (const ex of customCatalogExercises) add(ex, true);
    for (const ex of catalogExercises) add(ex, false);
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [catalogExercises, customCatalogExercises]);

  const exerciseOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (name: string) => {
      const key = name.trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(name);
    };
    for (const ex of searchCatalogExercises) add(ex.name);
    for (const ex of exerciseLibrary) add(ex.name);
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }, [exerciseLibrary, searchCatalogExercises]);

  const upsertExerciseInState = useCallback((row: { id: string | number; name?: string | null }) => {
    if (!row || row.name == null) return null;
    const ex: Exercise = { id: String(row.id), name: String(row.name) };
    setExerciseLibrary((prev) => {
      const exists = prev.some((p) => p.id === ex.id);
      if (exists) return prev;
      const next = [...prev, ex];
      next.sort((a, b) => a.name.localeCompare(b.name));
      return next;
    });
    return ex;
  }, []);

  const loadExercises = useCallback(async () => {
    setExerciseLoading(true);
    try {
      const rows = await exerciseApi.list();
      const mapped = rows
        .filter((r) => r && r.name != null)
        .map((r) => ({ id: String(r.id), name: String(r.name) }));
      mapped.sort((a, b) => a.name.localeCompare(b.name));
      setExerciseLibrary(mapped);
    } catch {
      setExerciseLibrary([]);
    } finally {
      setExerciseLoading(false);
    }
  }, []);

  const loadCatalogExercises = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const rows = await exerciseCatalogApi.list();
      const mapped = rows
        .filter((r) => r && r.name != null && r.primary_muscle != null)
        .map((r: ExerciseCatalogRow) => ({
          id: String(r.id),
          name: String(r.name ?? ''),
          primaryMuscle: String(r.primary_muscle ?? ''),
          machine: !!r.machine,
          freeWeight: !!r.free_weight,
          cable: !!r.cable,
          bodyWeight: !!r.body_weight,
          isCompound: !!r.is_compound,
          secondaryMuscles: Array.isArray(r.secondary_muscles)
            ? r.secondary_muscles.filter((m) => !!m).map((m) => String(m))
            : [],
          isCustom: false,
        }));
      mapped.sort((a, b) => a.name.localeCompare(b.name));
      setCatalogExercises(mapped);
    } catch {
      setCatalogExercises([]);
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  const loadCustomExercises = useCallback(async () => {
    try {
      const rows = await exerciseApi.listCustom();
      const mapped = rows
        .filter((r) => r && r.name != null && r.primary_muscle != null)
        .map((r: CustomExerciseRow) => ({
          id: String(r.id),
          name: String(r.name ?? ''),
          primaryMuscle: String(r.primary_muscle ?? ''),
          machine: !!r.machine,
          freeWeight: !!r.free_weight,
          cable: !!r.cable,
          bodyWeight: !!r.body_weight,
          isCompound: !!r.is_compound,
          secondaryMuscles: Array.isArray(r.secondary_muscles)
            ? r.secondary_muscles.filter((m) => !!m).map((m) => String(m))
            : [],
          isCustom: true,
        }));
      const byName = new Map<string, CatalogExercise>();
      for (const ex of mapped) {
        const key = ex.name.trim().toLowerCase();
        if (!key) continue;
        byName.set(key, ex);
      }
      const deduped = Array.from(byName.values());
      deduped.sort((a, b) => a.name.localeCompare(b.name));
      setCustomCatalogExercises(deduped);
    } catch {
      setCustomCatalogExercises([]);
    }
  }, []);

  const ensureExerciseByName = useCallback(async (rawName: string) => {
    const trimmed = normalizeExerciseName(rawName);
    if (!trimmed) return null;
    const existing = exerciseByName.get(trimmed.toLowerCase());
    if (existing) return existing;
    try {
      const row = await exerciseApi.findOrCreate(trimmed);
      if (!row) return null;
      return upsertExerciseInState(row);
    } catch {
      return null;
    }
  }, [exerciseByName, upsertExerciseInState]);

  const createCustomExercise = useCallback(async (input: {
    name: string;
    primaryMuscle: string;
    equipment: "machine" | "free_weight" | "cable" | "body_weight";
    isCompound: boolean;
    secondaryMuscles?: string[];
  }) => {
    const trimmed = normalizeExerciseName(input.name);
    if (!trimmed) throw new Error("Enter a name.");
    const nameKey = trimmed.toLowerCase();
    const exists = [...catalogExercises, ...customCatalogExercises].some(
      (ex) => ex.name.trim().toLowerCase() === nameKey
    );
    if (exists) throw new Error("That movement already exists.");

    const row = await exerciseApi.createCustom({
      name: trimmed,
      primary_muscle: input.primaryMuscle,
      machine: input.equipment === "machine",
      free_weight: input.equipment === "free_weight",
      cable: input.equipment === "cable",
      body_weight: input.equipment === "body_weight",
      is_compound: input.isCompound,
      secondary_muscles: input.secondaryMuscles ?? [],
    });
    if (!row || !row.name || !row.primary_muscle) throw new Error("Failed to add movement.");

    const mapped: CatalogExercise = {
      id: String(row.id),
      name: String(row.name),
      primaryMuscle: String(row.primary_muscle),
      machine: !!row.machine,
      freeWeight: !!row.free_weight,
      cable: !!row.cable,
      bodyWeight: !!row.body_weight,
      isCompound: !!row.is_compound,
      secondaryMuscles: Array.isArray(row.secondary_muscles)
        ? row.secondary_muscles.filter((m) => !!m).map((m) => String(m))
        : [],
      isCustom: true,
    };
    setCustomCatalogExercises((prev) => {
      const key = mapped.name.trim().toLowerCase();
      const next = prev.filter((ex) => ex.name.trim().toLowerCase() !== key);
      next.push(mapped);
      next.sort((a, b) => a.name.localeCompare(b.name));
      return next;
    });
    upsertExerciseInState(row);
    return mapped;
  }, [catalogExercises, customCatalogExercises, upsertExerciseInState]);

  const deleteCustomExercise = useCallback(async (id: string) => {
    const deleted = await exerciseApi.deleteCustom(id);
    if (!deleted) throw new Error("Unable to delete movement.");
    setCustomCatalogExercises((prev) => prev.filter((ex) => ex.id !== id));
    setExerciseLibrary((prev) => prev.filter((ex) => ex.id !== id));
  }, []);

  // Debounced auto-save for plan edits when the plan already exists on server
  const planSaveDebounceRef = useRef<number | null>(null);
  const prefsSaveDebounceRef = useRef<number | null>(null);
  const queuePlanSave = useCallback((planToSave: Plan) => {
    if (!planToSave?.serverId) return;
    try { if (planSaveDebounceRef.current) window.clearTimeout(planSaveDebounceRef.current); } catch {}
    const payload = { weeks: planToSave.weeks, ghostMode: planToSave.ghostMode };
    planSaveDebounceRef.current = window.setTimeout(() => {
      planApi.update(planToSave.serverId!, planToSave.name, payload).catch(() => void 0);
      planSaveDebounceRef.current = null;
    }, 800);
  }, []);

  // Update streak when workout is completed
  const updateStreak = useCallback(async () => {
    if (!streakConfig?.enabled) return;

    const now = new Date();
    const today = toLocalDateString(now, streakConfig.timezone);

    // Check if already hit today
    if (streakState?.lastWorkoutDate === today) return;

    // Check if today is a workout day
    if (!isWorkoutDay(streakConfig, now)) return;

    // Update streak
    const newStreak = (streakState?.currentStreak ?? 0) + 1;
    const newLongest = Math.max(newStreak, streakState?.longestStreak ?? 0);
    const newState: StreakState = {
      currentStreak: newStreak,
      longestStreak: newLongest,
      lastWorkoutDate: today,
    };

    setStreakState(newState);
    setCurrentStreak(newStreak);
    setStreakHitToday(true);

    try {
      await upsertUserPrefs({ streak_state: newState });
    } catch (err) {
      if (import.meta.env.DEV) console.error('Failed to save streak:', err);
    }
  }, [streakConfig, streakState]);

  useEffect(() => {
    loadExercises();
    loadCatalogExercises();
    loadCustomExercises();
  }, [loadExercises, loadCatalogExercises, loadCustomExercises]);

  const mapServerPlan = (row: ServerPlanRow): Plan => ({
    id: uuid(),
    serverId: row.id,
    predecessorPlanId: typeof row.predecessor_plan_id === "string" ? row.predecessor_plan_id : undefined,
    name: fixMojibake(row.name) || "Plan",
    weeks: mapRowToWeeks((row?.data ?? {}) as import("./api").ServerPlanData, { includeLegacyFlatDays: true }),
    ghostMode: (row?.data as { ghostMode?: 'default' | 'full-body' } | undefined)?.ghostMode,
  });

  const handleDeleteArchivedPlan = async (plan: Plan) => {
    if (!plan.serverId) return;
    if (!window.confirm(`Delete archived plan "${plan.name}"?`)) return;
    try {
      await planApi.remove(plan.serverId);
      setArchivedPlans((prev) => prev.filter((p) => p.serverId !== plan.serverId));
      if (viewArchivedPlan?.serverId === plan.serverId) {
        setViewArchivedPlan(null);
        setViewArchivedSessions({});
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const selectPlan = useCallback((planId: string | null, planOverride?: Plan | null, origin: "auto" | "user" = "user") => {
    selectionOriginRef.current = origin;
    setSelectedPlanId(planId);
    const plan = (planOverride ?? plans.find((p) => p.id === planId)) ?? null;
    const weekId = plan?.weeks[0]?.id ?? null;
    const dayId = plan?.weeks[0]?.days[0]?.id ?? null;
    setSelectedWeekId(weekId);
    setSelectedDayId(dayId);
    setShouldAutoNavigate(true);
  }, [plans]);

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === selectedPlanId) || null,
    [plans, selectedPlanId]
  );
  const selectedWeek = useMemo(
    () => selectedPlan?.weeks.find((w) => w.id === (selectedWeekId ?? "")) || null,
    [selectedPlan, selectedWeekId]
  );
  const selectedDay = useMemo(
    () => selectedWeek?.days.find((d) => d.id === (selectedDayId ?? "")) || null,
    [selectedWeek, selectedDayId]
  );
  useEffect(() => {
    if (mode === "workout") {
      setShouldAutoNavigate(true);
    }
  }, [mode]);

  // When entering Builder, keep the plan/template chooser closed by default
  useEffect(() => {
    if (mode === "builder") {
      setShowPlanList(false);
    }
  }, [mode]);

  


  useEffect(() => {
    (async () => {
      try {
        const rows = await planApi.list();
        const loaded: Plan[] = rows.map((row) => mapServerPlan(row));
        setPlans(loaded);

        const up = await getUserPrefs().catch(() => null);
        const p = (up?.prefs as UserPrefsData | null) || null;
        const prefs = {
          lastPlanServerId: p?.last_plan_server_id ?? null,
          lastWeekId: p?.last_week_id ?? null,
          lastDayId: p?.last_day_id ?? null,
        };

        // Load streak config/state
        if (p?.streak_config) {
          setStreakConfig(p.streak_config);
          if (p.streak_state) {
            setStreakState(p.streak_state);
            // Check streak status on load
            const now = new Date();
            const status = checkStreakStatus(p.streak_config, p.streak_state, now);
            setCurrentStreak(status.currentStreak);
            setStreakHitToday(status.isHitToday);
            // If streak was broken, persist the reset
            if (status.streakBroken && status.currentStreak !== p.streak_state.currentStreak) {
              const resetState: StreakState = {
                currentStreak: status.currentStreak,
                longestStreak: p.streak_state.longestStreak,
                lastWorkoutDate: p.streak_state.lastWorkoutDate,
              };
              setStreakState(resetState);
              upsertUserPrefs({ streak_state: resetState }).catch(() => {});
            }
          }
        }

        // One-time migration v3: pull notes from all sessions into global exercise_notes
        // Fetches ALL session rows (paginated) and scans entries for note fields
        if (localStorage.getItem('exercise_notes_migrated') !== '3') {
          (async () => {
            try {
              const merged: Record<string, string> = {};

              // Paginated fetch of ALL sessions from Supabase
              const PAGE_SIZE = 1000;
              let offset = 0;
              let hasMore = true;
              while (hasMore) {
                const { data: page, error } = await supabase
                  .from('sessions')
                  .select('data')
                  .order('updated_at', { ascending: false })
                  .range(offset, offset + PAGE_SIZE - 1);
                if (error) throw error;
                const rows = page ?? [];
                for (const row of rows) {
                  const d = (row as any).data;
                  if (!d) continue;
                  const entries: any[] = Array.isArray(d.entries) ? d.entries : [];
                  for (const entry of entries) {
                    if (!entry) continue;
                    const note = entry.note;
                    if (!note || String(note).trim() === '') continue;
                    const exName = String(entry.exerciseName || entry.exercise_name || '');
                    const nameKey = normalizeExerciseName(exName).toLowerCase();
                    if (nameKey && !merged[nameKey]) merged[nameKey] = String(note).trim();
                  }
                }
                hasMore = rows.length === PAGE_SIZE;
                offset += PAGE_SIZE;
              }

              // Also scan localStorage for any local-only session data
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key) continue;
                if (key.startsWith('session:') || key.startsWith('noteSeed:')) {
                  try {
                    const raw = localStorage.getItem(key) || '{}';
                    const parsed = JSON.parse(raw);
                    if (key.startsWith('session:')) {
                      const entries: any[] = Array.isArray(parsed?.entries) ? parsed.entries : [];
                      for (const entry of entries) {
                        if (!entry) continue;
                        const note = entry.note;
                        if (!note || String(note).trim() === '') continue;
                        const exName = String(entry.exerciseName || entry.exercise_name || '');
                        const nameKey = normalizeExerciseName(exName).toLowerCase();
                        if (nameKey && !merged[nameKey]) merged[nameKey] = String(note).trim();
                      }
                    } else {
                      // noteSeed key
                      for (const [ex, note] of Object.entries(parsed as Record<string, string>)) {
                        if (!note || String(note).trim() === '') continue;
                        const nameKey = normalizeExerciseName(ex).toLowerCase();
                        if (nameKey && !merged[nameKey]) merged[nameKey] = String(note).trim();
                      }
                    }
                  } catch { /* ignore */ }
                }
              }

              console.log('[notes migration v3]', Object.keys(merged).length, 'notes found:', merged);

              if (Object.keys(merged).length > 0) {
                const existing = p?.exercise_notes || {};
                const final = { ...merged, ...existing };
                await upsertUserPrefs({ exercise_notes: final });
              }
              localStorage.setItem('exercise_notes_migrated', '3');
              // Clean up old noteSeed keys
              const toRemove: string[] = [];
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key?.startsWith('noteSeed:')) toRemove.push(key);
              }
              for (const key of toRemove) localStorage.removeItem(key);
            } catch (err) {
              console.error('[notes migration v3] failed:', err);
              // Will retry next load
            }
          })();
        }

        let plan = prefs.lastPlanServerId
          ? loaded.find((p) => String(p.serverId ?? '') === String(prefs.lastPlanServerId)) || null
          : null;
        if (!plan) plan = loaded[0] ?? null;
        if (!plan) {
          setSelectedPlanId(null);
          setSelectedWeekId(null);
          setSelectedDayId(null);
          return;
        }

        // Prefer authoritative next from server completion list
        let nextWeekId: string | null = null;
        let nextDayId: string | null = null;
        if (plan.serverId) {
          try {
            const all = await sessionApi.completedList(plan.serverId);
            const done = new Set(all.map((r) => `${String(r.week_id)}::${String(r.day_id)}`));
            const ordered: Array<{ weekId: string; dayId: string }> = [];
            for (const w of plan.weeks) for (const d of w.days) ordered.push({ weekId: w.id, dayId: d.id });
            const firstIncomplete = ordered.find((d) => !done.has(`${d.weekId}::${d.dayId}`)) || ordered[ordered.length - 1] || null;
            if (firstIncomplete) {
              nextWeekId = firstIncomplete.weekId;
              nextDayId = firstIncomplete.dayId;
            }
          } catch {
            // ignore; fall back to prefs structure
          }
        }

        if (!nextWeekId || !nextDayId) {
          const week = plan.weeks.find((w) => w.id === prefs.lastWeekId) ?? plan.weeks[0] ?? null;
          const day = week?.days.find((d) => d.id === prefs.lastDayId) ?? week?.days[0] ?? null;
          nextWeekId = week?.id ?? null;
          nextDayId = day?.id ?? null;
        }

        setSelectedPlanId(plan.id);
        setSelectedWeekId(nextWeekId);
        setSelectedDayId(nextDayId);
        selectionOriginRef.current = "auto";
        setShouldAutoNavigate(false);
      } catch (err) {
        if (import.meta.env.DEV) console.error("Failed to load plans/prefs", err);
      }
    })();
  }, []);

  useEffect(() => {
    const plan = plans.find((p) => p.id === selectedPlanId) || null;
    const serverId = plan?.serverId ?? null;
    const weekId = selectedWeekId ?? null;
    const dayId = selectedDayId ?? null;
    const planIdStr: string | null = serverId == null ? null : String(serverId);
    if (prefsSaveDebounceRef.current) window.clearTimeout(prefsSaveDebounceRef.current);
    prefsSaveDebounceRef.current = window.setTimeout(() => {
      upsertUserPrefs({ last_plan_server_id: planIdStr, last_week_id: weekId, last_day_id: dayId }).catch(() => {});
      prefsSaveDebounceRef.current = null;
    }, 1200);
    return () => {
      if (prefsSaveDebounceRef.current) window.clearTimeout(prefsSaveDebounceRef.current);
    };
  }, [plans, selectedPlanId, selectedWeekId, selectedDayId]);

  useEffect(() => {
    if (mode !== "workout" || plans.length === 0) return;

    const plan = selectedPlan ?? plans[0] ?? null;
    if (!plan) return;

    if (!selectedPlanId) {
      selectPlan(plan.id, plan, "auto");
      return;
    }

    if (!shouldAutoNavigate) return;

    let cancelled = false;

    const applySelection = (weekId: string | null, dayId: string | null) => {
      if (cancelled) return;
      if (weekId !== null && weekId !== selectedWeekId) {
        setSelectedWeekId(weekId);
      }
      if (dayId !== selectedDayId) {
        setSelectedDayId(dayId);
      }
    };

    const listAllDays = (p: Plan): Array<{ weekId: string; dayId: string }> => {
      const out: Array<{ weekId: string; dayId: string }> = [];
      for (const w of p.weeks) {
        for (const d of w.days) out.push({ weekId: w.id, dayId: d.id });
      }
      return out;
    };

    const findNextDayViaCompletedList = async (): Promise<{ weekId: string; dayId: string } | null> => {
      if (!plan.serverId) return null;
      try {
        const rows = await sessionApi.completedList(plan.serverId);
        const done = new Set(rows.map((r) => `${String(r.week_id)}::${String(r.day_id)}`));
        const days = listAllDays(plan);
        for (const d of days) {
          const key = `${d.weekId}::${d.dayId}`;
          if (!done.has(key)) return d;
        }
        return days[days.length - 1] ?? null;
      } catch {
        return null;
      }
    };

    (async () => {
      // Prefer: use completed list to pick first incomplete or last
      const viaList = await findNextDayViaCompletedList();
      if (viaList) {
        applySelection(viaList.weekId, viaList.dayId);
        setShouldAutoNavigate(false);
        return;
      }

      // Fallback: next after lastCompleted when lists are unavailable
      if (plan.serverId) {
        try {
          const last = await sessionApi.lastCompleted(plan.serverId);
          if (!cancelled && last?.week_id && last?.day_id) {
            const exists = plan.weeks.some(
              (w) => w.id === String(last.week_id) && w.days.some((d) => d.id === String(last.day_id))
            );
            if (exists) {
              const next = nextWeekDay(plan, String(last.week_id), String(last.day_id));
              applySelection(next.weekId, next.dayId);
              setShouldAutoNavigate(false);
              return;
            }
          }
        } catch {
          // ignore and fall through
        }
      }

      // Final fallback: current or first
      const fallbackWeek = plan.weeks.find((w) => w.id === selectedWeekId) ?? plan.weeks[0] ?? null;
      const fallbackDay = fallbackWeek?.days.find((d) => d.id === selectedDayId) ?? fallbackWeek?.days[0] ?? null;
      if (fallbackWeek) applySelection(fallbackWeek.id, fallbackDay?.id ?? null);
      setShouldAutoNavigate(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, plans, selectedPlan, selectedPlanId, selectedWeekId, selectedDayId, shouldAutoNavigate, selectPlan]);

  useEffect(() => {
    const plan = plans.find((p) => p.id === selectedPlanId);
    const week = plan?.weeks.find((w) => w.id === selectedWeekId);
    if (!week) return;
    const stillExists = week.days.some((d) => d.id === selectedDayId);
    if (!stillExists) setSelectedDayId(week.days[0]?.id ?? null);
  }, [plans, selectedPlanId, selectedWeekId, selectedDayId]);

  useEffect(() => {
    setCompleted(false);
  }, [selectedWeekId, selectedDayId]);

  const loadArchivedPlans = async () => {
    setArchivedLoading(true);
    setArchivedError(null);
    try {
      const rows = await planApi.listArchived();
      setArchivedPlans(rows.map((row) => mapServerPlan(row)));
    } catch (err) {
      setArchivedError(err instanceof Error ? err.message : String(err));
    } finally {
      setArchivedLoading(false);
    }
  };

  const handleOpenArchive = async () => {
    setShowPlanList(false);
    setShowArchiveList(true);
    setViewArchivedPlan(null);
    setViewArchivedSessions({});
    await loadArchivedPlans();
  };

  const closeArchive = () => {
    setShowArchiveList(false);
    setViewArchivedPlan(null);
    setViewArchivedSessions({});
    setArchivedError(null);
  };

  const openArchivedPlan = async (plan: Plan) => {
    setViewArchivedPlan(plan);
    setViewArchivedSessions({});
    if (!plan.serverId) return;
    setViewArchivedLoading(true);
    try {
      const fetches = plan.weeks.flatMap((week) =>
        week.days.map(async (day) => {
          try {
            const raw = await sessionApi.last(plan.serverId!, week.id, day.id);
            if (raw && raw.entries) {
              return {
                weekId: week.id,
                dayId: day.id,
                session: {
                  id: uuid(),
                  planId: plan.id,
                  planWeekId: week.id,
                  planDayId: day.id,
                  date: raw.date ?? new Date().toISOString(),
                  entries: raw.entries.map((entry: SessionEntryPayload) => ({
                    id: uuid(),
                    exerciseId: entry.exerciseId,
                    exerciseName: entry.exerciseName ?? "Exercise",
                    sets: (entry.sets ?? []).map((set: Partial<SessionSetPayload>, index: number) => ({
                      id: uuid(),
                      setIndex: index,
                      weight: set.weight ?? null,
                      reps: set.reps ?? null,
                    })),
                  })),
                } as Session,
              };
            }
          } catch { /* ignore */ }
          return { weekId: week.id, dayId: day.id, session: null };
        })
      );
      const results = await Promise.all(fetches);
      const map: ArchivedSessionMap = {};
      for (const week of plan.weeks) map[week.id] = {};
      for (const { weekId, dayId, session: s } of results) {
        map[weekId][dayId] = s;
      }
      setViewArchivedSessions(map);
    } finally {
      setViewArchivedLoading(false);
    }
  };

  // Archived plan deletion handler removed per requirements

  const seedGhostFromPlan = async (source: Plan, target: Plan) => {
    if (!source.serverId || !target.serverId) return;
    const sourceWeek = source.weeks[source.weeks.length - 1];
    const targetWeek = target.weeks[0];
    if (!sourceWeek || !targetWeek) return;

    for (let i = 0; i < targetWeek.days.length; i++) {
      const targetDay = targetWeek.days[i];
      const sourceDay = sourceWeek.days[i];
      if (!targetDay || !sourceDay) continue;
      try {
        const raw = await sessionApi.last(source.serverId, sourceWeek.id, sourceDay.id);
        if (!raw || !raw.entries) continue;
        const sessionPayload: SessionPayload = {
          id: uuid(),
          planId: target.id,
          planWeekId: targetWeek.id,
          planDayId: targetDay.id,
          date: new Date().toISOString(),
          entries: raw.entries.map((entry: SessionEntryPayload, entryIndex: number) => ({
            id: uuid(),
            exerciseId: entry.exerciseId ?? targetDay.items[entryIndex]?.exerciseId,
            exerciseName: entry.exerciseName ?? targetDay.items[entryIndex]?.exerciseName ?? "Exercise",
            sets: (entry.sets ?? []).map((set: Partial<SessionSetPayload>, setIndex: number) => ({
              id: uuid(),
              setIndex,
              weight: set.weight ?? null,
              reps: set.reps ?? null,
            })),
          })),
        };
        sessionPayload.ghostSeed = true;
        await sessionApi.save(target.serverId, targetWeek.id, targetDay.id, sessionPayload);
      } catch {
        void 0;
      }
    }
  };

  const refreshActivePlans = async () => {
    const rows = await planApi.list();
    const mapped = rows.map((row) => mapServerPlan(row));
    setPlans(mapped);
    return mapped;
  };

  const handleReplaceExercise = (
    oldEntry: { exerciseId?: string; exerciseName: string },
    newName: string,
    scope: "today" | "remaining"
  ) => {
    if (!selectedPlan || !selectedWeekId || !selectedDayId) return;
    const trimmed = normalizeExerciseName(newName);
    if (!trimmed) return;
    const replaceRemaining = scope === "remaining";

    void (async () => {
      const resolved = await ensureExerciseByName(trimmed);
      const resolvedName = resolved?.name ?? trimmed;
      const resolvedId = resolved?.id;
      let nextPlanForSave: Plan | null = null;
      setPlans((prev) =>
        prev.map((p) => {
          if (p.id !== selectedPlan.id) return p;
          const wIdx = p.weeks.findIndex((w) => w.days.some((d) => d.id === selectedDayId));
          if (wIdx < 0) return p;
          const dIdx = p.weeks[wIdx].days.findIndex((d) => d.id === selectedDayId);
          const matchesOld = (it: PlanExercise) => {
            if (oldEntry.exerciseId && it.exerciseId) return it.exerciseId === oldEntry.exerciseId;
            const itName = normalizeExerciseName(it.exerciseName || '').toLowerCase();
            const oldName = normalizeExerciseName(oldEntry.exerciseName || '').toLowerCase();
            return itName === oldName;
          };
          const weeks = p.weeks.map((week, wi) => {
            // earlier weeks unchanged
            if (wi < wIdx) return week;

            // same week: only replace in days at/after current day when requested
            if (wi === wIdx) {
              const days = week.days.map((day, di) => {
                if (!replaceRemaining && di !== dIdx) return day; // only current day when not replacing remaining
                if (replaceRemaining && di < dIdx) return day; // keep days before current when replacing remaining
                const items = day.items.map((it) =>
                  matchesOld(it) ? { ...it, exerciseName: resolvedName, exerciseId: resolvedId } : it
                );
                return { ...day, items };
              });
              return { ...week, days };
            }

            // later weeks: if replacing remaining, replace all occurrences; otherwise keep
            if (!replaceRemaining) return week;
            const days = week.days.map((day) => ({
              ...day,
              items: day.items.map((it) =>
                matchesOld(it) ? { ...it, exerciseName: resolvedName, exerciseId: resolvedId } : it
              ),
            }));
            return { ...week, days };
          });
          const next = { ...p, weeks };
          nextPlanForSave = next;
          return next;
        })
      );
      if (nextPlanForSave && (nextPlanForSave as Plan).serverId) queuePlanSave(nextPlanForSave as Plan);

      // Update current in-memory session for current day (replace entry there too)
      setSession((s) => {
        if (!s || s.planDayId !== selectedDayId) return s;
        const matchesOldEntry = (e: SessionEntry) => {
          if (oldEntry.exerciseId && e.exerciseId) return oldEntry.exerciseId === e.exerciseId;
          const eName = normalizeExerciseName(e.exerciseName || '').toLowerCase();
          const oldName = normalizeExerciseName(oldEntry.exerciseName || '').toLowerCase();
          return eName === oldName;
        };
        const next = {
          ...s,
          entries: s.entries.map((e) => {
            if (!matchesOldEntry(e)) return e;
            const resetSets = e.sets.map((set) => ({ ...set, weight: null, reps: null }));
            return {
              ...e,
              exerciseName: resolvedName,
              exerciseId: resolvedId,
              sets: resetSets,
              note: null,
            };
          }),
        };
        try {
          localStorage.setItem(
            `session:${selectedPlan.serverId ?? selectedPlan.id}:${next.planWeekId}:${next.planDayId}`,
            JSON.stringify(next)
          );
        } catch { /* ignore */ }
        // Also attempt to save to server if plan has serverId
        if (selectedPlan.serverId) {
          sessionApi.save(selectedPlan.serverId, next.planWeekId, next.planDayId, next).catch(() => void 0);
        }
        return next;
      });
    })();
  };

  const handleInsertExercisesAt = useCallback(
    async (weekId: string, dayId: string, insertIndex: number, names: string[]) => {
      if (!selectedPlan || names.length === 0) return;
      const resolved = await Promise.all(
        names.map(async (name) => {
          const trimmed = normalizeExerciseName(name);
          const ex = trimmed ? await ensureExerciseByName(trimmed) : null;
          return { name: ex?.name ?? trimmed, id: ex?.id };
        })
      );
      let nextPlanForSave: Plan | null = null;
      setPlans((prev) =>
        prev.map((p) => {
          if (p.id !== selectedPlan.id) return p;
          const weeks = p.weeks.map((week) => {
            if (week.id !== weekId) return week;
            const days = week.days.map((day) => {
              if (day.id !== dayId) return day;
              const items = day.items.slice();
              const insertAt = Number.isFinite(insertIndex) ? Math.min(items.length, Math.max(0, insertIndex + 1)) : items.length;
              const inserts = resolved
                .filter((ex) => ex.name)
                .map((ex) => ({
                  id: uuid(),
                  exerciseName: ex.name,
                  exerciseId: ex.id,
                  targetSets: 3,
                  targetReps: '',
                }));
              if (inserts.length > 0) {
                items.splice(insertAt, 0, ...inserts);
              }
              return { ...day, items };
            });
            return { ...week, days };
          });
          const next = { ...p, weeks };
          nextPlanForSave = next;
          return next;
        })
      );
      if (nextPlanForSave && (nextPlanForSave as Plan).serverId) queuePlanSave(nextPlanForSave as Plan);
    },
    [selectedPlan, ensureExerciseByName, queuePlanSave]
  );

  const handleGhostModeChange = (mode: 'default' | 'full-body') => {
    if (!selectedPlan) return;
    setPlans(prev => prev.map(p =>
      p.id === selectedPlan.id ? { ...p, ghostMode: mode } : p
    ));
  };

  const handleFinishPlan = async () => {
    if (!selectedPlan || !selectedWeek || !selectedDay || finishingPlan) return;
    setFinishingPlan(true);
    try {
      let planToArchive = selectedPlan;
      let serverPlanId = selectedPlan.serverId;
      const payload = { weeks: selectedPlan.weeks, ghostMode: selectedPlan.ghostMode };
      if (serverPlanId) {
        await planApi.update(serverPlanId, selectedPlan.name, payload);
      } else {
        const created = await planApi.create(selectedPlan.name, payload);
        if (!created?.id) throw new Error("Failed to save plan before archiving");
        serverPlanId = created.id;
        planToArchive = { ...selectedPlan, serverId: serverPlanId };
        setPlans((prev) =>
          prev.map((p) => (p.id === selectedPlan.id ? { ...p, serverId: serverPlanId! } : p))
        );
      }

      if (!serverPlanId) throw new Error("Missing plan id for archive");

      if (session) {
        await sessionApi.save(serverPlanId, session.planWeekId, session.planDayId, session);
      }

      await sessionApi.complete(serverPlanId, selectedWeek.id, selectedDay.id, true).catch(() => {});

      const rolloverRow = await planApi.rollover(serverPlanId);
      if (!rolloverRow?.id) throw new Error("Failed to archive and rollover plan");
      const newPlan = mapServerPlan(rolloverRow);
      await seedGhostFromPlan(planToArchive, newPlan);

      const refreshed = await refreshActivePlans();
      const nextPlan = refreshed.find((p) => p.serverId === rolloverRow.id) ?? newPlan;
      setShouldAutoNavigate(true);
      selectPlan(nextPlan.id, nextPlan, "auto");
      setSession(null);
      // Optimistically append archived plan locally for instant UI update
      if (planToArchive.serverId) {
        setArchivedPlans((prev) => {
          const exists = prev.some((p) => p.serverId === planToArchive.serverId);
          return exists ? prev : [...prev, planToArchive];
        });
      }
      await loadArchivedPlans();

      // Update streak and show reconfigure prompt
      await updateStreak();
      if (streakConfig?.enabled) {
        setShowStreakReconfigPrompt(true);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setFinishingPlan(false);
    }
  };

  // goToPreviousDay removed (unused)

  const handleSetCompleted = useCallback(
    async (val: boolean) => {
      setCompleted(val);
      const serverId = selectedPlan?.serverId;
      const weekId = selectedWeekId ?? null;
      const dayId = selectedDayId ?? null;
      if (serverId && weekId && dayId) {
        try {
          await sessionApi.complete(serverId, weekId, dayId, val);
          // Update streak when marking as completed
          if (val) {
            await updateStreak();
          }
        } catch { void 0; }
      }
    },
    [selectedPlan?.serverId, selectedWeekId, selectedDayId, updateStreak]
  );

  const isLastDayOfPlan = (() => {
    if (!selectedPlan || !selectedWeek || !selectedDay) return false;
    const lastWeek = selectedPlan.weeks[selectedPlan.weeks.length - 1];
    if (!lastWeek || lastWeek.id !== selectedWeek.id) return false;
    const lastDay = lastWeek.days[lastWeek.days.length - 1];
    return !!lastDay && lastDay.id === selectedDay.id;
  })();
  
  return (
    <div className="max-w-[680px] lg:max-w-[1000px] w-full mx-auto p-3 sm:p-6">
      <div className="flex justify-between items-center pb-3 mb-4 border-b border-b-subtle">
        <div className="relative flex items-center gap-2">
          {streakConfig?.enabled && (
            <div
              className="relative inline-flex items-center justify-center w-8 h-8 cursor-pointer transition-all duration-150"
              onClick={() => setShowStreakSettings(true)}
              title={`${currentStreak} day streak`}
            >
              <span
                style={{
                  filter: streakHitToday ? 'none' : 'grayscale(100%)',
                  opacity: streakHitToday ? 1 : 0.5,
                }}
                className="text-[28px] leading-none"
              >
                🔥
              </span>
              <span
                style={{
                  transform: 'translate(-50%, -45%)',
                  color: streakHitToday ? '#000' : 'var(--text-muted)',
                  textShadow: streakHitToday ? '0 0 2px rgba(255,255,255,0.8)' : 'none',
                }}
                className="absolute top-1/2 left-1/2 text-[11px] font-bold pointer-events-none"
              >
                {currentStreak}
              </span>
            </div>
          )}
          <Button onClick={() => setUserMenuOpen((v) => !v)} aria-expanded={userMenuOpen} aria-haspopup="menu">Profile</Button>
          {userMenuOpen && (
            <div role="menu" className="dropdown-menu absolute top-full left-0 bg-elevated border border-subtle rounded-md p-3 mt-2 min-w-[220px] z-30 shadow-[var(--shadow-lg)]">
              <div className="px-2 py-1 text-muted text-[13px] font-medium uppercase tracking-[0.05em]">Logged in as</div>
              <div
                className="px-2 pt-1 pb-3 whitespace-nowrap overflow-hidden text-ellipsis max-w-[220px] text-primary"
                title={user.username}
              >
                <strong>{user.username}</strong>
              </div>
              <Button onClick={() => { setUserMenuOpen(false); setShowStreakSettings(true); }} size="sm" block className="mb-2" role="menuitem">Streak Settings</Button>
              <Button onClick={() => { setUserMenuOpen(false); handleOpenArchive(); }} size="sm" block className="mb-2" role="menuitem">Archive</Button>
              <Button onClick={() => { setUserMenuOpen(false); onLogout(); }} size="sm" block role="menuitem">Logout</Button>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => { setUserMenuOpen(false); setMode("builder"); setShowPlanList(false); setSelectedPlanId(null); }}
            style={{
              background: mode === "builder" ? "var(--accent-muted)" : "var(--bg-card)",
              borderColor: mode === "builder" ? "var(--border-strong)" : "var(--border-default)"
            }}
            aria-pressed={mode === "builder"}
          >Builder</Button>
          <Button
            onClick={() => { setUserMenuOpen(false); setMode("workout"); }}
            style={{
              background: mode === "workout" ? "var(--accent-muted)" : "var(--bg-card)",
              borderColor: mode === "workout" ? "var(--border-strong)" : "var(--border-default)"
            }}
            aria-pressed={mode === "workout"}
          >Workout</Button>
        </div>
      </div>

      {mode === "builder" && (
        <div className="page-enter" key="builder-page"><BuilderPage
          plans={plans}
          setPlans={setPlans}
          selectedPlanId={selectedPlanId}
          selectedWeekId={selectedWeekId}
          selectedDayId={selectedDayId}
          onSelectPlan={selectPlan}
          setSelectedWeekId={setSelectedWeekId}
          setSelectedDayId={setSelectedDayId}
          showPlanList={showPlanList}
          setShowPlanList={setShowPlanList}
          exerciseLoading={exerciseLoading || catalogLoading}
          catalogExercises={searchCatalogExercises}
          catalogLoading={catalogLoading}
          onResolveExerciseName={ensureExerciseByName}
          onCreateCustomExercise={createCustomExercise}
          onDeleteCustomExercise={deleteCustomExercise}
          onSaved={(savedPlan) => {
            // Go to workout with the just-saved plan selected
            const nextWeekId = savedPlan.weeks[0]?.id ?? null;
            const nextDayId = savedPlan.weeks[0]?.days[0]?.id ?? null;
            selectionOriginRef.current = "auto";
            setMode("workout");
            setSelectedPlanId(savedPlan.id);
            setSelectedWeekId(nextWeekId);
            setSelectedDayId(nextDayId);
            // We set explicit selection; disable auto picker to avoid overrides
            setShouldAutoNavigate(false);
          }}
        /></div>
      )}

      {mode === "workout" && (
        <div className="page-enter" key="workout-page">
        <Card>
          <div className="flex flex-col gap-3 mb-4">
            <div className="flex gap-3 items-center">
              <label className="text-secondary font-medium text-[15px]">Plan:</label>
              <select
                value={selectedPlanId ?? ''}
                onChange={(e) => {
                  const newPlanId = e.target.value || null;
                  selectPlan(newPlanId);
                  setSession(null);
                }}
                             >
                {plans.length === 0 && <option value="">No plans yet</option>}
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {selectedPlan && selectedWeekId && selectedDayId && (
                <>
                  <Button
                    onClick={() => {
                      const prev = prevWeekDay(selectedPlan, selectedWeekId, selectedDayId);
                      setSelectedWeekId(prev.weekId);
                      setSelectedDayId(prev.dayId);
                      setSession(null);
                      setShouldAutoNavigate(false);
                    }}
                    size="sm"
                  >Previous</Button>
                  <Button
                    onClick={() => {
                      const next = nextWeekDay(selectedPlan, selectedWeekId, selectedDayId);
                      setSelectedWeekId(next.weekId);
                      setSelectedDayId(next.dayId);
                      setSession(null);
                      setShouldAutoNavigate(false);
                    }}
                    size="sm"
                  >Next</Button>
                </>
              )}
            </div>

            {selectedPlan && (
              <div className="flex gap-3 items-center flex-wrap">
                <label className="text-secondary font-medium text-[15px]">Week:</label>
                <select
                  value={selectedWeekId ?? ''}
                  onChange={(e) => {
                    const newWeekId = e.target.value || null;
                    setSelectedWeekId(newWeekId);
                    const wk = selectedPlan.weeks.find((w) => w.id === newWeekId) || null;
                    setSelectedDayId(wk?.days[0]?.id ?? null);
                    setSession(null);
                    setShouldAutoNavigate(false);
                  }}
                                 >
                  {selectedPlan.weeks.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>

                <label className="text-secondary font-medium text-[15px]">Day:</label>
                <select
                  value={selectedDayId ?? ''}
                  onChange={(e) => {
                    setSelectedDayId(e.target.value || null);
                    setSession(null);
                    setShouldAutoNavigate(false);
                  }}
                                 >
                  {(selectedWeek ?? { days: [] as PlanDay[] }).days.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>

                <Button
                  onClick={() => setShowPlanSettings(true)}
                  size="sm"
                  title="Plan Settings"
                >
                  Settings
                </Button>
              </div>
            )}
          </div>

          {!selectedPlan ? (
            <p className="text-muted">No plan selected.</p>
          ) : !selectedDay ? (
            <div className="text-muted">Select a day.</div>
          ) : (
            <>
              <WorkoutPage
                plan={selectedPlan}
                day={selectedDay}
                session={session}
                setSession={setSession}
                onReplaceExercise={handleReplaceExercise}
                exerciseOptions={exerciseOptions}
                catalogExercises={searchCatalogExercises}
                onInsertExercisesAt={handleInsertExercisesAt}
                onCreateCustomExercise={createCustomExercise}
                onDeleteCustomExercise={deleteCustomExercise}
                onMarkDone={async () => {
                  if (!selectedPlan || !selectedWeek || !selectedDay) return;
                  setCompleted(true);
                  const serverId = selectedPlan.serverId;
                  if (serverId) {
                    try {
                      await sessionApi.complete(serverId, selectedWeek.id, selectedDay.id, true);
                    } catch { void 0; }
                  }

                  // Update streak
                  await updateStreak();

                  const nxt = nextWeekDay(selectedPlan, selectedWeek.id, selectedDay.id);
                  setSelectedWeekId(nxt.weekId);
                  setSelectedDayId(nxt.dayId);
                  setSession(null);
                  setShouldAutoNavigate(false);
                }}
                completed={completed}
                setCompleted={handleSetCompleted}
                isLastDay={isLastDayOfPlan}
                onFinishPlan={handleFinishPlan}
                finishingPlan={finishingPlan}
                onUpdatePlan={(updatedPlan) => {
                  setPlans(prev => prev.map(p => p.id === updatedPlan.id ? updatedPlan : p));
                  if (updatedPlan.serverId) {
                    const payload = { weeks: updatedPlan.weeks, ghostMode: updatedPlan.ghostMode };
                    planApi.update(updatedPlan.serverId, updatedPlan.name, payload).catch(() => void 0);
                  }
                }}
              />
            </>
          )}
        </Card>
        </div>
      )}
      <Modal open={showArchiveList} onClose={closeArchive} title="Archived Plans" maxWidth={950} maxHeight="80vh" zIndex={20}>
            {archivedError && <div className="text-error px-3 py-2 bg-error-muted rounded-sm">{archivedError}</div>}
            {archivedLoading ? (
              <div className="text-muted p-6 text-center">Loading archived plans...</div>
            ) : archivedPlans.length === 0 ? (
              <div className="text-muted p-6 text-center">No archived plans yet.</div>
            ) : (
              <div className="flex gap-4 flex-wrap">
                <div className="flex-[0_0_280px] flex flex-col gap-3">
                  {archivedPlans.map((plan) => (
                    <div
                      key={plan.id}
                      style={{
                        background: viewArchivedPlan?.id === plan.id ? 'var(--accent-muted)' : 'var(--bg-card)',
                        border: `1px solid ${viewArchivedPlan?.id === plan.id ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
                      }}
                      className="rounded-md p-3 flex justify-between items-center gap-3 transition-all duration-150"
                    >
                      <Button onClick={() => openArchivedPlan(plan)} className="flex-1 text-left">
                        {plan.name}
                      </Button>
                      <div className="flex gap-2">
                        <Button onClick={() => handleDeleteArchivedPlan(plan)} size="sm">Delete</Button>
                        <Button onClick={() => exportPlanCSV(plan, buildCatalogByName(searchCatalogExercises))} size="sm">Export</Button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex-1 min-w-[320px] bg-card border border-subtle rounded-md p-4 max-h-[60vh] overflow-y-auto">
                  {!viewArchivedPlan ? (
                    <div className="text-muted p-6 text-center">Select an archived plan to view details.</div>
                  ) : viewArchivedLoading ? (
                    <div className="text-muted p-6 text-center">Loading sessions...</div>
                  ) : (
                    <div>
                      <h3 className="mt-0">{viewArchivedPlan.name}</h3>
                      {viewArchivedPlan.weeks.map((week) => {
                        const sessionWeek = viewArchivedSessions[week.id] || {};
                        return (
                          <div key={week.id} className="mb-4">
                            <h4 className="mb-2">{week.name}</h4>
                            {week.days.map((day) => {
                              const session = sessionWeek[day.id] || null;
                              return (
                                <div key={day.id} className="mb-3">
                                  <h5 className="my-1.5">{day.name}</h5>
                                  {day.items.length === 0 ? (
                                    <div className="text-muted">No exercises defined for this day.</div>
                                  ) : (
                                    <div className="flex flex-col gap-2">
                                      {day.items.map((item) => {
                                        const entry = session?.entries?.find((entry) => {
                                          if (item.exerciseId && entry.exerciseId) return item.exerciseId === entry.exerciseId;
                                          const entryName = normalizeExerciseName(entry.exerciseName || '').toLowerCase();
                                          const itemName = normalizeExerciseName(item.exerciseName || '').toLowerCase();
                                          if (item.exerciseId && !entry.exerciseId) return entryName === itemName;
                                          return entryName === itemName;
                                        }) || null;
                                        const sets = entry?.sets ?? [];
                                        const rowCount = Math.max(item.targetSets, sets.length);
                                        return (
                                          <div key={item.id} className="bg-elevated border border-subtle rounded-md p-3">
                                            <div className="font-semibold text-[15px]">{item.exerciseName}</div>
                                            <div className="text-[13px] text-muted mb-2">
                                              Target: {item.targetSets} set{item.targetSets === 1 ? '' : 's'}
                                              {item.targetReps ? ` - ${item.targetReps}` : ''}
                                            </div>
                                            {rowCount === 0 ? (
                                              <div className="text-muted text-[13px]">No recorded sets.</div>
                                            ) : (
                                              <table className="w-full border-collapse text-[13px]">
                                                <thead>
                                                  <tr className="text-left">
                                                    <th className="py-1.5 border-b border-b-subtle text-muted font-medium text-[11px] uppercase">Set</th>
                                                    <th className="py-1.5 border-b border-b-subtle text-muted font-medium text-[11px] uppercase">Weight</th>
                                                    <th className="py-1.5 border-b border-b-subtle text-muted font-medium text-[11px] uppercase">Reps</th>
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {Array.from({ length: rowCount }).map((_, idx) => {
                                                    const recorded = sets[idx];
                                                    return (
                                                      <tr key={idx} className="border-b border-b-subtle">
                                                        <td className="py-2 text-secondary">{idx + 1}</td>
                                                        <td className="py-2" style={{ fontWeight: recorded?.weight != null ? 600 : 400 }}>{recorded?.weight ?? '-'}</td>
                                                        <td className="py-2" style={{ fontWeight: recorded?.reps != null ? 600 : 400 }}>{recorded?.reps ?? '-'}</td>
                                                      </tr>
                                                    );
                                                  })}
                                                </tbody>
                                              </table>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
      </Modal>

      {/* Streak Settings Modal */}
      <Modal open={showStreakSettings} onClose={() => setShowStreakSettings(false)} title="Streak Settings" maxWidth={420}>

            {/* Current streak display */}
            {streakConfig?.enabled && (
              <div className="bg-card border border-subtle rounded-md p-4 mb-6 text-center">
                <div className="text-[48px] mb-2">🔥</div>
                <div className="text-[28px] font-bold">{currentStreak}</div>
                <div className="text-muted text-[15px]">
                  {currentStreak === 1 ? 'day streak' : 'day streak'}
                </div>
                {streakState?.longestStreak != null && streakState.longestStreak > 0 && (
                  <div className="text-muted text-[13px] mt-2">
                    Longest: {streakState.longestStreak} days
                  </div>
                )}
              </div>
            )}

            {/* Enable/disable toggle */}
            <div className="flex justify-between items-center py-3 border-b border-b-subtle">
              <span className="font-medium">Enable Streak Tracking</span>
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={streakConfig?.enabled ?? false}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    if (enabled && !streakConfig) {
                      // Initialize new streak config
                      const newConfig: StreakConfig = {
                        enabled: true,
                        scheduleMode: 'daily',
                        startDate: new Date().toISOString().split('T')[0],
                        timezone: getUserTimezone(),
                      };
                      setStreakConfig(newConfig);
                      setStreakState({ currentStreak: 0, longestStreak: 0, lastWorkoutDate: null });
                      setCurrentStreak(0);
                      upsertUserPrefs({ streak_config: newConfig, streak_state: { currentStreak: 0, longestStreak: 0, lastWorkoutDate: null } });
                    } else if (streakConfig) {
                      const updated = { ...streakConfig, enabled };
                      setStreakConfig(updated);
                      upsertUserPrefs({ streak_config: updated });
                    }
                  }}
                  className="w-5 h-5"
                />
              </label>
            </div>

            {/* Schedule mode selection */}
            {streakConfig?.enabled && (
              <>
                <div className="mt-5">
                  <div className="font-medium mb-3">Schedule Mode</div>
                  <div className="flex gap-2">
                    {(['daily', 'rolling', 'weekly'] as StreakScheduleMode[]).map((mode) => (
                      <Button
                        key={mode}
                        onClick={() => {
                          const updated: StreakConfig = {
                            ...streakConfig,
                            scheduleMode: mode,
                            startDate: new Date().toISOString().split('T')[0],
                          };
                          if (mode === 'rolling' && !updated.rollingDaysOn) {
                            updated.rollingDaysOn = 3;
                            updated.rollingDaysOff = 1;
                          }
                          if (mode === 'weekly' && !updated.weeklyDays) {
                            updated.weeklyDays = [1, 2, 3, 4, 5]; // Mon-Fri
                          }
                          setStreakConfig(updated);
                          // Reset streak when changing mode
                          const resetState = { currentStreak: 0, longestStreak: streakState?.longestStreak ?? 0, lastWorkoutDate: null };
                          setStreakState(resetState);
                          setCurrentStreak(0);
                          setStreakHitToday(false);
                          upsertUserPrefs({ streak_config: updated, streak_state: resetState });
                        }}
                        style={{
                          background: streakConfig.scheduleMode === mode ? 'var(--accent-muted)' : 'var(--bg-card)',
                          borderColor: streakConfig.scheduleMode === mode ? 'var(--border-strong)' : 'var(--border-default)',
                        }}
                        className="flex-1 capitalize"
                      >
                        {mode}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Rolling mode settings */}
                {streakConfig.scheduleMode === 'rolling' && (
                  <div className="mt-4">
                    <div className="flex gap-3 items-center">
                      <div className="flex-1">
                        <label className="text-[13px] text-muted block mb-1">Days On</label>
                        <input
                          type="number"
                          min={1}
                          max={14}
                          value={streakConfig.rollingDaysOn ?? 3}
                          onChange={(e) => {
                            const val = Math.max(1, Math.min(14, parseInt(e.target.value) || 1));
                            const updated = { ...streakConfig, rollingDaysOn: val, startDate: new Date().toISOString().split('T')[0] };
                            setStreakConfig(updated);
                            upsertUserPrefs({ streak_config: updated });
                          }}
                          className="w-full"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-[13px] text-muted block mb-1">Days Off</label>
                        <input
                          type="number"
                          min={1}
                          max={14}
                          value={streakConfig.rollingDaysOff ?? 1}
                          onChange={(e) => {
                            const val = Math.max(1, Math.min(14, parseInt(e.target.value) || 1));
                            const updated = { ...streakConfig, rollingDaysOff: val, startDate: new Date().toISOString().split('T')[0] };
                            setStreakConfig(updated);
                            upsertUserPrefs({ streak_config: updated });
                          }}
                          className="w-full"
                        />
                      </div>
                    </div>
                    <div className="mt-2 text-[13px] text-muted">
                      Example: {streakConfig.rollingDaysOn ?? 3} days on, {streakConfig.rollingDaysOff ?? 1} day{(streakConfig.rollingDaysOff ?? 1) !== 1 ? 's' : ''} off
                    </div>
                  </div>
                )}

                {/* Weekly mode settings */}
                {streakConfig.scheduleMode === 'weekly' && (
                  <div className="mt-4">
                    <label className="text-[13px] text-muted block mb-2">Workout Days</label>
                    <div className="flex gap-2 flex-wrap">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dayName, idx) => {
                        const selected = streakConfig.weeklyDays?.includes(idx) ?? false;
                        return (
                          <Button
                            key={dayName}
                            onClick={() => {
                              const days = new Set(streakConfig.weeklyDays ?? []);
                              if (selected) {
                                days.delete(idx);
                              } else {
                                days.add(idx);
                              }
                              const updated = { ...streakConfig, weeklyDays: Array.from(days).sort((a, b) => a - b) };
                              setStreakConfig(updated);
                              upsertUserPrefs({ streak_config: updated });
                            }}
                            size="sm"
                            style={{
                              background: selected ? 'var(--accent-muted)' : 'var(--bg-card)',
                              borderColor: selected ? 'var(--border-strong)' : 'var(--border-default)',
                            }}
                            className="min-w-[44px]"
                          >
                            {dayName}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Reset streak button */}
                <div className="mt-6 pt-4 border-t border-subtle">
                  <Button
                    onClick={() => {
                      if (confirm('Reset your streak to 0? This cannot be undone.')) {
                        const resetState = { currentStreak: 0, longestStreak: streakState?.longestStreak ?? 0, lastWorkoutDate: null };
                        setStreakState(resetState);
                        setCurrentStreak(0);
                        setStreakHitToday(false);
                        upsertUserPrefs({ streak_state: resetState });
                      }
                    }}
                    size="sm"
                    className="text-error"
                  >
                    Reset Streak
                  </Button>
                </div>
              </>
            )}
      </Modal>

      {/* Plan Settings Modal */}
      <Modal open={!!(showPlanSettings && selectedPlan)} onClose={() => setShowPlanSettings(false)} title="Plan Settings" maxWidth={360}>
        {selectedPlan && (
          <>
            <div className="mb-4">
              <label className="block mb-2 font-medium text-secondary text-[15px]">
                Plan Type
              </label>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleGhostModeChange('default')}
                  style={{
                    background: (selectedPlan.ghostMode ?? 'default') === 'default' ? 'var(--accent-muted)' : 'var(--bg-card)',
                    borderColor: (selectedPlan.ghostMode ?? 'default') === 'default' ? 'var(--border-strong)' : 'var(--border-default)',
                  }}
                  className="flex-1"
                >
                  Default
                </Button>
                <Button
                  onClick={() => handleGhostModeChange('full-body')}
                  style={{
                    background: selectedPlan.ghostMode === 'full-body' ? 'var(--accent-muted)' : 'var(--bg-card)',
                    borderColor: selectedPlan.ghostMode === 'full-body' ? 'var(--border-strong)' : 'var(--border-default)',
                  }}
                  className="flex-1"
                >
                  Full Body
                </Button>
              </div>
              <p className="text-[13px] text-muted mt-2 leading-[1.4]">
                {(selectedPlan.ghostMode ?? 'default') === 'default'
                  ? 'Ghost shows your most recent performance regardless of day.'
                  : 'Ghost only shows performance from the same day (e.g., Tuesday vs Tuesday).'}
              </p>
            </div>

            <Button
              onClick={async () => {
                if (!selectedPlan.serverId) return;
                const payload = { weeks: selectedPlan.weeks, ghostMode: selectedPlan.ghostMode };
                await planApi.update(selectedPlan.serverId, selectedPlan.name, payload);
                setShowPlanSettings(false);
                window.location.reload();
              }}
              block
              style={{ background: 'var(--accent-muted)', borderColor: 'var(--border-strong)' }}
            >
              Save & Apply
            </Button>
          </>
        )}
      </Modal>

      {/* Streak Reconfigure Prompt (after Finish & Archive) */}
      <Modal open={showStreakReconfigPrompt} onClose={() => setShowStreakReconfigPrompt(false)} maxWidth={360}>
        <div className="text-center">
          <div className="text-[48px] mb-3">🎉</div>
          <h3 className="mt-0 mb-2 text-lg">Plan Complete!</h3>
          <p className="text-muted mb-6">
            Great work finishing your plan. Would you like to update your streak schedule?
          </p>
          <div className="flex gap-3 justify-center">
            <Button
              onClick={() => setShowStreakReconfigPrompt(false)}
            >
              Keep Current
            </Button>
            <Button
              onClick={() => {
                setShowStreakReconfigPrompt(false);
                setShowStreakSettings(true);
              }}
              style={{ background: 'var(--accent-muted)', borderColor: 'var(--border-strong)' }}
            >
              Update Schedule
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
function WorkoutPage({
  plan,
  day,
  session,
  setSession,
  onReplaceExercise,
  exerciseOptions,
  catalogExercises,
  onInsertExercisesAt,
  onCreateCustomExercise,
  onDeleteCustomExercise,
  onMarkDone,
  completed,
  setCompleted,
  isLastDay,
  onFinishPlan,
  finishingPlan,
  onUpdatePlan,
}: {
  plan: Plan;
  day: PlanDay;
  session: Session | null;
  setSession: React.Dispatch<React.SetStateAction<Session | null>>;
  onReplaceExercise?: (oldEntry: { exerciseId?: string; exerciseName: string }, newName: string, scope: "today" | "remaining") => void;
  exerciseOptions: string[];
  catalogExercises: CatalogExercise[];
  onInsertExercisesAt?: (weekId: string, dayId: string, insertIndex: number, names: string[]) => Promise<void>;
  onCreateCustomExercise?: (input: {
    name: string;
    primaryMuscle: string;
    equipment: "machine" | "free_weight" | "cable" | "body_weight";
    isCompound: boolean;
    secondaryMuscles?: string[];
  }) => Promise<CatalogExercise>;
  onDeleteCustomExercise?: (id: string) => Promise<void>;
  onMarkDone: () => void;
  completed: boolean;
  setCompleted: (value: boolean) => void | Promise<void>;
  isLastDay: boolean;
  onFinishPlan?: () => void;
  finishingPlan: boolean;
  onUpdatePlan: (plan: Plan) => void;
}) {
  const [replaceSearchOpen, setReplaceSearchOpen] = useState(false);
  const [replaceTargetEntry, setReplaceTargetEntry] = useState<{ exerciseId?: string; exerciseName: string } | null>(null);
  const [replaceTargetIndex, setReplaceTargetIndex] = useState<number | null>(null);
  const [replaceSearchText, setReplaceSearchText] = useState("");
  const [replaceSearchPrimary, setReplaceSearchPrimary] = useState<string>("All");
  const [replaceSearchSecondary, setReplaceSearchSecondary] = useState<string>("All");
  const [replaceSearchSource, setReplaceSearchSource] = useState<SearchSource>("all");
  const [replaceSearchMachine, setReplaceSearchMachine] = useState(false);
  const [replaceSearchFreeWeight, setReplaceSearchFreeWeight] = useState(false);
  const [replaceSearchCable, setReplaceSearchCable] = useState(false);
  const [replaceSearchBodyWeight, setReplaceSearchBodyWeight] = useState(false);
  const [replaceSearchCompound, setReplaceSearchCompound] = useState(false);
  const [replaceQueue, setReplaceQueue] = useState<Array<{ name: string; id?: string }>>([]);
  const [replaceAddMovementOpen, setReplaceAddMovementOpen] = useState(false);
  const [replaceAddMovementName, setReplaceAddMovementName] = useState("");
  const [replaceAddMovementPrimary, setReplaceAddMovementPrimary] = useState("");
  const [replaceAddMovementEquipment, setReplaceAddMovementEquipment] = useState<"" | "machine" | "free_weight" | "cable" | "body_weight">("");
  const [replaceAddMovementCompound, setReplaceAddMovementCompound] = useState(false);
  const [replaceAddMovementSecondary, setReplaceAddMovementSecondary] = useState("");
  const [replaceAddMovementError, setReplaceAddMovementError] = useState<string | null>(null);
  const [ghost, setGhost] = useState<Record<string, { weight: number | null; reps: number | null }[]>>({});
  const exerciseNotesRef = useRef<Record<string, string>>({});
  const exerciseNotesSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [openNotes, setOpenNotes] = useState<Record<string, boolean>>({});
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const exerciseInstructionsRef = useRef<Record<string, string>>({});
  const exerciseInstructionsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [openInstructions, setOpenInstructions] = useState<Record<string, boolean>>({});
  const [instructionsDraft, setInstructionsDraft] = useState<Record<string, string>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEntry, setHistoryEntry] = useState<{ exerciseId?: string; exerciseName: string } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<Array<{ date: string; weight: number; reps: number }>>([]);
  const [historyPr, setHistoryPr] = useState<{ date: string; weight: number; reps: number } | null>(null);
  const historyCacheRef = useRef<SessionRow[] | null>(null);
  const historicalGhostRef = useRef<Map<string, Map<number, { weight: number; reps: number }>> | null>(null);
  const [openExerciseMenu, setOpenExerciseMenu] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editDraftSets, setEditDraftSets] = useState<SessionSet[]>([]);
  const [myoScopeEntry, setMyoScopeEntry] = useState<{ entryId: string; exerciseId?: string; exerciseName: string; currentValue: boolean } | null>(null);

  useEffect(() => {
    historyCacheRef.current = null;
    historicalGhostRef.current = null;
  }, [plan.serverId, plan.ghostMode]);

  // Load global exercise notes from user prefs
  useEffect(() => {
    let cancelled = false;
    getUserPrefs().then((up) => {
      if (cancelled) return;
      const p = (up?.prefs as UserPrefsData | null) || null;
      if (p?.exercise_notes) {
        exerciseNotesRef.current = { ...p.exercise_notes };
      }
      if (p?.exercise_instructions) {
        exerciseInstructionsRef.current = { ...p.exercise_instructions };
      }
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, []);

  const catalogByNameMap = useMemo(() => {
    const m = new Map<string, CatalogExercise>();
    for (const ex of catalogExercises) m.set(ex.name.trim().toLowerCase(), ex);
    return m;
  }, [catalogExercises]);

  const currentWeek = useMemo(
    () => plan.weeks.find((w) => w.days.some((d) => d.id === day.id)) || null,
    [plan.weeks, day.id]
  );
  const currentWeekId = currentWeek?.id ?? null;

  const replacePrimaryMuscles = useMemo(() => {
    const set = new Set<string>();
    for (const ex of catalogExercises) {
      if (ex.primaryMuscle) set.add(ex.primaryMuscle);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [catalogExercises]);

  const replaceSecondaryMuscles = useMemo(() => {
    const set = new Set<string>();
    for (const ex of catalogExercises) {
      for (const m of ex.secondaryMuscles) set.add(m);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [catalogExercises]);

  const replaceFilteredCatalog = useMemo(() => {
    const text = normalizeFilterValue(replaceSearchText);
    const source = replaceSearchSource;
    const wantPrimary = replaceSearchPrimary !== "All" ? normalizeFilterValue(replaceSearchPrimary) : "";
    const wantSecondary = replaceSearchSecondary !== "All" ? normalizeFilterValue(replaceSearchSecondary) : "";
    const filtered = catalogExercises.filter((ex) => {
      const isCustom = ex.isCustom === true;
      if (text && !normalizeFilterValue(ex.name).includes(text)) return false;
      if (wantPrimary && normalizeFilterValue(ex.primaryMuscle) !== wantPrimary) return false;
      if (wantSecondary && !ex.secondaryMuscles.some((m) => normalizeFilterValue(m) === wantSecondary)) return false;
      if (source === "defaults" && isCustom) return false;
      if (source === "home_made" && !isCustom) return false;
      if (replaceSearchMachine && !ex.machine) return false;
      if (replaceSearchFreeWeight && !ex.freeWeight) return false;
      if (replaceSearchCable && !ex.cable) return false;
      if (replaceSearchBodyWeight && !ex.bodyWeight) return false;
      if (replaceSearchCompound && !ex.isCompound) return false;
      return true;
    });
    const byName = new Map<string, CatalogExercise>();
    for (const ex of filtered) {
      const key = normalizeFilterValue(ex.name);
      if (!key) continue;
      const existing = byName.get(key);
      if (!existing || (ex.isCustom && !existing.isCustom)) {
        byName.set(key, ex);
      }
    }
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [
    catalogExercises,
    replaceSearchText,
    replaceSearchPrimary,
    replaceSearchSecondary,
    replaceSearchSource,
    replaceSearchMachine,
    replaceSearchFreeWeight,
    replaceSearchCable,
    replaceSearchBodyWeight,
    replaceSearchCompound,
  ]);

  const openReplaceSearch = (entry: SessionEntry, entryIndex: number) => {
    setReplaceTargetEntry({ exerciseId: entry.exerciseId, exerciseName: entry.exerciseName });
    setReplaceTargetIndex(entryIndex);
    setReplaceQueue([]);
    setReplaceSearchOpen(true);
  };

  const closeReplaceSearch = () => {
    setReplaceSearchOpen(false);
    setReplaceQueue([]);
    setReplaceAddMovementOpen(false);
    resetReplaceAddMovement();
  };

  const addReplaceQueue = (ex: CatalogExercise) => {
    setReplaceQueue((prev) => {
      const exists = prev.some((p) => p.name.toLowerCase() === ex.name.toLowerCase());
      if (exists) return prev;
      return [...prev, { name: ex.name, id: ex.id }];
    });
  };

  const removeReplaceQueue = (name: string) => {
    setReplaceQueue((prev) => prev.filter((q) => q.name.toLowerCase() !== name.toLowerCase()));
  };

  const applyReplaceQueue = async (scope: "today" | "remaining") => {
    if (!replaceTargetEntry || replaceQueue.length === 0) return;
    const first = replaceQueue[0];
    if (typeof onReplaceExercise === "function") {
      onReplaceExercise(replaceTargetEntry, first.name, scope);
    }
    historyCacheRef.current = null;
    const extras = replaceQueue.slice(1).map((q) => q.name);
    if (extras.length > 0 && typeof onInsertExercisesAt === "function" && currentWeekId && replaceTargetIndex != null) {
      await onInsertExercisesAt(currentWeekId, day.id, replaceTargetIndex, extras);
    }
    closeReplaceSearch();
  };

  const resetReplaceAddMovement = () => {
    setReplaceAddMovementName("");
    setReplaceAddMovementPrimary("");
    setReplaceAddMovementEquipment("");
    setReplaceAddMovementCompound(false);
    setReplaceAddMovementSecondary("");
    setReplaceAddMovementError(null);
  };

  const handleReplaceAddMovement = async () => {
    const name = normalizeExerciseName(replaceAddMovementName);
    if (!name) {
      setReplaceAddMovementError("Enter a name.");
      return;
    }
    if (!replaceAddMovementPrimary) {
      setReplaceAddMovementError("Select a primary muscle.");
      return;
    }
    if (!replaceAddMovementEquipment) {
      setReplaceAddMovementError("Select machine, free weight, cable, or bodyweight.");
      return;
    }
    setReplaceAddMovementError(null);
    try {
      if (!onCreateCustomExercise) throw new Error("Custom movements are unavailable.");
      await onCreateCustomExercise({
        name,
        primaryMuscle: replaceAddMovementPrimary,
        equipment: replaceAddMovementEquipment,
        isCompound: replaceAddMovementCompound,
        secondaryMuscles: replaceAddMovementCompound && replaceAddMovementSecondary ? [replaceAddMovementSecondary] : [],
      });
      resetReplaceAddMovement();
      setReplaceAddMovementOpen(false);
    } catch (err) {
      setReplaceAddMovementError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteCustomFromReplace = async (ex: CatalogExercise) => {
    if (!ex.isCustom) return;
    if (!onDeleteCustomExercise) {
      alert("Custom movements are unavailable.");
      return;
    }
    if (!window.confirm(`Delete "${ex.name}"?`)) return;
    try {
      await onDeleteCustomExercise(ex.id);
      setReplaceQueue((prev) => prev.filter((q) => q.name.toLowerCase() !== ex.name.toLowerCase()));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (!currentWeek) return;

    (async () => {
      const serverId = plan.serverId;
      if (serverId) {
        try {
          const latest: SessionPayload | null = await sessionApi.last(serverId, currentWeek.id, day.id);
          if (latest && latest.entries) {
            if (latest.ghostSeed) {
              const ghostMap: Record<string, { weight: number | null; reps: number | null }[]> = {};
              for (const entry of latest.entries ?? []) {
                const key = exerciseKey(entry);
                ghostMap[key] = (entry.sets ?? []).map((set: Partial<SessionSetPayload>) => ({
                  weight: set.weight ?? null,
                  reps: set.reps ?? null,
                }));
                const nameKey = `name:${normalizeExerciseName(entry.exerciseName || '').toLowerCase()}`;
                if (nameKey && !ghostMap[nameKey]) ghostMap[nameKey] = ghostMap[key];
              }
              setGhost(ghostMap);
              setSession(startSessionFromDay(plan, currentWeek.id, day.id));
              setCompleted(false);
              return;
            }
            setSession(latest as unknown as Session);
            setCompleted(!!latest.completed);
            return;
          }
        } catch {
          void 0;
        }
      }

      setSession(startSessionFromDay(plan, currentWeek.id, day.id));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.serverId, currentWeekId, day.id]);

  useEffect(() => {
    if (!currentWeekId) {
      setCompleted(false);
      return;
    }

    const serverId = plan.serverId;
    if (!serverId) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await sessionApi.status(serverId, currentWeekId, day.id);
        if (!cancelled) setCompleted(!!res?.completed);
      } catch {
        // keep prior state on transient errors
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [plan.serverId, currentWeekId, day.id, setCompleted]);

  useEffect(() => {
    const serverId = plan.serverId;
    if (!currentWeekId) {
      setGhost({});
      return;
    }

    let cancelled = false;

    const readSessionForDay = async (weekId: string, dayId: string) => {
      let payload: SessionPayload | null = null;
      if (serverId) {
        try {
          payload = await sessionApi.last(serverId, weekId, dayId);
        } catch {
          /* ignore and try local */
        }
      }
      if (!payload) {
        const keysToTry: string[] = [];
        if (serverId) keysToTry.push(`session:${serverId}:${weekId}:${dayId}`);
        keysToTry.push(`session:${plan.id}:${weekId}:${dayId}`);
        for (const k of keysToTry) {
          try {
            const raw = localStorage.getItem(k);
            if (raw) {
              const parsed = JSON.parse(raw) as SessionPayload;
              if (parsed && parsed.entries) {
                payload = parsed;
                break;
              }
            }
          } catch {
            /* ignore */
          }
        }
      }
      return payload;
    };

    const matchesTarget = (
      entry: { exerciseId?: string; exerciseName?: string | null },
      target: { exerciseId?: string; exerciseName: string }
    ) => {
      if (target.exerciseId && entry.exerciseId) return String(target.exerciseId) === String(entry.exerciseId);
      const entryName = normalizeExerciseName(entry.exerciseName || '').toLowerCase();
      const targetName = normalizeExerciseName(target.exerciseName || '').toLowerCase();
      if (target.exerciseId && !entry.exerciseId) return entryName === targetName;
      return entryName === targetName;
    };

    (async () => {
      try {
        const ordered: Array<{ weekId: string; dayId: string; dayIndex: number; dayName: string }> = [];
        for (const w of plan.weeks) {
          for (let di = 0; di < w.days.length; di++) {
            ordered.push({ weekId: w.id, dayId: w.days[di].id, dayIndex: di, dayName: w.days[di].name.trim().toLowerCase() });
          }
        }
        const currentIdx = ordered.findIndex((d) => d.dayId === day.id && d.weekId === currentWeekId);
        if (currentIdx <= 0) {
          return;
        }

        const targets = day.items.map((item) => ({
          exerciseId: item.exerciseId,
          exerciseName: item.exerciseName,
        }));
        if (targets.length === 0) {
          setGhost({});
          return;
        }

        const ghostMap: Record<string, { weight: number | null; reps: number | null }[]> = {};
        const remaining = new Set(targets.map((t) => exerciseKey(t)));
        const ghostMode = plan.ghostMode ?? 'default';
        const currentDayName = day.name.trim().toLowerCase();

        for (let idx = currentIdx - 1; idx >= 0; idx--) {
          if (remaining.size === 0) break;
          const prev = ordered[idx];
          // In full-body mode, only look at days with the same name
          if (ghostMode === 'full-body' && prev.dayName !== currentDayName) continue;
          const payload = await readSessionForDay(prev.weekId, prev.dayId);
          if (!payload || !payload.entries) continue;

          for (const entry of payload.entries) {
            for (const target of targets) {
              const targetKey = exerciseKey(target);
              if (!remaining.has(targetKey)) continue;
              if (!matchesTarget(entry, target)) continue;

              const sets = (entry.sets || []).map((s: Partial<SessionSetPayload>) => ({
                weight: s.weight ?? null,
                reps: s.reps ?? null,
              }));
              ghostMap[targetKey] = sets;
              const nameKey = `name:${normalizeExerciseName(target.exerciseName).toLowerCase()}`;
              if (nameKey && !ghostMap[nameKey]) ghostMap[nameKey] = sets;

              remaining.delete(targetKey);
            }
          }
        }

        if (!cancelled) {
          if (Object.keys(ghostMap).length > 0) setGhost(ghostMap);
          else setGhost({});

          // Load historical ghost data for sets that might not have regular ghost
          void loadHistoricalGhost(targets);
        }
      } catch {
        if (!cancelled) {
          setGhost({});
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [plan.serverId, currentWeekId, plan.weeks, day.id, plan.id]);

  // Populate notes from global exercise notes
  useEffect(() => {
    if (!session || session.planDayId !== day.id) return;
    const notes = exerciseNotesRef.current;
    if (!notes || Object.keys(notes).length === 0) return;
    const nextEntries = session.entries.map((e) => {
      const hasNote = !!(e.note && String(e.note).trim() !== "");
      if (hasNote) return e;
      const nameKey = normalizeExerciseName(e.exerciseName || '').toLowerCase();
      const suggested = notes[nameKey];
      if (!suggested || String(suggested).trim() === "") return e;
      return { ...e, note: suggested };
    });
    const changed = nextEntries.some((e, i) => e.note !== session.entries[i].note);
    if (changed) {
      const next: Session = { ...session, entries: nextEntries };
      setSession(next);
      try {
        localStorage.setItem(
          `session:${plan.serverId ?? plan.id}:${next.planWeekId}:${next.planDayId}`,
          JSON.stringify(next)
        );
      } catch { /* ignore */ }
      if (plan.serverId) {
        sessionApi.save(plan.serverId, next.planWeekId, next.planDayId, next).catch(() => void 0);
      }
    }
  }, [session, day.id]);

  // Merge session with updated plan day (preserve existing weights/reps)
  useEffect(() => {
    if (!session || session.planDayId !== day.id) return;
    const merged = mergeSessionWithDay(day, session);
    const a = JSON.stringify(session.entries.map((e) => ({ n: e.exerciseName, s: e.sets.length })));
    const b = JSON.stringify(merged.entries.map((e) => ({ n: e.exerciseName, s: e.sets.length })));
    if (a !== b) {
      setSession(merged);
      try {
        localStorage.setItem(
          `session:${plan.serverId ?? plan.id}:${merged.planWeekId}:${merged.planDayId}`,
          JSON.stringify(merged)
        );
      } catch { /* ignore */ }
      if (plan.serverId) {
        sessionApi.save(plan.serverId, merged.planWeekId, merged.planDayId, merged).catch(() => void 0);
      }
    }
  }, [plan.id, plan.serverId, day.items, session]);


  const getGhost = (exerciseId: string | undefined, exerciseName: string, idx: number): GhostSet => {
    const keys: string[] = [];
    if (exerciseId) keys.push(`id:${exerciseId}`);
    const nameKey = `name:${normalizeExerciseName(exerciseName).toLowerCase()}`;
    if (nameKey) keys.push(nameKey);

    // Tier 1: Regular ghost (from same-day previous session)
    for (const key of keys) {
      const arr = ghost[key];
      if (arr && arr[idx] && (arr[idx].weight != null || arr[idx].reps != null)) {
        return { weight: arr[idx].weight, reps: arr[idx].reps };
      }
    }

    // Tier 2: Historical ghost (from past sessions)
    const histData = historicalGhostRef.current;
    if (histData) {
      for (const key of keys) {
        const setMap = histData.get(key);
        if (setMap && setMap.has(idx)) {
          const histSet = setMap.get(idx)!;
          return { weight: histSet.weight, reps: histSet.reps };
        }
      }
    }

    // Tier 3: Previous-set fallback (copy idx-1 values)
    if (idx > 0) {
      for (const key of keys) {
        const arr = ghost[key];
        if (arr && arr[idx - 1] && (arr[idx - 1].weight != null || arr[idx - 1].reps != null)) {
          return { weight: arr[idx - 1].weight, reps: arr[idx - 1].reps };
        }
      }
      if (histData) {
        for (const key of keys) {
          const setMap = histData.get(key);
          if (setMap && setMap.has(idx - 1)) {
            const histSet = setMap.get(idx - 1)!;
            return { weight: histSet.weight, reps: histSet.reps };
          }
        }
      }
    }

    return { weight: null, reps: null };
  };

  const formatHistoryDate = (raw: string) => {
    if (!raw) return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleDateString();
  };

  const loadHistoryFor = async (entry: { exerciseId?: string; exerciseName: string }) => {
    if (!plan.serverId) {
      setHistoryError('Save the plan to load history across sessions.');
      setHistoryItems([]);
      setHistoryPr(null);
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      let rows = historyCacheRef.current;
      if (!rows) {
        rows = await sessionApi.listAll();
        historyCacheRef.current = rows;
      }
      const targetName = normalizeExerciseName(entry.exerciseName).toLowerCase();

      // Collect all valid sets for this exercise across all sessions
      const allSets: Array<{ date: string; weight: number; reps: number }> = [];
      for (const row of rows) {
        const data = (row as SessionRow).data;
        if (!data || !Array.isArray(data.entries)) continue;
        const sessionDate = data.date || row.updated_at || '';
        for (const e of data.entries) {
          const entryName = normalizeExerciseName(e.exerciseName || '').toLowerCase();
          const match =
            (entry.exerciseId && e.exerciseId && String(e.exerciseId) === String(entry.exerciseId)) ||
            (entry.exerciseId && !e.exerciseId && entryName === targetName) ||
            (!entry.exerciseId && entryName === targetName);
          if (!match) continue;
          for (const set of e.sets ?? []) {
            const weight = typeof set.weight === 'number' ? set.weight : null;
            const reps = typeof set.reps === 'number' ? set.reps : null;
            if (weight == null || reps == null) continue;
            if (Number.isNaN(weight) || Number.isNaN(reps)) continue;
            allSets.push({ date: sessionDate, weight, reps });
          }
        }
      }

      // Group by date (date portion only), keep only the best set per session
      const bestByDate = new Map<string, { date: string; weight: number; reps: number }>();
      for (const s of allSets) {
        const dateKey = s.date ? new Date(s.date).toLocaleDateString() : '';
        if (!dateKey) continue;
        const cur = bestByDate.get(dateKey);
        if (!cur || s.weight > cur.weight || (s.weight === cur.weight && s.reps > cur.reps)) {
          bestByDate.set(dateKey, s);
        }
      }

      // Sort oldest first (ascending) for progression view
      const grouped = Array.from(bestByDate.values()).sort((a, b) => {
        return (Date.parse(a.date || '') || 0) - (Date.parse(b.date || '') || 0);
      });

      // PR = highest weight, ties broken by most reps
      let pr: { date: string; weight: number; reps: number } | null = null;
      for (const item of grouped) {
        if (!pr || item.weight > pr.weight || (item.weight === pr.weight && item.reps > pr.reps)) {
          pr = item;
        }
      }

      setHistoryPr(pr);
      // History list excludes the PR entry so it isn't shown twice
      setHistoryItems(pr ? grouped.filter((item) => item !== pr) : grouped);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : String(err));
      setHistoryItems([]);
      setHistoryPr(null);
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadHistoricalGhost = async (targets: Array<{ exerciseId?: string; exerciseName: string }>) => {
    if (!plan.serverId) return;

    // Use existing history cache if available
    let rows = historyCacheRef.current;
    if (!rows) {
      try {
        rows = await sessionApi.listAll();
        historyCacheRef.current = rows;
      } catch {
        return;
      }
    }

    // In full-body mode, filter to only sessions from days with the same NAME
    const ghostMode = plan.ghostMode ?? 'default';
    let filteredRows = rows;
    if (ghostMode === 'full-body') {
      // Find all day IDs in the plan that have the same name as the current day
      const currentDayName = day.name.trim().toLowerCase();
      const matchingDayIds = new Set<string>();
      for (const week of plan.weeks) {
        for (const d of week.days) {
          if (d.name.trim().toLowerCase() === currentDayName) {
            matchingDayIds.add(d.id);
          }
        }
      }
      filteredRows = rows.filter((row) => matchingDayIds.has(row.day_id));
    }

    const result = new Map<string, Map<number, { weight: number; reps: number }>>();

    for (const target of targets) {
      const targetKey = exerciseKey(target);
      const targetName = normalizeExerciseName(target.exerciseName).toLowerCase();
      const nameKey = `name:${targetName}`;

      const setsByIndex = new Map<number, { weight: number; reps: number }>();

      // Iterate through sessions (newest first - already sorted by updated_at desc)
      for (const row of filteredRows) {
        const data = (row as SessionRow).data;
        if (!data || !Array.isArray(data.entries)) continue;

        for (const entry of data.entries) {
          const entryName = normalizeExerciseName(entry.exerciseName || '').toLowerCase();
          const match =
            (target.exerciseId && entry.exerciseId && String(entry.exerciseId) === String(target.exerciseId)) ||
            (target.exerciseId && !entry.exerciseId && entryName === targetName) ||
            (!target.exerciseId && entryName === targetName);
          if (!match) continue;

          const sets = entry.sets ?? [];
          for (let setIdx = 0; setIdx < sets.length; setIdx++) {
            const set = sets[setIdx];
            // Only store if we haven't found data for this set index yet (newest first)
            if (!setsByIndex.has(setIdx)) {
              const weight = typeof set.weight === 'number' && !Number.isNaN(set.weight) ? set.weight : null;
              const reps = typeof set.reps === 'number' && !Number.isNaN(set.reps) ? set.reps : null;
              if (weight != null && reps != null) {
                setsByIndex.set(setIdx, { weight, reps });
              }
            }
          }
        }
      }

      if (setsByIndex.size > 0) {
        result.set(targetKey, setsByIndex);
        if (!result.has(nameKey)) {
          result.set(nameKey, setsByIndex);
        }
      }
    }

    historicalGhostRef.current = result;
  };

  const openHistory = (entry: { exerciseId?: string; exerciseName: string }) => {
    historyCacheRef.current = null;
    setHistoryEntry(entry);
    setHistoryOpen(true);
    void loadHistoryFor(entry);
  };

  const saveDebounceRef = useRef<number | null>(null);
  const savePendingRef = useRef<Session | null>(null);
  if (!session || session.planDayId !== day.id) return null;
  const saveNow = (next: Session, flush?: boolean) => {
    try {
      localStorage.setItem(
        `session:${plan.serverId ?? plan.id}:${next.planWeekId}:${next.planDayId}`,
        JSON.stringify(next)
      );
    } catch { void 0; }
    const serverId = plan.serverId;
    if (!serverId) return;
    savePendingRef.current = next;
    if (flush) {
      const payload = savePendingRef.current;
      if (payload) sessionApi.save(serverId, payload.planWeekId, payload.planDayId, payload).catch(() => void 0);
      return;
    }
    if (saveDebounceRef.current) window.clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = window.setTimeout(() => {
      const payload = savePendingRef.current;
      if (payload) sessionApi.save(serverId, payload.planWeekId, payload.planDayId, payload).catch(() => void 0);
      saveDebounceRef.current = null;
    }, 300);
  };

  const markSessionCompleted = (flag: boolean) => {
    setSession((prev) => {
      if (!prev) return prev;
      const next: Session = { ...prev, completed: flag };
      saveNow(next);
      return next;
    });
  };

  const openMyoScopeModal = (entryId: string) => {
    const entry = session?.entries.find((e) => e.id === entryId);
    if (!entry) return;
    setMyoScopeEntry({
      entryId,
      exerciseId: entry.exerciseId,
      exerciseName: entry.exerciseName,
      currentValue: !!entry.myoRepMatch,
    });
    setOpenExerciseMenu(null);
  };

  const applyMyoToday = () => {
    if (!myoScopeEntry) return;
    const newValue = !myoScopeEntry.currentValue;
    setSession((s) => {
      if (!s) return s;
      const next: Session = {
        ...s,
        entries: s.entries.map((e) =>
          e.id === myoScopeEntry.entryId ? { ...e, myoRepMatch: newValue } : e
        ),
      };
      saveNow(next);
      return next;
    });
    setMyoScopeEntry(null);
  };

  const applyMyoRestOfPlan = () => {
    if (!myoScopeEntry) return;
    const newValue = !myoScopeEntry.currentValue;
    const targetName = myoScopeEntry.exerciseName.trim().toLowerCase();
    const targetId = myoScopeEntry.exerciseId;
    const currentDayName = day.name.trim().toLowerCase();
    const isFullBody = plan.ghostMode === 'full-body';

    // Update the plan
    const updatedPlan = {
      ...plan,
      weeks: plan.weeks.map((week) => ({
        ...week,
        days: week.days.map((d) => {
          // In full-body mode, only update days with the same name
          if (isFullBody && d.name.trim().toLowerCase() !== currentDayName) {
            return d;
          }
          return {
            ...d,
            items: d.items.map((item) => {
              const itemName = item.exerciseName.trim().toLowerCase();
              const matches = targetId
                ? (item.exerciseId === targetId || itemName === targetName)
                : itemName === targetName;
              return matches ? { ...item, myoReps: newValue || undefined } : item;
            }),
          };
        }),
      })),
    };
    onUpdatePlan(updatedPlan);

    // Also apply to current session
    setSession((s) => {
      if (!s) return s;
      const next: Session = {
        ...s,
        entries: s.entries.map((e) =>
          e.id === myoScopeEntry.entryId ? { ...e, myoRepMatch: newValue } : e
        ),
      };
      saveNow(next);
      return next;
    });
    setMyoScopeEntry(null);
  };

    const updateEntryNote = (entryId: string, noteText: string) => {
  setSession((s) => {
    if (!s) return s;
    const entry = s.entries.find((e) => e.id === entryId) || null;
    const trimmed = noteText.trim();
    const next: Session = {
      ...s,
      entries: s.entries.map((e) =>
        e.id === entryId ? { ...e, note: trimmed === '' ? null : trimmed } : e
      ),
    };
    // Save note globally by exercise name
    if (entry) {
      const nameKey = normalizeExerciseName(entry.exerciseName || '').toLowerCase();
      if (nameKey) {
        if (trimmed) exerciseNotesRef.current[nameKey] = trimmed;
        else delete exerciseNotesRef.current[nameKey];
        // Debounced save to Supabase
        if (exerciseNotesSaveTimer.current) clearTimeout(exerciseNotesSaveTimer.current);
        exerciseNotesSaveTimer.current = setTimeout(() => {
          upsertUserPrefs({ exercise_notes: { ...exerciseNotesRef.current } }).catch(() => { /* ignore */ });
        }, 1200);
      }
    }
    saveNow(next);
    return next;
  });
};

  const updateEntryInstruction = (entryId: string, text: string) => {
    const trimmed = text.trim();
    // Find entry to get exercise name
    const entry = session?.entries.find((e) => e.id === entryId);
    if (entry) {
      const nameKey = normalizeExerciseName(entry.exerciseName || '').toLowerCase();
      if (nameKey) {
        if (trimmed) exerciseInstructionsRef.current[nameKey] = trimmed;
        else delete exerciseInstructionsRef.current[nameKey];
        if (exerciseInstructionsSaveTimer.current) clearTimeout(exerciseInstructionsSaveTimer.current);
        exerciseInstructionsSaveTimer.current = setTimeout(() => {
          upsertUserPrefs({ exercise_instructions: { ...exerciseInstructionsRef.current } }).catch(() => { /* ignore */ });
        }, 1200);
      }
    }
  };

  const getEntryInstruction = (entry: SessionEntry): string => {
    const nameKey = normalizeExerciseName(entry.exerciseName || '').toLowerCase();
    return exerciseInstructionsRef.current[nameKey] || '';
  };

  const updateSet = (entryId: string, setId: string, patch: Partial<SessionSet>) => {
    setSession((s) => {
      if (!s) return s;

      const nextEntries = s.entries.map((entry) => {
        if (entry.id !== entryId) return entry;

        const idx = entry.sets.findIndex((st) => st.id === setId);
        if (idx === -1) return entry;

        const prevWeight = entry.sets[idx]?.weight ?? null;

        // First apply the direct patch to the targeted set
        const updatedSets = entry.sets.map((st) => (st.id === setId ? { ...st, ...patch } : st));

        // Propagate weight forward within this exercise, based on rules:
        // - Only when weight is part of the patch
        // - Do not change previous sets
        // - For sets after the changed index, set weight to the new value
        //   only if their current weight is null or equal to the old value
        if (Object.prototype.hasOwnProperty.call(patch, 'weight')) {
          const newWeight = patch.weight ?? null;
          for (let j = idx + 1; j < updatedSets.length; j++) {
            const w = updatedSets[j].weight;
            if (w === null || w === prevWeight) {
              updatedSets[j] = { ...updatedSets[j], weight: newWeight };
            }
          }
        }

        return { ...entry, sets: updatedSets };
      });

      const next: Session = { ...s, entries: nextEntries };
      saveNow(next);
      return next;
    });
  };

  

  const addDraftSet = () => {
    setEditDraftSets(prev => [...prev, {
      id: uuid(),
      setIndex: prev.length,
      weight: null,
      reps: null,
    }]);
  };

  const removeDraftSet = (setId: string) => {
    setEditDraftSets(prev =>
      prev.filter(s => s.id !== setId).map((s, i) => ({ ...s, setIndex: i }))
    );
  };

  const saveEditSets = () => {
    if (!editingEntryId) return;
    setSession(s => {
      if (!s) return s;
      const nextEntries = s.entries.map(entry => {
        if (entry.id !== editingEntryId) return entry;
        return { ...entry, sets: editDraftSets };
      });
      const next: Session = { ...s, entries: nextEntries };
      saveNow(next);
      return next;
    });
    setEditingEntryId(null);
    setEditDraftSets([]);
  };

  const cancelEdit = () => {
    setEditingEntryId(null);
    setEditDraftSets([]);
  };

  const handleDone = async () => {
    markSessionCompleted(true);
    await onMarkDone();
  };


  return (
    <div>
      <datalist id="exercise-options-workout">
        {exerciseOptions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {session.entries.map((entry, entryIndex) => (
        <div key={entry.id} className="list-stagger bg-elevated rounded-md p-4 shadow-card transition-all duration-150 ease-in-out border-l-[3px]" style={{
          '--i': entryIndex,
          borderLeftColor: editingEntryId === entry.id ? 'var(--accent)' : 'var(--accent-blue)',
          borderTop: '1px solid var(--border-subtle)',
          borderRight: '1px solid var(--border-subtle)',
          borderBottom: '1px solid var(--border-subtle)',
        } as React.CSSProperties}>
          {/* Header: Name + ⋮ pinned top-right */}
          <div className="relative mb-1">
            <h3 className="m-0 text-[16px] font-bold pr-10">
              {entry.exerciseName}
            </h3>
            <div className="absolute top-0 right-0">
              <Button
                onClick={() => setOpenExerciseMenu(openExerciseMenu === entry.id ? null : entry.id)}
                size="sm"
                style={{ padding: '4px 8px', minWidth: 32 }}
                title="Options"
              >
                ⋮
              </Button>
              {openExerciseMenu === entry.id && (
                <div className="dropdown-menu absolute top-full right-0 bg-elevated border border-default rounded-md p-2 mt-1 min-w-[160px] z-20 shadow-[var(--shadow-lg)]">
                  <Button
                    onClick={() => {
                      setOpenExerciseMenu(null);
                      setEditingEntryId(entry.id);
                      setEditDraftSets(entry.sets.map(s => ({ ...s })));
                    }}
                    size="sm" block className="text-left mb-1"
                  >
                    Edit Sets
                  </Button>
                  <Button
                    onClick={() => { setOpenExerciseMenu(null); openReplaceSearch(entry, entryIndex); }}
                    size="sm" block className="text-left mb-1"
                  >
                    Replace
                  </Button>
                  <Button
                    onClick={() => { setOpenExerciseMenu(null); openHistory({ exerciseId: entry.exerciseId, exerciseName: entry.exerciseName }); }}
                    size="sm" block className="text-left mb-1"
                  >
                    History
                  </Button>
                  <Button
                    onClick={() => openMyoScopeModal(entry.id)}
                    size="sm" block
                    style={{
                      textAlign: 'left',
                      background: entry.myoRepMatch ? 'var(--accent-purple-muted)' : 'var(--bg-card)',
                      borderColor: entry.myoRepMatch ? 'var(--accent-purple)' : 'var(--border-subtle)',
                      color: entry.myoRepMatch ? 'var(--accent-purple)' : 'var(--text-primary)',
                    }}
                  >
                    Myo-Rep Match {entry.myoRepMatch ? '✓' : ''}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Muscles + MYO badge row */}
          <div className="flex items-center gap-2 mb-3">
            {(() => {
              const cat = catalogByNameMap.get(normalizeExerciseName(entry.exerciseName || '').toLowerCase());
              if (!cat?.primaryMuscle) return null;
              const label = cat.secondaryMuscles?.length
                ? `${cat.primaryMuscle} · ${cat.secondaryMuscles[0]}`
                : cat.primaryMuscle;
              return <span className="text-[11px] text-muted font-normal">{label}</span>;
            })()}
            {entry.myoRepMatch && (
              <span className="text-[11px] text-accent-purple font-medium px-1.5 py-0.5 bg-accent-purple-muted rounded-full">MYO</span>
            )}
          </div>

          {/* Sets section */}
          {editingEntryId === entry.id ? (
            <>
              <div className="grid grid-cols-[50px_1fr_1fr_36px] gap-2 mb-1 px-1 text-muted text-[13px] font-semibold uppercase tracking-[0.05em] text-center">
                <div>Set</div>
                <div>Weight</div>
                <div>Reps</div>
                <div></div>
              </div>

              {editDraftSets.map((set, i) => (
                <div key={set.id} className="grid grid-cols-[50px_1fr_1fr_36px] gap-2 mb-1 p-1 rounded-md" style={{
                  background: (set.weight != null || set.reps != null) ? 'var(--accent-filled)' : 'transparent',
                }}>
                  <div className="self-center text-center font-semibold text-secondary text-[15px]">{i + 1}</div>
                  <div className="self-center text-center text-[15px]" style={{
                    color: set.weight != null ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}>{set.weight ?? '—'}</div>
                  <div className="self-center text-center text-[15px]" style={{
                    color: set.reps != null ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}>{set.reps ?? '—'}</div>
                  <Button
                    onClick={() => removeDraftSet(set.id)}
                    size="sm"
                    className="text-error border-error min-w-0 text-[15px]"
                    style={{ padding: '2px 6px' }}
                    title="Remove set"
                  >
                    ✕
                  </Button>
                </div>
              ))}

              <Button
                onClick={addDraftSet}
                size="sm" block className="mb-2 mt-1"
              >
                + Add Set
              </Button>

              <div className="flex gap-2 justify-end">
                <Button onClick={cancelEdit} size="sm">Cancel</Button>
                <Button onClick={saveEditSets} variant="primary">Save</Button>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-[50px_1fr_1fr] gap-2 mb-1 px-1 text-muted text-[13px] font-semibold uppercase tracking-[0.05em] text-center">
                <div>Set</div>
                <div>Weight</div>
                <div style={{ color: entry.myoRepMatch ? 'var(--accent-purple)' : 'var(--text-muted)' }}>
                  {entry.myoRepMatch ? 'Match' : 'Reps'}
                </div>
              </div>

              {entry.sets.map((set, i) => {
                const ghostSet = getGhost(entry.exerciseId, entry.exerciseName, i);
                const hasValue = set.weight != null || set.reps != null;
                return (
                  <div key={set.id} className="grid grid-cols-[50px_1fr_1fr] gap-2 mb-1 p-1 rounded-md transition-colors duration-150" style={{
                    background: hasValue ? 'var(--accent-filled)' : 'transparent',
                    borderLeft: hasValue ? '2px solid var(--accent-blue)' : '2px solid transparent',
                  }}>
                    <div className="self-center text-center font-semibold text-secondary text-[15px]">{i + 1}</div>
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      placeholder={ghostSet.weight == null ? '' : String(ghostSet.weight)}
                      value={set.weight ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        const normalized = v.replace(',', '.');
                        const num = normalized === '' ? null : Number(normalized);
                        updateSet(entry.id, set.id, {
                          weight: num !== null && Number.isNaN(num) ? null : num,
                        });
                      }}
                      className="w-full min-w-0 text-center"
                      style={{ fontWeight: set.weight != null ? 600 : 400 }}
                    />
                    <input
                      inputMode="numeric"
                      placeholder={ghostSet.reps == null ? '' : String(ghostSet.reps)}
                      value={set.reps ?? ''}
                      onChange={(e) => {
                        const num = e.target.value === '' ? null : Number(e.target.value);
                        const repsValue = num !== null && Number.isNaN(num) ? null : num;
                        // Auto-populate weight from ghost if weight is empty and entering reps
                        if (set.weight == null && repsValue != null && ghostSet.weight != null) {
                          updateSet(entry.id, set.id, {
                            reps: repsValue,
                            weight: ghostSet.weight,
                          });
                        } else {
                          updateSet(entry.id, set.id, {
                            reps: repsValue,
                          });
                        }
                      }}
                      className="w-full min-w-0 text-center"
                      style={{ fontWeight: set.reps != null ? 600 : 400 }}
                    />
                  </div>
                );
              })}

              {entry.sets.length === 0 && <div className="text-muted">No sets yet.</div>}
            </>
          )}

          {/* Pill toggles: Instructions + Notes */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => {
                if (openInstructions[entry.id]) {
                  const original = getEntryInstruction(entry);
                  const draft = instructionsDraft[entry.id] ?? original;
                  if (draft !== original) {
                    if (confirm('Save changes to instructions?')) {
                      updateEntryInstruction(entry.id, draft);
                    }
                  }
                  setOpenInstructions((prev) => ({ ...prev, [entry.id]: false }));
                } else {
                  setOpenInstructions((prev) => ({ ...prev, [entry.id]: true }));
                  setInstructionsDraft((prev) => ({ ...prev, [entry.id]: getEntryInstruction(entry) }));
                }
              }}
              className="text-[12px] px-3 py-1.5 rounded-full border transition-all duration-150 flex items-center gap-1.5"
              style={{
                borderColor: openInstructions[entry.id] ? '#60a5fa' : 'var(--border-subtle)',
                background: openInstructions[entry.id] ? 'rgba(96,165,250,0.15)' : 'var(--bg-card)',
                color: openInstructions[entry.id] ? '#60a5fa' : 'var(--text-secondary)',
                boxShadow: 'none',
                minHeight: 'auto',
              }}
            >
              {getEntryInstruction(entry) && (
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#60a5fa' }} />
              )}
              Instructions
            </button>
            <button
              onClick={() => {
                if (openNotes[entry.id]) {
                  const original = entry.note ?? '';
                  const draft = notesDraft[entry.id] ?? original;
                  if (draft !== original) {
                    if (confirm('Save changes to notes?')) {
                      updateEntryNote(entry.id, draft);
                    }
                  }
                  setOpenNotes((prev) => ({ ...prev, [entry.id]: false }));
                } else {
                  setOpenNotes((prev) => ({ ...prev, [entry.id]: true }));
                  setNotesDraft((prev) => ({ ...prev, [entry.id]: entry.note ?? '' }));
                }
              }}
              className="text-[12px] px-3 py-1.5 rounded-full border transition-all duration-150 flex items-center gap-1.5"
              style={{
                borderColor: openNotes[entry.id] ? 'var(--success)' : 'var(--border-subtle)',
                background: openNotes[entry.id] ? 'var(--success-muted)' : 'var(--bg-card)',
                color: openNotes[entry.id] ? 'var(--success)' : 'var(--text-secondary)',
                boxShadow: 'none',
                minHeight: 'auto',
              }}
            >
              {entry.note && String(entry.note).trim() !== '' && (
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: 'var(--success)' }} />
              )}
              Notes
            </button>
          </div>

          {/* Expanded instructions */}
          {openInstructions[entry.id] && (
            <div className="flex flex-col gap-3 mt-2">
              <textarea
                value={instructionsDraft[entry.id] ?? ''}
                onChange={(e) => setInstructionsDraft((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                className="min-h-[120px] resize-y w-full"
                placeholder="Add instructions or coaching cues for this exercise"
              />
              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => {
                    updateEntryInstruction(entry.id, instructionsDraft[entry.id] ?? '');
                    setOpenInstructions((prev) => ({ ...prev, [entry.id]: false }));
                  }}
                  variant="primary"
                >
                  Save
                </Button>
              </div>
            </div>
          )}

          {/* Expanded notes */}
          {openNotes[entry.id] && (
            <div className="flex flex-col gap-3 mt-2">
              <textarea
                value={notesDraft[entry.id] ?? ''}
                onChange={(e) => setNotesDraft((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                className="min-h-[120px] resize-y w-full"
                placeholder="Add notes for this exercise"
              />
              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => {
                    updateEntryNote(entry.id, notesDraft[entry.id] ?? '');
                    setOpenNotes((prev) => ({ ...prev, [entry.id]: false }));
                  }}
                  variant="primary"
                >
                  Save
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
      </div>

      <div className="mt-5 pt-4 border-t border-t-subtle flex justify-between items-center flex-wrap gap-3">
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          cursor: 'pointer',
          padding: '8px 12px',
          borderRadius: 12,
          background: completed ? 'var(--success-muted)' : 'transparent',
          border: `1px solid ${completed ? 'var(--success)' : 'var(--border-subtle)'}`,
          transition: 'all 0.15s ease',
        }}>
          <span className="check-animated">
            <input
              type="checkbox"
              checked={completed}
              onChange={(e) => {
                const value = e.target.checked;
                markSessionCompleted(value);
                setCompleted(value);
              }}
            />
            <svg className="checkmark-svg" viewBox="0 0 20 20" fill="none">
              <path className="checkmark-path" d="M5 10.5L8.5 14L15 7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="font-medium" style={{ color: completed ? 'var(--success)' : 'var(--text-secondary)' }}>
            Completed
          </span>
        </label>

        <div className="flex gap-3 flex-wrap">
          {isLastDay && onFinishPlan && (
            <Button onClick={onFinishPlan} variant="primary" disabled={finishingPlan}>
              {finishingPlan ? 'Finishing...' : 'Finish & Archive'}
            </Button>
          )}

          {!isLastDay && (
            <Button onClick={handleDone} variant="primary">
              Done (Next Day)
            </Button>
          )}
        </div>
      </div>

      <Modal open={replaceSearchOpen} onClose={closeReplaceSearch} title={`Replace Exercise${replaceTargetEntry ? ` - ${replaceTargetEntry.exerciseName}` : ''}`} maxWidth={980}>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
              <input
                value={replaceSearchText}
                onChange={(e) => setReplaceSearchText(e.target.value)}
                placeholder="Search name..."
               
              />
              <select value={replaceSearchPrimary} onChange={(e) => setReplaceSearchPrimary(e.target.value)} >
                <option value="All">Primary Muscle (All)</option>
                {replacePrimaryMuscles.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select value={replaceSearchSecondary} onChange={(e) => setReplaceSearchSecondary(e.target.value)} >
                <option value="All">Secondary Muscle (All)</option>
                {replaceSecondaryMuscles.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select value={replaceSearchSource} onChange={(e) => setReplaceSearchSource(e.target.value as SearchSource)} >
                <option value="all">Source (All)</option>
                <option value="defaults">Defaults</option>
                <option value="home_made">Home Made *</option>
              </select>
              <Button variant="pill" active={replaceSearchMachine} onClick={() => setReplaceSearchMachine((prev) => !prev)} aria-pressed={replaceSearchMachine}>
                <span className="w-2.5 h-2.5 rounded-full border border-strong transition-all duration-150" style={{ background: replaceSearchMachine ? "var(--text-primary)" : "transparent" }} />
                Machine
              </Button>
              <Button variant="pill" active={replaceSearchFreeWeight} onClick={() => setReplaceSearchFreeWeight((prev) => !prev)} aria-pressed={replaceSearchFreeWeight}>
                <span className="w-2.5 h-2.5 rounded-full border border-strong transition-all duration-150" style={{ background: replaceSearchFreeWeight ? "var(--text-primary)" : "transparent" }} />
                Free weight
              </Button>
              <Button variant="pill" active={replaceSearchCable} onClick={() => setReplaceSearchCable((prev) => !prev)} aria-pressed={replaceSearchCable}>
                <span className="w-2.5 h-2.5 rounded-full border border-strong transition-all duration-150" style={{ background: replaceSearchCable ? "var(--text-primary)" : "transparent" }} />
                Cable
              </Button>
              <Button variant="pill" active={replaceSearchBodyWeight} onClick={() => setReplaceSearchBodyWeight((prev) => !prev)} aria-pressed={replaceSearchBodyWeight}>
                <span className="w-2.5 h-2.5 rounded-full border border-strong transition-all duration-150" style={{ background: replaceSearchBodyWeight ? "var(--text-primary)" : "transparent" }} />
                Bodyweight
              </Button>
              <Button variant="pill" active={replaceSearchCompound} onClick={() => setReplaceSearchCompound((prev) => !prev)} aria-pressed={replaceSearchCompound}>
                <span className="w-2.5 h-2.5 rounded-full border border-strong transition-all duration-150" style={{ background: replaceSearchCompound ? "var(--text-primary)" : "transparent" }} />
                Compound
              </Button>
            </div>

            <div className="flex flex-col gap-3">
              <div className="border border-default rounded-md p-3">
                <div className="flex justify-between items-center mb-2 gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="font-semibold">Results</div>
                  <div className="text-muted text-[13px]">{replaceFilteredCatalog.length} found</div>
                </div>
                  <Button
                    onClick={() => {
                      setReplaceAddMovementOpen((prev) => !prev);
                      setReplaceAddMovementError(null);
                    }}
                    size="xs"
                  >
                    Can't find it? Create one!
                  </Button>
                </div>
                {replaceAddMovementOpen && (
                  <div className="border border-subtle rounded-sm p-2 mb-2 flex flex-col gap-2">
                    <input
                      value={replaceAddMovementName}
                      onChange={(e) => setReplaceAddMovementName(e.target.value)}
                      placeholder="Movement name"
                     
                    />
                    <select
                      value={replaceAddMovementPrimary}
                      onChange={(e) => setReplaceAddMovementPrimary(e.target.value)}
                                         >
                      <option value="">Primary muscle</option>
                      {replacePrimaryMuscles.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <div className="flex flex-wrap gap-3">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="replace-add-movement-equipment"
                          checked={replaceAddMovementEquipment === 'machine'}
                          onChange={() => setReplaceAddMovementEquipment('machine')}
                        />
                        Machine
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="replace-add-movement-equipment"
                          checked={replaceAddMovementEquipment === 'free_weight'}
                          onChange={() => setReplaceAddMovementEquipment('free_weight')}
                        />
                        Free weight
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="replace-add-movement-equipment"
                          checked={replaceAddMovementEquipment === 'cable'}
                          onChange={() => setReplaceAddMovementEquipment('cable')}
                        />
                        Cable
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="replace-add-movement-equipment"
                          checked={replaceAddMovementEquipment === 'body_weight'}
                          onChange={() => setReplaceAddMovementEquipment('body_weight')}
                        />
                        Bodyweight
                      </label>
                    </div>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={replaceAddMovementCompound}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setReplaceAddMovementCompound(checked);
                          if (!checked) setReplaceAddMovementSecondary('');
                        }}
                      />
                      Compound
                    </label>
                    {replaceAddMovementCompound && (
                      <select
                        value={replaceAddMovementSecondary}
                        onChange={(e) => setReplaceAddMovementSecondary(e.target.value)}
                                             >
                        <option value="">Secondary muscle</option>
                        {replacePrimaryMuscles
                          .filter((m) => m !== replaceAddMovementPrimary)
                          .map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                      </select>
                    )}
                    {replaceAddMovementError && (
                      <div className="text-error text-[13px]">{replaceAddMovementError}</div>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button
                        onClick={() => {
                          resetReplaceAddMovement();
                          setReplaceAddMovementOpen(false);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button onClick={handleReplaceAddMovement} variant="primary">
                        Add
                      </Button>
                    </div>
                  </div>
                )}
                <div className="flex flex-col gap-2 max-h-[40vh] overflow-y-auto">
                  {replaceFilteredCatalog.length === 0 ? (
                    <div className="text-muted">No matches.</div>
                  ) : (
                    replaceFilteredCatalog.map((ex) => (
                      <div key={`${ex.isCustom ? 'custom' : 'catalog'}:${ex.id}`} className="border border-subtle rounded-sm p-2 flex justify-between items-center gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-[15px]">{ex.name}{ex.isCustom ? ' *' : ''}</div>
                          <div className="text-muted text-[11px]">
                            {ex.primaryMuscle}{ex.secondaryMuscles.length ? ` / ${ex.secondaryMuscles.join(', ')}` : ''}
                          </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Button onClick={() => addReplaceQueue(ex)} size="xs">Add</Button>
                          {ex.isCustom && (
                            <Button onClick={() => handleDeleteCustomFromReplace(ex)} size="xs">Del</Button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="border border-default rounded-md p-3">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <div className="font-semibold text-[13px]">Queue:</div>
                  {replaceQueue.length === 0 ? (
                    <div className="text-muted text-[13px]">None selected</div>
                  ) : (
                    replaceQueue.map((q) => (
                      <div key={q.name} className="inline-flex items-center gap-1 bg-accent-subtle border border-subtle rounded-sm px-1.5 py-0.5 text-[13px]">
                        <span>{q.name}</span>
                        <button
                          onClick={() => removeReplaceQueue(q.name)}
                          className="bg-transparent border-none text-muted cursor-pointer px-0.5 py-0 text-[13px] leading-none"
                        >✕</button>
                      </div>
                    ))
                  )}
                </div>
                <div className="flex justify-end gap-2">
                  <Button onClick={closeReplaceSearch} size="sm">Cancel</Button>
                  <Button onClick={() => applyReplaceQueue("today")} variant="primary" size="sm" disabled={replaceQueue.length === 0}>
                    Today Only
                  </Button>
                  <Button onClick={() => applyReplaceQueue("remaining")} variant="primary" size="sm" disabled={replaceQueue.length === 0}>
                    Rest of Meso
                  </Button>
                </div>
              </div>
            </div>
            <div className="text-muted text-[13px] text-left">
              * = self made movement
            </div>
      </Modal>

      <Modal open={!!myoScopeEntry} onClose={() => setMyoScopeEntry(null)} maxWidth={320}>
        <div className="text-center">
          <h3 className="m-0 mb-2 text-lg">Myo-Rep Match</h3>
          {myoScopeEntry && (
            <p className="text-secondary text-[15px] mb-6">
              {myoScopeEntry.currentValue ? 'Turn off' : 'Turn on'} Myo-Rep Match for <strong>{myoScopeEntry.exerciseName}</strong>?
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Button onClick={applyMyoToday} block>
              Just Today
            </Button>
            <Button
              onClick={applyMyoRestOfPlan}
              block
              style={{
                background: 'var(--accent-purple-muted)',
                borderColor: 'var(--accent-purple)',
                color: 'var(--accent-purple)',
              }}
            >
              {plan?.ghostMode === 'full-body' ? 'All ' + day?.name + ' Days' : 'Entire Plan'}
            </Button>
            <Button onClick={() => setMyoScopeEntry(null)} block className="mt-2">
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={historyOpen} onClose={() => { setHistoryOpen(false); setHistoryError(null); }} title={`History${historyEntry ? ` - ${historyEntry.exerciseName}` : ''}`} maxWidth={520} maxHeight="80vh">
            {historyLoading ? (
              <div className="text-muted p-6 text-center">Loading history...</div>
            ) : historyError ? (
              <div className="text-error px-3 py-2.5 bg-error-muted rounded-sm">{historyError}</div>
            ) : !historyPr && historyItems.length === 0 ? (
              <div className="text-muted p-6 text-center">No recorded sets yet.</div>
            ) : (
              <>
                {historyPr && (
                  <div className="border border-success rounded-md p-4 bg-success-muted shadow-[0_0_20px_rgba(74,222,128,0.1)]">
                    <div className="font-semibold text-success text-[13px] mb-2 uppercase tracking-[0.05em]">Personal Best</div>
                    <div className="text-[28px] font-bold tracking-[-0.02em]">
                      {historyPr.weight} <span className="text-muted text-[15px] font-normal">×</span> {historyPr.reps}
                    </div>
                    <div className="text-secondary text-[13px] mt-1.5">{formatHistoryDate(historyPr.date)}</div>
                  </div>
                )}

                {historyItems.length > 0 && (
                  <div className="flex flex-col">
                    <div className="font-semibold text-[13px] text-muted mb-3 uppercase tracking-[0.05em]">Progression</div>
                    {historyItems.map((item, idx) => (
                      <div key={`${item.date}-${item.weight}-${item.reps}-${idx}`} className="flex justify-between items-center gap-2 py-3" style={{
                        borderBottom: idx < historyItems.length - 1 ? '1px solid var(--border-subtle)' : 'none'
                      }}>
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-strong" />
                          <span className="font-semibold text-[15px]">{item.weight}</span>
                          <span className="text-muted">×</span>
                          <span className="font-semibold text-[15px]">{item.reps}</span>
                        </div>
                        <div className="text-muted text-[13px]">{formatHistoryDate(item.date)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
      </Modal>
    </div>
  );
}

function calculateSetsPerMuscle(
  items: PlanExercise[],
  catalogExercises: CatalogExercise[]
): Record<string, number> {
  const catalogByName = new Map<string, CatalogExercise>();
  for (const ex of catalogExercises) {
    catalogByName.set(ex.name.trim().toLowerCase(), ex);
  }

  const setsPerMuscle: Record<string, number> = {};
  for (const item of items) {
    const key = item.exerciseName.trim().toLowerCase();
    const catalogEntry = catalogByName.get(key);
    const muscle = catalogEntry?.primaryMuscle || 'Unknown';
    setsPerMuscle[muscle] = (setsPerMuscle[muscle] || 0) + item.targetSets;
  }
  return setsPerMuscle;
}

function calculateWeekSetsPerMuscle(
  week: PlanWeek,
  catalogExercises: CatalogExercise[]
): Record<string, number> {
  const allItems = week.days.flatMap((day) => day.items);
  return calculateSetsPerMuscle(allItems, catalogExercises);
}

function AIProgramBuilder({ catalogExercises, onClose, onImportCSV }: {
  catalogExercises: CatalogExercise[];
  onClose: () => void;
  onImportCSV: (csv: string) => void;
}) {
  const [step, setStep] = useState<'form' | 'generating' | 'result' | 'manual'>('form');
  const [experience, setExperience] = useState<'beginner' | 'intermediate' | 'advanced'>('intermediate');
  const [beginnerRandom, setBeginnerRandom] = useState(false);
  const [trainingGoal, setTrainingGoal] = useState<'strength' | 'hypertrophy' | 'both'>('both');
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [sessionMinutes, setSessionMinutes] = useState('60');
  const [injuries, setInjuries] = useState('');
  const [priorityMuscles, setPriorityMuscles] = useState<string[]>([]);
  const [deprioritizedMuscles, setDeprioritizedMuscles] = useState<string[]>([]);
  const [knowsMyoReps, setKnowsMyoReps] = useState(false);
  const [showPrioMuscles, setShowPrioMuscles] = useState(false);
  const [showDeprioMuscles, setShowDeprioMuscles] = useState(false);
  const [copied, setCopied] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [userApiKey, setUserApiKey] = useState(() => localStorage.getItem('anthropic_api_key') || '');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [remaining, setRemaining] = useState<{ used: number; limit: number; remaining: number } | null>(null);

  // Load remaining generations on mount
  useEffect(() => {
    aiApi.remaining().then(setRemaining).catch(() => {});
  }, []);

  const togglePriority = (m: string) => {
    setPriorityMuscles(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
    setDeprioritizedMuscles(prev => prev.filter(x => x !== m));
  };
  const toggleDepriority = (m: string) => {
    setDeprioritizedMuscles(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
    setPriorityMuscles(prev => prev.filter(x => x !== m));
  };

  const promptText = useMemo(() => generateAIPrompt(
    { experience, beginnerRandom, trainingGoal, daysPerWeek, sessionMinutes, injuries, priorityMuscles, deprioritizedMuscles, knowsMyoReps },
    catalogExercises
  ), [experience, beginnerRandom, trainingGoal, daysPerWeek, sessionMinutes, injuries, priorityMuscles, deprioritizedMuscles, knowsMyoReps, catalogExercises]);

  const handleGenerate = async () => {
    setStep('generating');
    setGenError(null);
    setLimitReached(false);
    try {
      const catalogCSV = generateExerciseCatalogCSV(catalogExercises);
      const fullPrompt = promptText + '\n\n--- EXERCISE CATALOG CSV ---\n' + catalogCSV;
      const key = userApiKey.trim() || undefined;
      const { csv } = await aiApi.generate(fullPrompt, key);
      onImportCSV(csv);
      onClose();
    } catch (err: any) {
      if (err.limitReached) {
        setLimitReached(true);
        setShowKeyInput(true);
      }
      setGenError(err.message || 'Generation failed. Please try again.');
      setStep('form');
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.querySelector<HTMLTextAreaElement>('[data-prompt-output]');
      if (ta) { ta.select(); document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    }
  };

  const handleDownloadCatalog = () => {
    const csv = generateExerciseCatalogCSV(catalogExercises);
    downloadCSV('exercise_catalog.csv', csv);
  };

  const saveApiKey = (key: string) => {
    setUserApiKey(key);
    if (key.trim()) localStorage.setItem('anthropic_api_key', key.trim());
    else localStorage.removeItem('anthropic_api_key');
  };

  const showDetails = !(experience === 'beginner' && beginnerRandom);

  return (
    <Modal open={true} onClose={onClose} title="AI Program Builder" maxWidth={540} zIndex={35}>

        {step === 'form' ? (
          <div className="flex flex-col gap-4">
            {/* Experience */}
            <div>
              <div className="text-[13px] font-semibold mb-2 text-secondary">Experience Level</div>
              <div className="flex flex-wrap gap-2">
                {(['beginner', 'intermediate', 'advanced'] as const).map(lvl => (
                  <Button key={lvl} variant="pill" active={experience === lvl} onClick={() => { setExperience(lvl); if (lvl !== 'beginner') setBeginnerRandom(false); }}>
                    {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                  </Button>
                ))}
              </div>
            </div>

            {/* Training goal */}
            <div>
              <div className="text-[13px] font-semibold mb-2 text-secondary">Training Goal</div>
              <div className="flex flex-wrap gap-2">
                <Button variant="pill" active={trainingGoal === 'strength'} onClick={() => setTrainingGoal('strength')}>Strength</Button>
                <Button variant="pill" active={trainingGoal === 'hypertrophy'} onClick={() => setTrainingGoal('hypertrophy')}>Size (Hypertrophy)</Button>
                <Button variant="pill" active={trainingGoal === 'both'} onClick={() => setTrainingGoal('both')}>Both</Button>
              </div>
            </div>

            {/* Beginner: random or personalized */}
            {experience === 'beginner' && (
              <div>
                <div className="text-[13px] font-semibold mb-2 text-secondary">Plan Type</div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="pill" active={!beginnerRandom} onClick={() => setBeginnerRandom(false)}>Personalized Plan</Button>
                  <Button variant="pill" active={beginnerRandom} onClick={() => setBeginnerRandom(true)}>Random Starter Plan</Button>
                </div>
              </div>
            )}

            {/* Days per week */}
            <div>
              <div className="text-[13px] font-semibold mb-2 text-secondary">Days Per Week</div>
              <div className="flex flex-wrap gap-2">
                {[1,2,3,4,5,6,7].map(d => (
                  <Button key={d} variant="pill" active={daysPerWeek === d} onClick={() => setDaysPerWeek(d)} style={{ minWidth: 36, justifyContent: 'center' }}>
                    {d}
                  </Button>
                ))}
              </div>
            </div>

            {/* Session duration */}
            <div>
              <div className="text-[13px] font-semibold mb-2 text-secondary">Session Duration</div>
              <div className="flex flex-wrap gap-2">
                {['30','45','60','75','90+'].map(t => (
                  <Button key={t} variant="pill" active={sessionMinutes === t} onClick={() => setSessionMinutes(t)}>
                    {t} min
                  </Button>
                ))}
              </div>
            </div>

            {/* Injuries (shown for all except beginner random) */}
            {showDetails && (
              <div>
                <div className="text-[13px] font-semibold mb-2 text-secondary">Injuries or Limitations (optional)</div>
                <textarea
                  value={injuries}
                  onChange={e => setInjuries(e.target.value)}
                  placeholder="e.g., bad left shoulder, lower back issues"
                  className="w-full min-h-[60px] resize-y"
                />
              </div>
            )}

            {/* Priority/depriority/myo-reps only for intermediate+ */}
            {showDetails && experience !== 'beginner' && (
              <>
                {/* Priority muscles (collapsible) */}
                <div>
                  <button
                    onClick={() => setShowPrioMuscles(p => !p)}
                    className="bg-transparent border-none p-0 cursor-pointer flex items-center gap-2 text-[13px] font-semibold shadow-none" style={{ color: priorityMuscles.length ? 'var(--accent)' : 'var(--text-secondary)' }}
                  >
                    <span className="text-[11px] transition-transform duration-150" style={{ transform: showPrioMuscles ? 'rotate(90deg)' : 'rotate(0deg)' }}>&#9654;</span>
                    Muscles to Prioritize{priorityMuscles.length > 0 && ` (${priorityMuscles.length})`}
                  </button>
                  {showPrioMuscles && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {[...MUSCLE_GROUPS].sort((a, b) => a.localeCompare(b)).map(m => (
                        <Button key={m} variant="pill" active={priorityMuscles.includes(m)} onClick={() => togglePriority(m)}>
                          {m}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>

                {/* De-priority muscles (collapsible) */}
                <div>
                  <button
                    onClick={() => setShowDeprioMuscles(p => !p)}
                    className="bg-transparent border-none p-0 cursor-pointer flex items-center gap-2 text-[13px] font-semibold shadow-none" style={{ color: deprioritizedMuscles.length ? 'var(--accent)' : 'var(--text-secondary)' }}
                  >
                    <span className="text-[11px] transition-transform duration-150" style={{ transform: showDeprioMuscles ? 'rotate(90deg)' : 'rotate(0deg)' }}>&#9654;</span>
                    Muscles to De-prioritize{deprioritizedMuscles.length > 0 && ` (${deprioritizedMuscles.length})`}
                  </button>
                  {showDeprioMuscles && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {[...MUSCLE_GROUPS].sort((a, b) => a.localeCompare(b)).map(m => (
                        <Button key={m} variant="pill" active={deprioritizedMuscles.includes(m)} onClick={() => toggleDepriority(m)}>
                          {m}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Myo reps */}
                <div>
                  <div className="text-[13px] font-semibold mb-2 text-secondary">Do you know what myo-rep sets are?</div>
                  <div className="flex gap-2">
                    <Button variant="pill" active={knowsMyoReps} onClick={() => setKnowsMyoReps(true)}>Yes</Button>
                    <Button variant="pill" active={!knowsMyoReps} onClick={() => setKnowsMyoReps(false)}>No</Button>
                  </div>
                </div>
              </>
            )}

            {/* Error message */}
            {genError && (
              <div className="text-[13px] text-error px-3 py-2.5 bg-error-muted border border-error rounded-md">
                {genError}
              </div>
            )}

            {/* API Key section */}
            {(limitReached || showKeyInput) && (
              <div>
                <div className="text-[13px] font-semibold mb-2 text-secondary">
                  Anthropic API Key {limitReached && <span className="text-error font-normal">(free generations used up)</span>}
                </div>
                <input
                  type="password"
                  value={userApiKey}
                  onChange={e => saveApiKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="w-full font-mono text-[13px]"
                />
                <div className="text-[11px] text-muted mt-1">
                  Get a key at console.anthropic.com. Stored locally in your browser only.
                </div>
              </div>
            )}

            {!showKeyInput && !limitReached && (
              <Button onClick={() => setShowKeyInput(true)} size="sm" className="self-start text-[11px]">
                Use your own API key
              </Button>
            )}

            {/* Remaining count */}
            {remaining && !userApiKey.trim() && (
              <div className="text-[11px] text-muted">
                {remaining.remaining} of {remaining.limit} free generation{remaining.limit !== 1 ? 's' : ''} remaining
              </div>
            )}

            {/* Disclaimer */}
            <div className="text-[11px] text-muted leading-normal px-3 py-2.5 bg-card border border-subtle rounded-md">
              Disclaimer: Programs generated by AI are not reviewed by a certified trainer. Neither the AI, this app, nor its creator are liable for any injuries resulting from following a generated program. Consult a medical professional before starting any exercise program, especially if you have existing injuries or health conditions.
            </div>

            {/* Generate */}
            <Button
              onClick={handleGenerate}
              variant="primary"
              block
              className="text-center"
              disabled={catalogExercises.length === 0 || (limitReached && !userApiKey.trim())}
            >
              {catalogExercises.length === 0 ? 'Loading exercises...' : 'Generate Program'}
            </Button>

            <Button onClick={() => setStep('manual')} size="sm" className="self-center text-[11px] text-muted">
              Or copy prompt manually for any AI
            </Button>
          </div>
        ) : step === 'generating' ? (
          <div className="flex flex-col items-center gap-4 py-10">
            <div className="w-10 h-10 border-[3px] border-subtle border-t-accent rounded-full animate-[ptr-spin_0.8s_linear_infinite]" />
            <div className="text-[15px] text-secondary">Generating your program...</div>
            <div className="text-[13px] text-muted">This usually takes 15-30 seconds</div>
          </div>
        ) : step === 'manual' ? (
          <div className="flex flex-col gap-3">
            <div className="text-[13px] text-secondary leading-relaxed">
              <strong className="text-primary">How to use:</strong><br/>
              1. Copy the prompt below<br/>
              2. Download the exercise list CSV<br/>
              3. Paste the prompt into ChatGPT, Claude, or any AI<br/>
              4. Attach the exercise list CSV to the same message<br/>
              5. The AI will give you a CSV file to download<br/>
              6. Import that file here with "Import Plan (CSV)"
            </div>

            <textarea
              data-prompt-output=""
              readOnly
              value={promptText}
              className="w-full min-h-[200px] resize-y font-mono text-[11px]"
            />

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleCopy} variant="primary" className="flex-1 text-center min-w-[140px]">
                {copied ? 'Copied!' : 'Copy Prompt'}
              </Button>
              <Button onClick={handleDownloadCatalog} className="flex-1 text-center min-w-[140px]">
                Download Exercise List
              </Button>
            </div>

            <Button onClick={() => setStep('form')} size="sm" className="self-start">
              ← Back
            </Button>
          </div>
        ) : null}
    </Modal>
  );
}

function BuilderPage({
  plans,
  setPlans,
  selectedPlanId,
  selectedWeekId,
  selectedDayId,
  onSelectPlan,
  setSelectedWeekId,
  setSelectedDayId,
  showPlanList,
  setShowPlanList,
  onSaved,
  exerciseLoading,
  catalogExercises,
  catalogLoading,
  onResolveExerciseName,
  onCreateCustomExercise,
  onDeleteCustomExercise,
}: {
  plans: Plan[];
  setPlans: React.Dispatch<React.SetStateAction<Plan[]>>;
  selectedPlanId: string | null;
  selectedWeekId: string | null;
  selectedDayId: string | null;
  onSelectPlan: (planId: string | null, planOverride?: Plan | null) => void;
  setSelectedWeekId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedDayId: React.Dispatch<React.SetStateAction<string | null>>;
  showPlanList: boolean;
  setShowPlanList: React.Dispatch<React.SetStateAction<boolean>>;
  onSaved?: (savedPlan: Plan) => void;
  exerciseLoading: boolean;
  catalogExercises: CatalogExercise[];
  catalogLoading: boolean;
  onResolveExerciseName: (name: string) => Promise<Exercise | null>;
  onCreateCustomExercise: (input: {
    name: string;
    primaryMuscle: string;
    equipment: "machine" | "free_weight" | "cable" | "body_weight";
    isCompound: boolean;
    secondaryMuscles?: string[];
  }) => Promise<CatalogExercise>;
  onDeleteCustomExercise: (id: string) => Promise<void>;
}) {
  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === selectedPlanId) || null,
    [plans, selectedPlanId]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manageTab, setManageTab] = useState<"plans" | "templates">("plans");
  const [showAIProgramBuilder, setShowAIProgramBuilder] = useState(false);
  const [templates, setTemplates] = useState<Plan[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchWeekId, setSearchWeekId] = useState<string | null>(null);
  const [searchDayId, setSearchDayId] = useState<string | null>(null);
  const [searchItemId, setSearchItemId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchPrimary, setSearchPrimary] = useState<string>("All");
  const [searchSecondary, setSearchSecondary] = useState<string>("All");
  const [searchSource, setSearchSource] = useState<SearchSource>("all");
  const [searchMachine, setSearchMachine] = useState(false);
  const [searchFreeWeight, setSearchFreeWeight] = useState(false);
  const [searchCable, setSearchCable] = useState(false);
  const [searchBodyWeight, setSearchBodyWeight] = useState(false);
  const [searchCompound, setSearchCompound] = useState(false);
  const [searchQueue, setSearchQueue] = useState<Array<{ name: string; id?: string }>>([]);
  const [addMovementOpen, setAddMovementOpen] = useState(false);
  const [addMovementName, setAddMovementName] = useState("");
  const [addMovementPrimary, setAddMovementPrimary] = useState("");
  const [addMovementEquipment, setAddMovementEquipment] = useState<"" | "machine" | "free_weight" | "cable" | "body_weight">("");
  const [addMovementCompound, setAddMovementCompound] = useState(false);
  const [addMovementSecondary, setAddMovementSecondary] = useState("");
  const [addMovementError, setAddMovementError] = useState<string | null>(null);

  const primaryMuscles = useMemo(() => {
    const set = new Set<string>();
    for (const ex of catalogExercises) {
      if (ex.primaryMuscle) set.add(ex.primaryMuscle);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [catalogExercises]);

  const secondaryMuscles = useMemo(() => {
    const set = new Set<string>();
    for (const ex of catalogExercises) {
      for (const m of ex.secondaryMuscles) set.add(m);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [catalogExercises]);

  const filteredCatalog = useMemo(() => {
    const text = normalizeFilterValue(searchText);
    const source = searchSource;
    const wantPrimary = searchPrimary !== "All" ? normalizeFilterValue(searchPrimary) : "";
    const wantSecondary = searchSecondary !== "All" ? normalizeFilterValue(searchSecondary) : "";
    const filtered = catalogExercises.filter((ex) => {
      const isCustom = ex.isCustom === true;
      if (text && !normalizeFilterValue(ex.name).includes(text)) return false;
      if (wantPrimary && normalizeFilterValue(ex.primaryMuscle) !== wantPrimary) return false;
      if (wantSecondary && !ex.secondaryMuscles.some((m) => normalizeFilterValue(m) === wantSecondary)) return false;
      if (source === "defaults" && isCustom) return false;
      if (source === "home_made" && !isCustom) return false;
      if (searchMachine && !ex.machine) return false;
      if (searchFreeWeight && !ex.freeWeight) return false;
      if (searchCable && !ex.cable) return false;
      if (searchBodyWeight && !ex.bodyWeight) return false;
      if (searchCompound && !ex.isCompound) return false;
      return true;
    });
    const byName = new Map<string, CatalogExercise>();
    for (const ex of filtered) {
      const key = normalizeFilterValue(ex.name);
      if (!key) continue;
      const existing = byName.get(key);
      if (!existing || (ex.isCustom && !existing.isCustom)) {
        byName.set(key, ex);
      }
    }
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [
    catalogExercises,
    searchText,
    searchPrimary,
    searchSecondary,
    searchSource,
    searchMachine,
    searchFreeWeight,
    searchCable,
    searchBodyWeight,
    searchCompound,
  ]);

  const createDay = (index: number): PlanDay => ({
    id: uuid(),
    name: `Day ${index + 1}`,
    items: [],
  });

  const createWeek = (index: number): PlanWeek => ({
    id: uuid(),
    name: `Week ${index + 1}`,
    days: [createDay(0)],
  });

  const createExercise = (): PlanExercise => ({
    id: uuid(),
    exerciseName: 'New Exercise',
    targetSets: 3,
    targetReps: '',
  });

  const updatePlan = (planId: string, updater: (plan: Plan) => Plan) => {
    setPlans((prev) => prev.map((p) => (p.id === planId ? updater(p) : p)));
  };

  

  const mapServerTemplate = (row: ServerPlanRow): Plan => ({
    id: uuid(),
    serverId: row.id,
    name: fixMojibake(row.name) || "Template",
    weeks: mapRowToWeeks((row?.data ?? {}) as ServerPlanData),
  });

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const rows = await templateApi.list();
      setTemplates(rows.map((r) => mapServerTemplate(r)));
    } catch (e) {
      setTemplatesError(e instanceof Error ? e.message : String(e));
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showPlanList) {
      loadTemplates();
    }
  }, [showPlanList, loadTemplates]);

  const handleCreatePlan = () => {
    const newPlan: Plan = {
      id: uuid(),
      name: `New Plan ${plans.length + 1}`,
      weeks: [createWeek(0)],
    };
    setPlans((prev) => [...prev, newPlan]);
    onSelectPlan(newPlan.id, newPlan);
    setShowPlanList(false);
  };

  const handlePlanNameChange = (name: string) => {
    if (!selectedPlan) return;
    updatePlan(selectedPlan.id, (plan) => ({ ...plan, name }));
  };

  const handleAddWeek = () => {
    if (!selectedPlan) return;
    const newWeek = createWeek(selectedPlan.weeks.length);
    updatePlan(selectedPlan.id, (plan) => ({ ...plan, weeks: [...plan.weeks, newWeek] }));
    setSelectedWeekId(newWeek.id);
    setSelectedDayId(newWeek.days[0]?.id ?? null);
  };

  const handleCopyWeekOneToAll = () => {
    if (!selectedPlan || selectedPlan.weeks.length <= 1) return;
    const sourceWeek = selectedPlan.weeks[0];
    let replacementDayId: string | null = null;

    setPlans((prev) =>
      prev.map((plan) => {
        if (plan.id !== selectedPlan.id) return plan;
        const weeks = plan.weeks.map((week, index) => {
          if (index === 0) return week;
          const clonedDays = sourceWeek.days.map((day) => ({
            id: uuid(),
            name: day.name,
            items: day.items.map((item) => ({
              id: uuid(),
              exerciseId: item.exerciseId,
              exerciseName: item.exerciseName,
              targetSets: item.targetSets,
              targetReps: item.targetReps ?? '',
            })),
          }));
          if (week.id === selectedWeekId) replacementDayId = clonedDays[0]?.id ?? null;
          return { ...week, days: clonedDays };
        });
        return { ...plan, weeks };
      })
    );

    if (replacementDayId) setSelectedDayId(replacementDayId);
  };

  const handleRemoveWeek = (weekId: string) => {
    if (!selectedPlan) return;
    updatePlan(selectedPlan.id, (plan) => {
      const weeks = plan.weeks.filter((w) => w.id !== weekId);
      const nextWeeks = weeks.length > 0 ? weeks : [createWeek(0)];
      const nextPlan = { ...plan, weeks: nextWeeks };
      const nextWeek = nextWeeks[0] ?? null;
      if (selectedWeekId === weekId || !selectedWeekId) {
        setSelectedWeekId(nextWeek?.id ?? null);
        setSelectedDayId(nextWeek?.days[0]?.id ?? null);
      }
      return nextPlan;
    });
  };

  const handleWeekNameChange = (weekId: string, name: string) => {
    if (!selectedPlan) return;
    updatePlan(selectedPlan.id, (plan) => ({
      ...plan,
      weeks: plan.weeks.map((week) => (week.id === weekId ? { ...week, name } : week)),
    }));
  };

  const handleAddDay = (weekId: string) => {
    if (!selectedPlan) return;
    updatePlan(selectedPlan.id, (plan) => ({
      ...plan,
      weeks: plan.weeks.map((week) => {
        if (week.id !== weekId) return week;
        const newDay = createDay(week.days.length);
        setSelectedWeekId(weekId);
        setSelectedDayId(newDay.id);
        return { ...week, days: [...week.days, newDay] };
      }),
    }));
  };

  const handleDayNameChange = (weekId: string, dayId: string, name: string) => {
    if (!selectedPlan) return;
    updatePlan(selectedPlan.id, (plan) => ({
      ...plan,
      weeks: plan.weeks.map((week) =>
        week.id === weekId
          ? {
              ...week,
              days: week.days.map((day) => (day.id === dayId ? { ...day, name } : day)),
            }
          : week
      ),
    }));
  };

  const handleRemoveDay = (weekId: string, dayId: string) => {
    if (!selectedPlan) return;
    updatePlan(selectedPlan.id, (plan) => ({
      ...plan,
      weeks: plan.weeks.map((week) => {
        if (week.id !== weekId) return week;
        const remaining = week.days.filter((d) => d.id !== dayId);
        const nextDays = remaining.length > 0 ? remaining : [createDay(0)];
        if (selectedWeekId === weekId && (selectedDayId === dayId || !selectedDayId)) {
          setSelectedWeekId(weekId);
          setSelectedDayId(nextDays[0]?.id ?? null);
        }
        return { ...week, days: nextDays };
      }),
    }));
  };

  

  const handleDuplicateDay = (weekId: string, dayId: string) => {
    if (!selectedPlan) return;
    updatePlan(selectedPlan.id, (plan) => ({
      ...plan,
      weeks: plan.weeks.map((week) => {
        if (week.id !== weekId) return week;
        const idx = week.days.findIndex((d) => d.id === dayId);
        if (idx < 0) return week;
        const source = week.days[idx];
        const cloned: PlanDay = {
          id: uuid(),
          name: source.name,
          items: source.items.map((it) => ({
            id: uuid(),
            exerciseId: it.exerciseId,
            exerciseName: it.exerciseName,
            targetSets: it.targetSets,
            targetReps: it.targetReps ?? '',
          })),
        };
        const days = week.days.slice();
        days.splice(idx + 1, 0, cloned);
        // Move selection to the new duplicated day
        setSelectedWeekId(weekId);
        setSelectedDayId(cloned.id);
        return { ...week, days };
      }),
    }));
  };

  const handleAddExercise = (weekId: string, dayId: string) => {
    if (!selectedPlan) return;
    const exercise = createExercise();
    updatePlan(selectedPlan.id, (plan) => ({
      ...plan,
      weeks: plan.weeks.map((week) =>
        week.id === weekId
          ? {
              ...week,
              days: week.days.map((day) =>
                day.id === dayId
                  ? { ...day, items: [...day.items, exercise] }
                  : day
              ),
            }
          : week
      ),
    }));
  };

  const handleExerciseChange = (
    weekId: string,
    dayId: string,
    itemId: string,
    patch: Partial<PlanExercise>
  ) => {
    if (!selectedPlan) return;
    // Apply change in state
    updatePlan(selectedPlan.id, (plan) => ({
      ...plan,
      weeks: plan.weeks.map((week) =>
        week.id === weekId
          ? {
              ...week,
              days: week.days.map((day) =>
                day.id === dayId
                  ? {
                      ...day,
                      items: day.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
                    }
                  : day
              ),
            }
          : week
      ),
    }));

  };

  const handleExerciseNameCommit = async (
    weekId: string,
    dayId: string,
    itemId: string,
    rawName: string
  ) => {
    if (!selectedPlan) return;
    const trimmed = normalizeExerciseName(rawName);
    if (!trimmed) {
      updatePlan(selectedPlan.id, (plan) => ({
        ...plan,
        weeks: plan.weeks.map((week) =>
          week.id === weekId
            ? {
                ...week,
                days: week.days.map((day) =>
                  day.id === dayId
                    ? {
                        ...day,
                        items: day.items.map((item) =>
                          item.id === itemId ? { ...item, exerciseName: '', exerciseId: undefined } : item
                        ),
                      }
                    : day
                ),
              }
            : week
        ),
      }));
      return;
    }

    const resolved = await onResolveExerciseName(trimmed);
    const resolvedName = resolved?.name ?? trimmed;
    const resolvedId = resolved?.id;

    updatePlan(selectedPlan.id, (plan) => ({
      ...plan,
      weeks: plan.weeks.map((week) =>
        week.id === weekId
          ? {
              ...week,
              days: week.days.map((day) =>
                day.id === dayId
                  ? {
                      ...day,
                      items: day.items.map((item) =>
                        item.id === itemId
                          ? { ...item, exerciseName: resolvedName, exerciseId: resolvedId }
                          : item
                      ),
                    }
                  : day
              ),
            }
          : week
      ),
    }));
  };

  const openSearchForItem = (weekId: string, dayId: string, itemId: string) => {
    setSearchWeekId(weekId);
    setSearchDayId(dayId);
    setSearchItemId(itemId);
    setSearchOpen(true);
  };

  const addToQueue = (ex: CatalogExercise) => {
    setSearchQueue((prev) => {
      const exists = prev.some((p) => p.name.toLowerCase() === ex.name.toLowerCase());
      if (exists) return prev;
      return [...prev, { name: ex.name, id: ex.id }];
    });
  };

  const removeFromQueue = (name: string) => {
    setSearchQueue((prev) => prev.filter((q) => q.name.toLowerCase() !== name.toLowerCase()));
  };

  const applyQueueToDay = async () => {
    if (!selectedPlan || !searchWeekId || !searchDayId || searchQueue.length === 0) {
      setSearchOpen(false);
      return;
    }

    const resolved = await Promise.all(
      searchQueue.map(async (q) => {
        const ex = await onResolveExerciseName(q.name);
        return { name: ex?.name ?? q.name, id: ex?.id };
      })
    );

    updatePlan(selectedPlan.id, (plan) => ({
      ...plan,
      weeks: plan.weeks.map((week) => {
        if (week.id !== searchWeekId) return week;
        const days = week.days.map((day) => {
          if (day.id !== searchDayId) return day;
          const items = day.items.slice();
          const insertAt = searchItemId ? items.findIndex((it) => it.id === searchItemId) : -1;
          if (insertAt >= 0) {
            const first = resolved[0];
            items[insertAt] = {
              ...items[insertAt],
              exerciseName: first.name,
              exerciseId: first.id,
            };
            for (let i = 1; i < resolved.length; i++) {
              const ex = resolved[i];
              items.splice(insertAt + i, 0, {
                id: uuid(),
                exerciseName: ex.name,
                exerciseId: ex.id,
                targetSets: 3,
                targetReps: '',
              });
            }
          } else {
            for (const ex of resolved) {
              items.push({
                id: uuid(),
                exerciseName: ex.name,
                exerciseId: ex.id,
                targetSets: 3,
                targetReps: '',
              });
            }
          }
          return { ...day, items };
        });
        return { ...week, days };
      }),
    }));

    setSearchOpen(false);
    setSearchQueue([]);
  };

  const resetAddMovement = () => {
    setAddMovementName("");
    setAddMovementPrimary("");
    setAddMovementEquipment("");
    setAddMovementCompound(false);
    setAddMovementSecondary("");
    setAddMovementError(null);
  };

  const handleAddMovement = async () => {
    const name = normalizeExerciseName(addMovementName);
    if (!name) {
      setAddMovementError("Enter a name.");
      return;
    }
    if (!addMovementPrimary) {
      setAddMovementError("Select a primary muscle.");
      return;
    }
    if (!addMovementEquipment) {
      setAddMovementError("Select machine, free weight, cable, or bodyweight.");
      return;
    }
    setAddMovementError(null);
    try {
      await onCreateCustomExercise({
        name,
        primaryMuscle: addMovementPrimary,
        equipment: addMovementEquipment,
        isCompound: addMovementCompound,
        secondaryMuscles: addMovementCompound && addMovementSecondary ? [addMovementSecondary] : [],
      });
      resetAddMovement();
      setAddMovementOpen(false);
    } catch (err) {
      setAddMovementError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteCustomFromSearch = async (ex: CatalogExercise) => {
    if (!ex.isCustom) return;
    if (!window.confirm(`Delete "${ex.name}"?`)) return;
    try {
      await onDeleteCustomExercise(ex.id);
      setSearchQueue((prev) => prev.filter((q) => q.name.toLowerCase() !== ex.name.toLowerCase()));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRemoveExercise = (weekId: string, dayId: string, itemId: string) => {
    if (!selectedPlan) return;
    updatePlan(selectedPlan.id, (plan) => ({
      ...plan,
      weeks: plan.weeks.map((week) =>
        week.id === weekId
          ? {
              ...week,
              days: week.days.map((day) =>
                day.id === dayId
                  ? { ...day, items: day.items.filter((item) => item.id !== itemId) }
                  : day
              ),
            }
          : week
      ),
    }));
  };

  // --- Drag-and-drop reorder for days (pointer-based for mobile) ---
  const [draggingDayId, setDraggingDayId] = useState<string | null>(null);
  const [dayDragWeekId, setDayDragWeekId] = useState<string | null>(null);
  const [dayDragInsertIndex, setDayDragInsertIndex] = useState<number | null>(null);
  const [dayDragActive, setDayDragActive] = useState<boolean>(false);
  const dayDragStartYRef = useRef<number>(0);
  const dayDragTimerRef = useRef<number | null>(null);

  const handleReorderDayAtIndex = (
    weekId: string,
    sourceDayId: string,
    insertIndex: number,
  ) => {
    if (!selectedPlan) return;
    updatePlan(selectedPlan.id, (plan) => ({
      ...plan,
      weeks: plan.weeks.map((week) => {
        if (week.id !== weekId) return week;
        const days = week.days.slice();
        const from = days.findIndex((d) => d.id === sourceDayId);
        if (from < 0) return week;
        let at = Math.max(0, Math.min(insertIndex, days.length));
        const [moved] = days.splice(from, 1);
        if (at > from) at -= 1; // account for removal shift
        days.splice(at, 0, moved);
        return { ...week, days };
      }),
    }));
  };

  // While dragging days, disable text selection globally
  useEffect(() => {
    const shouldDisable = !!draggingDayId && dayDragActive;
    const body = document?.body as any;
    const prev = body && (body.style.userSelect || "");
    const prevWebkit = body && (body.style.webkitUserSelect || "");
    const prevMs = body && (body.style.msUserSelect || "");
    if (shouldDisable && body) {
      body.style.userSelect = "none";
      body.style.webkitUserSelect = "none";
      body.style.msUserSelect = "none";
    }
    return () => {
      if (body) {
        body.style.userSelect = prev;
        body.style.webkitUserSelect = prevWebkit;
        body.style.msUserSelect = prevMs;
      }
    };
  }, [draggingDayId, dayDragActive]);

  // --- Drag-and-drop reorder for exercises (pointer-based for mobile) ---
  const [draggingExerciseId, setDraggingExerciseId] = useState<string | null>(null);
  const [dragWeekId, setDragWeekId] = useState<string | null>(null);
  const [dragDayId, setDragDayId] = useState<string | null>(null);
  const [dragInsertIndex, setDragInsertIndex] = useState<number | null>(null);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const dragStartYRef = useRef<number>(0);
  const dragTimerRef = useRef<number | null>(null);

  // While dragging, disable text selection globally to avoid blue highlight
  useEffect(() => {
    const shouldDisable = !!draggingExerciseId && dragActive;
    const body = document?.body as any;
    const prev = body && (body.style.userSelect || "");
    const prevWebkit = body && (body.style.webkitUserSelect || "");
    const prevMs = body && (body.style.msUserSelect || "");
    if (shouldDisable && body) {
      body.style.userSelect = "none";
      body.style.webkitUserSelect = "none";
      body.style.msUserSelect = "none";
    }
    return () => {
      if (body) {
        body.style.userSelect = prev;
        body.style.webkitUserSelect = prevWebkit;
        body.style.msUserSelect = prevMs;
      }
    };
  }, [draggingExerciseId, dragActive]);

  const handleReorderExerciseAtIndex = (
    weekId: string,
    dayId: string,
    sourceId: string,
    insertIndex: number
  ) => {
    if (!selectedPlan) return;
    updatePlan(selectedPlan.id, (plan) => ({
      ...plan,
      weeks: plan.weeks.map((week) =>
        week.id === weekId
          ? {
              ...week,
              days: week.days.map((day) => {
                if (day.id !== dayId) return day;
                const items = day.items.slice();
                const from = items.findIndex((it) => it.id === sourceId);
                if (from < 0) return day;
                let at = Math.max(0, Math.min(insertIndex, items.length));
                const [moved] = items.splice(from, 1);
                if (at > from) at -= 1; // account for removal shift
                items.splice(at, 0, moved);
                return { ...day, items };
              }),
            }
          : week
      ),
    }));
  };

  const handleDeletePlan = async (planId: string) => {
    const plan = plans.find((p) => p.id === planId) || null;
    if (!plan) return;
    if (!window.confirm('Delete this plan?')) return;

    const remaining = plans.filter((p) => p.id !== planId);
    setPlans(remaining);

    if (plan.serverId) {
      try {
        await planApi.remove(plan.serverId);
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to delete plan', err);
      }
    }

    if (selectedPlanId === planId) {
      const nextPlan = remaining[0] ?? null;
      onSelectPlan(nextPlan?.id ?? null, nextPlan ?? null);
    }
  };

  const handleSavePlan = async () => {
    if (!selectedPlan) return;
    setSaving(true);
    setError(null);
    try {
      const payload = { weeks: selectedPlan.weeks, ghostMode: selectedPlan.ghostMode };
      if (selectedPlan.serverId) {
        await planApi.update(selectedPlan.serverId, selectedPlan.name, payload);
        // After update, pass through the same plan reference
        if (onSaved) onSaved(selectedPlan);
      } else {
        const created = await planApi.create(selectedPlan.name, payload);
        if (created?.id) {
          const withServerId: Plan = { ...selectedPlan, serverId: created.id };
          setPlans((prev) => prev.map((p) => (p.id === selectedPlan.id ? { ...p, serverId: created.id } : p)));
          if (onSaved) onSaved(withServerId);
        } else {
          if (onSaved) onSaved(selectedPlan);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  
  
  const handleSaveAsTemplate = async () => {
    if (!selectedPlan) return;
    setSaving(true);
    setError(null);
    try {
      const payload = { weeks: selectedPlan.weeks };
      await templateApi.create(selectedPlan.name, payload);
      await loadTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const cloneTemplateToNewPlan = (tpl: Plan): Plan => {
    const weeks: PlanWeek[] = tpl.weeks.map((w) => ({
      id: uuid(),
      name: w.name,
      days: w.days.map((d) => ({
        id: uuid(),
        name: d.name,
        items: d.items.map((it) => ({
          id: uuid(),
          exerciseId: it.exerciseId,
          exerciseName: it.exerciseName,
          targetSets: it.targetSets,
          targetReps: it.targetReps ?? "",
        })),
      })),
    }));
    return { id: uuid(), name: tpl.name, weeks };
  };

  const openTemplate = (tpl: Plan) => {
    const newPlan = cloneTemplateToNewPlan(tpl);
    setPlans((prev) => [...prev, newPlan]);
    onSelectPlan(newPlan.id, newPlan);
    setShowPlanList(false);
  };

  const deleteTemplate = async (tpl: Plan) => {
    if (!tpl.serverId) return;
    if (!window.confirm(`Delete template "${tpl.name}"?`)) return;
    try {
      await templateApi.remove(tpl.serverId);
      setTemplates((prev) => prev.filter((t) => t.serverId !== tpl.serverId));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const renameTemplate = async (tpl: Plan) => {
    if (!tpl.serverId) return;
    const name = window.prompt("Rename template", tpl.name);
    if (!name) return;
    try {
      const payload = { weeks: tpl.weeks };
      const updated = await templateApi.update(tpl.serverId, name, payload);
      setTemplates((prev) => prev.map((t) => (t.serverId === tpl.serverId ? { ...t, name: updated.name ?? name } : t)));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  // --- Export / Import (CSV) ---
  const importInputRef = useRef<HTMLInputElement | null>(null);

  function handleExportPlanCSV(plan: Plan) {
    exportPlanCSV(plan, buildCatalogByName(catalogExercises));
  }

  function handleExportTemplateCSV(tpl: Plan) {
    exportPlanCSV(tpl, buildCatalogByName(catalogExercises));
  }

  const parseCSV = (text: string): string[][] => {
    const rows: string[][] = [];
    let cur: string[] = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else { inQuotes = false; }
        } else {
          cell += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          cur.push(cell); cell = '';
        } else if (ch === '\n') {
          cur.push(cell); cell = '';
          if (cur.length && cur[cur.length - 1].endsWith('\r')) {
            cur[cur.length - 1] = cur[cur.length - 1].replace(/\r$/, '');
          }
          rows.push(cur);
          cur = [];
        } else {
          cell += ch;
        }
      }
    }
    cur.push(cell);
    if (!(cur.length === 1 && cur[0] === '')) rows.push(cur);
    while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();
    return rows;
  };

  const csvToPlan = (nameFromFile: string, text: string): PlanImportResult | null => {
    const rows = parseCSV(text);
    if (rows.length === 0) return null;
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = {
      planName: header.indexOf('planname'),
      weekName: header.indexOf('weekname'),
      dayName: header.indexOf('dayname'),
      exerciseName: header.indexOf('exercisename'),
      targetSets: header.indexOf('targetsets'),
      targetReps: header.indexOf('targetreps'),
      myoReps: header.indexOf('myoreps'),
      note: header.indexOf('note'),
      isCustom: header.indexOf('iscustom'),
      primaryMuscle: header.indexOf('primarymuscle'),
      equipment: header.indexOf('equipment'),
      isCompound: header.indexOf('iscompound'),
      secondaryMuscles: header.indexOf('secondarymuscles'),
    } as const;
    if (idx.weekName < 0 || idx.dayName < 0 || idx.exerciseName < 0 || idx.targetSets < 0) {
      alert('CSV missing required columns: weekName, dayName, exerciseName, targetSets');
      return null;
    }
    const weeks: PlanWeek[] = [];
    const exerciseMeta = new Map<string, ImportedExerciseMeta>();
    const getWeek = (name: string): PlanWeek => {
      const found = weeks.find((w) => w.name === name);
      if (found) return found;
      const w: PlanWeek = { id: uuid(), name: name || 'Week', days: [] };
      weeks.push(w);
      return w;
    };
    const getDay = (week: PlanWeek, name: string): PlanDay => {
      const found = week.days.find((d) => d.name === name);
      if (found) return found;
      const d: PlanDay = { id: uuid(), name: name || 'Day', items: [] };
      week.days.push(d);
      return d;
    };
    let planName = '';
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (row.length === 0 || row.every((c) => c.trim() === '')) continue;
      const wName = row[idx.weekName] || '';
      const dName = row[idx.dayName] || '';
      const exName = row[idx.exerciseName] || '';
      const setsRaw = row[idx.targetSets] || '';
      const reps = idx.targetReps >= 0 ? (row[idx.targetReps] || '') : '';
      if (idx.planName >= 0 && !planName) planName = row[idx.planName] || '';
      const sets = Number(setsRaw);
      const week = getWeek(wName);
      const day = getDay(week, dName);
      if (exName) {
        const myoReps = idx.myoReps >= 0 && parseBool(row[idx.myoReps]);
        day.items.push({ id: uuid(), exerciseName: exName, targetSets: Number.isFinite(sets) && sets > 0 ? sets : 0, targetReps: reps, myoReps: myoReps || undefined });
        const key = exName.trim().toLowerCase();
        if (key) {
          const current = exerciseMeta.get(key) || {};
          if (idx.isCustom >= 0 && row[idx.isCustom]) {
            current.isCustom = parseBool(row[idx.isCustom]);
          }
          if (idx.primaryMuscle >= 0 && row[idx.primaryMuscle]) {
            current.primaryMuscle = row[idx.primaryMuscle].trim();
          }
          if (idx.equipment >= 0 && row[idx.equipment]) {
            const rawEquip = row[idx.equipment].trim().toLowerCase();
            if (rawEquip === 'machine' || rawEquip === 'free_weight' || rawEquip === 'cable' || rawEquip === 'body_weight') {
              current.equipment = rawEquip as ImportedExerciseMeta['equipment'];
            }
          }
          if (idx.isCompound >= 0 && row[idx.isCompound]) {
            current.isCompound = parseBool(row[idx.isCompound]);
          }
          if (idx.secondaryMuscles >= 0 && row[idx.secondaryMuscles]) {
            const rawSecondary = row[idx.secondaryMuscles];
            const list = rawSecondary
              .split(';')
              .map((val) => val.trim())
              .filter((val) => val.length > 0);
            if (list.length) current.secondaryMuscles = list;
          }
          exerciseMeta.set(key, current);
        }
      }
    }
    const finalName = (planName || nameFromFile || 'Imported Plan').replace(/\.csv$/i, '');
    return { plan: { id: uuid(), name: finalName, weeks }, exerciseMeta };
  };

  const handleClickImportPlan = () => {
    importInputRef.current?.click();
  };

  const handleImportPlanFile: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files && e.target.files[0];
    e.currentTarget.value = '';
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.csv')) {
      alert('Please select a .csv file');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = String(reader.result || '');
        const result = csvToPlan(file.name, text);
        if (!result) return;
        const { plan, exerciseMeta } = result;
        try {
          const existingByName = buildCatalogByName(catalogExercises);
          const createdNames = new Set<string>();
          for (const week of plan.weeks) {
            for (const day of week.days) {
              for (const item of day.items) {
                const name = item.exerciseName || '';
                const key = name.trim().toLowerCase();
                if (!key || existingByName.has(key) || createdNames.has(key)) continue;
                createdNames.add(key);
                if (!onCreateCustomExercise) continue;
                const meta = exerciseMeta.get(key) || {};
                const primaryMuscle = meta.primaryMuscle && meta.primaryMuscle.trim() !== ''
                  ? meta.primaryMuscle.trim()
                  : 'Other';
                const equipment = meta.equipment ?? 'body_weight';
                const isCompound = meta.isCompound ?? false;
                const secondary = meta.secondaryMuscles ?? [];
                try {
                  await onCreateCustomExercise({
                    name,
                    primaryMuscle,
                    equipment,
                    isCompound,
                    secondaryMuscles: isCompound ? secondary : [],
                  });
                } catch {
                  // ignore duplicate/custom creation failures on import
                }
              }
            }
          }
        } catch {
          /* ignore custom creation issues */
        }
        // After creating the plan, seed notes from CSV if provided
        try {
          const rows = parseCSV(text);
          if (rows.length > 0) {
            const header = rows[0].map((h) => h.trim().toLowerCase());
            const idx = {
              weekName: header.indexOf('weekname'),
              dayName: header.indexOf('dayname'),
              exerciseName: header.indexOf('exercisename'),
              note: header.indexOf('note'),
            } as const;
            if (idx.weekName >= 0 && idx.dayName >= 0 && idx.exerciseName >= 0 && idx.note >= 0) {
              const importedInstructions: Record<string, string> = {};
              for (let r = 1; r < rows.length; r++) {
                const row = rows[r];
                if (!row || row.length === 0) continue;
                const exName = row[idx.exerciseName] || '';
                const note = (row[idx.note] || '').trim();
                if (!exName || !note) continue;
                const nameKey = normalizeExerciseName(exName).toLowerCase();
                if (nameKey) importedInstructions[nameKey] = note;
              }
              if (Object.keys(importedInstructions).length > 0) {
                // Store AI coaching notes as instructions (merged with existing)
                getUserPrefs().then((up) => {
                  const existing = ((up?.prefs as UserPrefsData | null)?.exercise_instructions) || {};
                  upsertUserPrefs({ exercise_instructions: { ...existing, ...importedInstructions } }).catch(() => { /* ignore */ });
                }).catch(() => {
                  upsertUserPrefs({ exercise_instructions: importedInstructions }).catch(() => { /* ignore */ });
                });
              }
            }
          }
        } catch { /* ignore */ }
        setPlans((prev) => [...prev, plan]);
        onSelectPlan(plan.id, plan);
        setShowPlanList(false);
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      }
    };
    reader.onerror = () => alert('Failed to read file');
    reader.readAsText(file);
  };

  const handleImportCSVText = async (text: string) => {
    try {
      const result = csvToPlan('AI Generated Plan', text);
      if (!result) { alert('Failed to parse the generated program.'); return; }
      const { plan, exerciseMeta } = result;
      try {
        const existingByName = buildCatalogByName(catalogExercises);
        const createdNames = new Set<string>();
        for (const week of plan.weeks) {
          for (const day of week.days) {
            for (const item of day.items) {
              const name = item.exerciseName || '';
              const key = name.trim().toLowerCase();
              if (!key || existingByName.has(key) || createdNames.has(key)) continue;
              createdNames.add(key);
              if (!onCreateCustomExercise) continue;
              const meta = exerciseMeta.get(key) || {};
              try {
                await onCreateCustomExercise({
                  name,
                  primaryMuscle: meta.primaryMuscle?.trim() || 'Other',
                  equipment: meta.equipment ?? 'body_weight',
                  isCompound: meta.isCompound ?? false,
                  secondaryMuscles: (meta.isCompound ?? false) ? (meta.secondaryMuscles ?? []) : [],
                });
              } catch { /* ignore */ }
            }
          }
        }
      } catch { /* ignore */ }
      // Seed notes from the CSV
      try {
        const rows = parseCSV(text);
        if (rows.length > 0) {
          const header = rows[0].map((h) => h.trim().toLowerCase());
          const nIdx = { exerciseName: header.indexOf('exercisename'), note: header.indexOf('note') };
          if (nIdx.exerciseName >= 0 && nIdx.note >= 0) {
            const importedNotes: Record<string, string> = {};
            for (let r = 1; r < rows.length; r++) {
              const row = rows[r];
              if (!row || row.length === 0) continue;
              const exName = row[nIdx.exerciseName] || '';
              const note = (row[nIdx.note] || '').trim();
              if (!exName || !note) continue;
              const nameKey = normalizeExerciseName(exName).toLowerCase();
              if (nameKey) importedNotes[nameKey] = note;
            }
            if (Object.keys(importedNotes).length > 0) {
              upsertUserPrefs({ exercise_notes: importedNotes }).catch(() => {});
            }
          }
        }
      } catch { /* ignore */ }
      setPlans((prev) => [...prev, plan]);
      onSelectPlan(plan.id, plan);
      setShowPlanList(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Card>
      <datalist id="exercise-options">
        {catalogExercises.map((exercise) => (
          <option key={exercise.id} value={exercise.name} />
        ))}
      </datalist>
      <div className="flex justify-between gap-3 flex-wrap mb-4">
        <div className="flex gap-3 flex-wrap">
          <Button onClick={() => setShowPlanList(true)}>
            Manage Plans & Templates</Button>
          <Button onClick={handleCreatePlan}>
            + Plan
          </Button>
          {(exerciseLoading || catalogLoading) && (
            <div className="text-muted self-center text-[13px]">Loading exercises...</div>
          )}
          {selectedPlan && (
            <>
              <Button onClick={handleAddWeek}>
                + Week
              </Button>
              {selectedPlan.weeks.length > 1 && (
                <Button onClick={handleCopyWeekOneToAll}>
                  Copy Week 1 to All
                </Button>
              )}
              <Button onClick={handleSavePlan} variant="primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save Plan'}
              </Button>
              <Button onClick={handleSaveAsTemplate} disabled={saving}>
                Save as Template
              </Button>
            </>
          )}
        </div>
      </div>

      {error && <div className="text-error mt-2 px-3 py-2.5 bg-error-muted rounded-sm">{error}</div>}

      {!selectedPlan ? (
        <EmptyState message="Create a plan to get started." className="mt-4" />
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <label className="block mb-2 font-semibold text-[15px] text-secondary">Plan Name</label>
            <input
              value={selectedPlan.name}
              onChange={(e) => handlePlanNameChange(e.target.value)}
              className="w-full"
            />
          </div>

          <div>
            <label className="block mb-2 font-semibold text-[15px] text-secondary">Plan Type</label>
            <div className="flex gap-2">
              <Button
                onClick={() => updatePlan(selectedPlan.id, (p) => ({ ...p, ghostMode: 'default' }))}
                style={{
                  flex: 1,
                  background: (selectedPlan.ghostMode ?? 'default') === 'default' ? 'var(--accent-muted)' : 'var(--bg-card)',
                  borderColor: (selectedPlan.ghostMode ?? 'default') === 'default' ? 'var(--border-strong)' : 'var(--border-default)',
                }}
              >
                Default
              </Button>
              <Button
                onClick={() => updatePlan(selectedPlan.id, (p) => ({ ...p, ghostMode: 'full-body' }))}
                style={{
                  flex: 1,
                  background: selectedPlan.ghostMode === 'full-body' ? 'var(--accent-muted)' : 'var(--bg-card)',
                  borderColor: selectedPlan.ghostMode === 'full-body' ? 'var(--border-strong)' : 'var(--border-default)',
                }}
              >
                Full Body
              </Button>
            </div>
            <p className="text-[13px] text-muted mt-2 leading-snug">
              {(selectedPlan.ghostMode ?? 'default') === 'default'
                ? 'Ghost shows your most recent performance regardless of day.'
                : 'Ghost only shows performance from the same day (e.g., Tuesday vs Tuesday).'}
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {selectedPlan.weeks.map((week) => (
              <div key={week.id} className="bg-elevated border border-subtle rounded-md p-3">
                <div className="flex justify-between items-center mb-3 gap-3 flex-wrap">
                  <div className="flex gap-3 items-center flex-wrap">
                    <input
                      value={week.name}
                      onChange={(e) => handleWeekNameChange(week.id, e.target.value)}
                      className="min-w-[140px] font-semibold"
                    />
                    <Button onClick={() => handleAddDay(week.id)} size="sm">
                      + Day
                    </Button>
                  </div>
                  <Button onClick={() => handleRemoveWeek(week.id)} size="sm" disabled={selectedPlan.weeks.length <= 1}>
                    Delete Week
                  </Button>
                </div>

                {week.days.some((d) => d.items.length > 0) && (
                  <div className="flex flex-wrap gap-2 mb-3 px-3 py-2 bg-card rounded-md text-[13px] text-secondary">
                    <span className="font-semibold mr-1">Week Total:</span>
                    {Object.entries(calculateWeekSetsPerMuscle(week, catalogExercises))
                      .sort((a, b) => b[1] - a[1])
                      .map(([muscle, sets]) => (
                        <span key={muscle}>
                          <strong>{muscle}:</strong> {sets}
                        </span>
                      ))
                    }
                  </div>
                )}

                <div
                  className="flex flex-col gap-3" style={{ touchAction: draggingDayId && dayDragActive ? 'none' as any : 'auto' }}
                  onPointerMove={(e) => {
                    if (!draggingDayId || dayDragWeekId !== week.id) return;
                    const dy = Math.abs(e.clientY - dayDragStartYRef.current);
                    if (!dayDragActive && dy > 8) setDayDragActive(true);
                    if (!dayDragActive) return;
                    e.preventDefault();
                    const container = e.currentTarget as HTMLElement;
                    const rows = Array.from(container.querySelectorAll('[data-day-id]')) as HTMLElement[];
                    if (rows.length === 0) return;
                    const y = e.clientY;
                    let insert = rows.length;
                    for (let i = 0; i < rows.length; i++) {
                      const r = rows[i].getBoundingClientRect();
                      const mid = r.top + r.height / 2;
                      if (y < mid) { insert = i; break; }
                    }
                    setDayDragInsertIndex(insert);
                  }}
                  onPointerUp={() => {
                    if (!draggingDayId || dayDragWeekId !== week.id) return;
                    if (dayDragTimerRef.current) { window.clearTimeout(dayDragTimerRef.current); dayDragTimerRef.current = null; }
                    if (!dayDragActive) {
                      setDraggingDayId(null);
                      setDayDragWeekId(null);
                      setDayDragInsertIndex(null);
                      return;
                    }
                    const insert = dayDragInsertIndex == null ? week.days.length : dayDragInsertIndex;
                    handleReorderDayAtIndex(week.id, draggingDayId, insert);
                    setDraggingDayId(null);
                    setDayDragWeekId(null);
                    setDayDragInsertIndex(null);
                    setDayDragActive(false);
                  }}
                >
                {week.days.map((day, dayIdx) => (
                  <div key={day.id} data-day-id={day.id} style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 12,
                    padding: 12,
                    transition: 'all 0.15s ease',
                  }}>
                    <div className="flex justify-between items-center flex-wrap gap-3 mb-3">
                      <div className="flex gap-3 items-center flex-wrap">
                        <div
                          onPointerDown={(e) => {
                            e.preventDefault();
                            setDraggingDayId(day.id);
                            setDayDragWeekId(week.id);
                            setDayDragActive(false);
                            dayDragStartYRef.current = e.clientY;
                            setDayDragInsertIndex(dayIdx);
                            if (dayDragTimerRef.current) window.clearTimeout(dayDragTimerRef.current);
                            dayDragTimerRef.current = window.setTimeout(() => setDayDragActive(true), 150);
                            try { (e.currentTarget as HTMLElement).setPointerCapture && (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
                          }}
                          className="text-center text-lg leading-[18px] px-2.5 py-1.5 select-none touch-none cursor-grab bg-elevated rounded-sm text-muted"
                          aria-label="Drag day handle"
                          title="Drag to reorder day"
                        >
                          ≡
                        </div>
                        <input
                          value={day.name}
                          onChange={(e) => handleDayNameChange(week.id, day.id, e.target.value)}
                          className="min-w-[120px]"
                        />
                        <Button onClick={() => handleAddExercise(week.id, day.id)} size="sm">
                          + Exercise
                        </Button>
                        <Button onClick={() => handleDuplicateDay(week.id, day.id)} size="sm">
                          Duplicate Day
                        </Button>
                      </div>
                      <Button onClick={() => handleRemoveDay(week.id, day.id)} size="sm" disabled={week.days.length <= 1}>
                        Delete Day
                      </Button>
                    </div>

                    {day.items.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3 px-3 py-2 bg-elevated rounded-md text-[13px] text-secondary">
                        {Object.entries(calculateSetsPerMuscle(day.items, catalogExercises))
                          .sort((a, b) => b[1] - a[1])
                          .map(([muscle, sets]) => (
                            <span key={muscle}>
                              <strong>{muscle}:</strong> {sets}
                            </span>
                          ))
                        }
                      </div>
                    )}

                    {day.items.length === 0 ? (
                      <div className="text-muted text-[13px]">No exercises yet.</div>
                    ) : (
                      <div
                        className="flex flex-col gap-2" style={{ touchAction: draggingExerciseId && dragActive ? 'none' as any : 'auto' }}
                        onPointerMove={(e) => {
                          if (!draggingExerciseId || dragWeekId !== week.id || dragDayId !== day.id) return;
                          const dy = Math.abs(e.clientY - dragStartYRef.current);
                          if (!dragActive && dy > 8) setDragActive(true);
                          if (!dragActive) return;
                          e.preventDefault();
                          const container = e.currentTarget as HTMLElement;
                          const rows = Array.from(container.querySelectorAll('[data-exercise-id]')) as HTMLElement[];
                          if (rows.length === 0) return;
                          const y = e.clientY;
                          let insert = rows.length;
                          for (let i = 0; i < rows.length; i++) {
                            const r = rows[i].getBoundingClientRect();
                            const mid = r.top + r.height / 2;
                            if (y < mid) { insert = i; break; }
                          }
                          setDragInsertIndex(insert);
                        }}
                        onPointerUp={() => {
                          if (!draggingExerciseId || dragWeekId !== week.id || dragDayId !== day.id) return;
                          if (dragTimerRef.current) { window.clearTimeout(dragTimerRef.current); dragTimerRef.current = null; }
                          if (!dragActive) {
                            setDraggingExerciseId(null);
                            setDragWeekId(null);
                            setDragDayId(null);
                            setDragInsertIndex(null);
                            return;
                          }
                          const insert = dragInsertIndex == null ? day.items.length : dragInsertIndex;
                          handleReorderExerciseAtIndex(week.id, day.id, draggingExerciseId, insert);
                          setDraggingExerciseId(null);
                          setDragWeekId(null);
                          setDragDayId(null);
                          setDragInsertIndex(null);
                          setDragActive(false);
                        }}
                        onPointerCancel={() => {
                          if (dragTimerRef.current) { window.clearTimeout(dragTimerRef.current); dragTimerRef.current = null; }
                          setDraggingExerciseId(null);
                          setDragWeekId(null);
                          setDragDayId(null);
                          setDragInsertIndex(null);
                          setDragActive(false);
                        }}
                      >
                        {day.items.map((item, idx) => {
                          const options = SET_COUNT_OPTIONS.includes(item.targetSets)
                            ? SET_COUNT_OPTIONS
                            : [...SET_COUNT_OPTIONS, item.targetSets].sort((a, b) => a - b);

                          return (
                            <>
                              {draggingExerciseId && dragActive && dragWeekId === week.id && dragDayId === day.id && dragInsertIndex === idx && (
                                <div className="h-2 border-t-2 border-dashed border-t-strong rounded-sm" />
                              )}
                              <div
                                key={item.id}
                                data-exercise-id={item.id}
                                className="hidden sm:grid sm:grid-cols-[auto_1fr_auto_auto_auto_auto] gap-2 items-center border border-default rounded-sm p-2 cursor-grab"
                                style={{
                                  opacity: draggingExerciseId === item.id && dragActive ? 0.6 : 1,
                                  touchAction: draggingExerciseId && dragActive ? 'none' as any : 'auto',
                                  userSelect: draggingExerciseId && dragActive ? 'none' as any : 'auto',
                                }}
                                title="Drag to reorder"
                              >
                                <div
                                  onPointerDown={(e) => {
                                    // Start drag only from the handle to avoid selecting inputs
                                    e.preventDefault();
                                    setDraggingExerciseId(item.id);
                                    setDragWeekId(week.id);
                                    setDragDayId(day.id);
                                    setDragActive(false);
                                    dragStartYRef.current = e.clientY;
                                    setDragInsertIndex(idx);
                                    if (dragTimerRef.current) window.clearTimeout(dragTimerRef.current);
                                    dragTimerRef.current = window.setTimeout(() => setDragActive(true), 150);
                                    try { (e.currentTarget as HTMLElement).setPointerCapture && (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
                                  }}
                                  className="text-center text-lg leading-[18px] px-1.5 select-none touch-none cursor-grab"
                                  aria-label="Drag handle"
                                  title="Drag to reorder"
                                >
                                  ≡
                                </div>
                              <input
                                value={item.exerciseName}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) =>
                                  handleExerciseChange(week.id, day.id, item.id, {
                                    exerciseName: e.target.value,
                                    exerciseId: undefined,
                                    })
                                  }
                                  onBlur={(e) => {
                                    void handleExerciseNameCommit(week.id, day.id, item.id, e.target.value);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      (e.currentTarget as HTMLInputElement).blur();
                                    }
                                  }}
                                list="exercise-options"
                                className="p-2 flex-1 min-w-0"
                                placeholder="Exercise name"
                              />
                              <Button
                                onClick={() => openSearchForItem(week.id, day.id, item.id)}
                                size="sm"
                              >
                                Search
                              </Button>
                              <select
                                value={String(item.targetSets)}
                                onChange={(e) =>
                                  handleExerciseChange(week.id, day.id, item.id, {
                                    targetSets: Number(e.target.value),
                                  })
                                }
                                className="py-2 pl-2 pr-6 w-[52px]"
                                title={`${item.targetSets} ${item.targetSets === 1 ? 'set' : 'sets'}`}
                              >
                                {options.map((count) => (
                                  <option key={count} value={count}>
                                    {count}
                                  </option>
                                ))}
                              </select>
                              <Button
                                onClick={() => handleExerciseChange(week.id, day.id, item.id, { myoReps: !item.myoReps })}
                                size="sm"
                                style={{
                                  padding: '4px 8px',
                                  fontSize: 11,
                                  background: item.myoReps ? 'var(--accent-purple-muted)' : 'var(--bg-card)',
                                  borderColor: item.myoReps ? 'var(--accent-purple)' : 'var(--border-subtle)',
                                  color: item.myoReps ? 'var(--accent-purple)' : 'var(--text-muted)',
                                }}
                                title="Myo-Rep Match"
                              >
                                MYO
                              </Button>
                              <Button onClick={() => handleRemoveExercise(week.id, day.id, item.id)} size="xs" title="Remove exercise">
                                X
                              </Button>
                              </div>
                              {/* Mobile: two-row layout */}
                              <div
                                data-exercise-id={item.id}
                                className="flex flex-col gap-1.5 sm:hidden border border-default rounded-sm p-2 cursor-grab"
                                style={{
                                  opacity: draggingExerciseId === item.id && dragActive ? 0.6 : 1,
                                  touchAction: draggingExerciseId && dragActive ? 'none' as any : 'auto',
                                  userSelect: draggingExerciseId && dragActive ? 'none' as any : 'auto',
                                }}
                                title="Drag to reorder"
                              >
                                {/* Row 1: drag handle + full-width name */}
                                <div className="flex items-center gap-2">
                                  <div
                                    onPointerDown={(e) => {
                                      e.preventDefault();
                                      setDraggingExerciseId(item.id);
                                      setDragWeekId(week.id);
                                      setDragDayId(day.id);
                                      setDragActive(false);
                                      dragStartYRef.current = e.clientY;
                                      setDragInsertIndex(idx);
                                      if (dragTimerRef.current) window.clearTimeout(dragTimerRef.current);
                                      dragTimerRef.current = window.setTimeout(() => setDragActive(true), 150);
                                      try { (e.currentTarget as HTMLElement).setPointerCapture && (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
                                    }}
                                    className="text-center text-lg leading-[18px] px-1 select-none touch-none cursor-grab"
                                    aria-label="Drag handle"
                                    title="Drag to reorder"
                                  >
                                    ≡
                                  </div>
                                  <input
                                    value={item.exerciseName}
                                    onFocus={(e) => e.target.select()}
                                    onChange={(e) =>
                                      handleExerciseChange(week.id, day.id, item.id, {
                                        exerciseName: e.target.value,
                                        exerciseId: undefined,
                                      })
                                    }
                                    onBlur={(e) => {
                                      void handleExerciseNameCommit(week.id, day.id, item.id, e.target.value);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        (e.currentTarget as HTMLInputElement).blur();
                                      }
                                    }}
                                    list="exercise-options"
                                    className="p-1.5 text-[14px] flex-1 min-w-0"
                                    placeholder="Exercise name"
                                  />
                                </div>
                                {/* Row 2: sets + actions */}
                                <div className="flex items-center gap-2 pl-6">
                                  <div className="flex items-center gap-1">
                                    <select
                                      value={String(item.targetSets)}
                                      onChange={(e) =>
                                        handleExerciseChange(week.id, day.id, item.id, {
                                          targetSets: Number(e.target.value),
                                        })
                                      }
                                      className="py-1 pl-2 pr-6 w-[48px] text-[13px]"
                                      title={`${item.targetSets} ${item.targetSets === 1 ? 'set' : 'sets'}`}
                                    >
                                      {options.map((count) => (
                                        <option key={count} value={count}>
                                          {count}
                                        </option>
                                      ))}
                                    </select>
                                    <span className="text-[12px] text-secondary">sets</span>
                                  </div>
                                  <div className="flex items-center gap-1.5 ml-auto">
                                    <Button
                                      onClick={() => openSearchForItem(week.id, day.id, item.id)}
                                      size="sm"
                                      style={{ padding: '4px 8px', fontSize: 12 }}
                                    >
                                      Search
                                    </Button>
                                    <Button
                                      onClick={() => handleExerciseChange(week.id, day.id, item.id, { myoReps: !item.myoReps })}
                                      size="sm"
                                      style={{
                                        padding: '4px 8px',
                                        fontSize: 11,
                                        background: item.myoReps ? 'var(--accent-purple-muted)' : 'var(--bg-card)',
                                        borderColor: item.myoReps ? 'var(--accent-purple)' : 'var(--border-subtle)',
                                        color: item.myoReps ? 'var(--accent-purple)' : 'var(--text-muted)',
                                      }}
                                      title="Myo-Rep Match"
                                    >
                                      MYO
                                    </Button>
                                    <Button onClick={() => handleRemoveExercise(week.id, day.id, item.id)} size="xs" title="Remove exercise">
                                      X
                                    </Button>
                                  </div>
                                </div>
                              </div>
                              {draggingExerciseId && dragActive && dragWeekId === week.id && dragDayId === day.id && dragInsertIndex === idx + 1 && (
                                <div className="h-2 border-t-2 border-dashed border-t-strong rounded-sm" />
                              )}
                            </>
                          );
                        })}
                        {draggingExerciseId && dragActive && dragWeekId === week.id && dragDayId === day.id && dragInsertIndex === day.items.length && (
                          <div className="h-2 border-t-2 border-dashed border-t-strong rounded-sm" />
                        )}
                      </div>
                    )}
                    {draggingDayId && dayDragActive && dayDragWeekId === week.id && dayDragInsertIndex === dayIdx + 1 && (
                      <div className="h-2 border-t-2 border-dashed border-t-strong rounded-sm my-2.5" />
                    )}
                  </div>
                ))}
                {draggingDayId && dayDragActive && dayDragWeekId === week.id && dayDragInsertIndex === week.days.length && (
                  <div className="h-2 border-t-2 border-dashed border-t-strong rounded-sm" />
                )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal open={showPlanList} onClose={() => setShowPlanList(false)} maxWidth={480} maxHeight="80vh" zIndex={10}>
            <div className="flex justify-between items-center">
              <h3 className="m-0 text-lg">Manage {manageTab === 'plans' ? 'Plans' : 'Templates'}</h3>
              <div className="flex gap-2 items-center">
                {manageTab === 'plans' && (
                  <>
                    <Button onClick={() => setShowAIProgramBuilder(true)} size="sm">AI Program Builder</Button>
                    <Button onClick={handleClickImportPlan} size="sm">Import (CSV)</Button>
                    <input ref={importInputRef} type="file" accept=".csv" onChange={handleImportPlanFile} className="hidden" />
                  </>
                )}
                <Button onClick={() => setShowPlanList(false)}>
                  Close
                </Button>
              </div>
            </div>
            <div className="flex gap-2 border-b border-b-subtle pb-3">
              <Button
                onClick={() => setManageTab('plans')}
                style={{
                  background: manageTab === 'plans' ? 'var(--accent-muted)' : 'var(--bg-card)',
                  borderColor: manageTab === 'plans' ? 'var(--border-strong)' : 'var(--border-default)',
                }}
                aria-pressed={manageTab === 'plans'}
              >Plans</Button>
              <Button
                onClick={() => setManageTab('templates')}
                style={{
                  background: manageTab === 'templates' ? 'var(--accent-muted)' : 'var(--bg-card)',
                  borderColor: manageTab === 'templates' ? 'var(--border-strong)' : 'var(--border-default)',
                }}
                aria-pressed={manageTab === 'templates'}
              >Templates</Button>
            </div>
            {manageTab === 'plans' ? (
              <div className="flex flex-col gap-3">
                {plans.length === 0 && <EmptyState message="No plans yet." />}
                {plans.map((plan) => (
                  <div key={plan.id} className="bg-card border border-subtle rounded-md p-3 flex justify-between items-center gap-3 transition-all duration-150">
                    <div>
                      <div className="font-semibold">{plan.name}</div>
                      {plan.serverId && <Badge variant="success">Synced</Badge>}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => {
                          const fullPlan = plans.find((p) => p.id === plan.id) || null;
                          onSelectPlan(plan.id, fullPlan ?? null);
                          setShowPlanList(false);
                        }}
                        size="sm"
                      >
                        Open
                      </Button>
                      <Button onClick={() => handleExportPlanCSV(plan)} size="sm">Export</Button>
                      <Button onClick={() => handleDeletePlan(plan.id)} size="sm">
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {templatesError && <div className="text-error px-3 py-2.5 bg-error-muted rounded-sm">{templatesError}</div>}
                {templatesLoading ? (
                  <div className="text-muted p-4 text-center">Loading templates...</div>
                ) : templates.length === 0 ? (
                  <EmptyState message="No templates yet." />
                ) : (
                  templates.map((tpl) => (
                    <div key={tpl.id} className="bg-card border border-subtle rounded-md p-3 flex justify-between items-center gap-3 transition-all duration-150">
                      <div>
                        <div className="font-semibold">{tpl.name}</div>
                      </div>
                      <div className="flex gap-2">
                        <Button onClick={() => openTemplate(tpl)} size="sm">Open</Button>
                        <Button onClick={() => renameTemplate(tpl)} size="sm">Rename</Button>
                        <Button onClick={() => handleExportTemplateCSV(tpl)} size="sm">Export</Button>
                        <Button onClick={() => deleteTemplate(tpl)} size="sm">Delete</Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
      </Modal>

      {showAIProgramBuilder && (
        <AIProgramBuilder catalogExercises={catalogExercises} onClose={() => setShowAIProgramBuilder(false)} onImportCSV={handleImportCSVText} />
      )}

      <Modal open={searchOpen} onClose={() => setSearchOpen(false)} title="Search Exercises" maxWidth={980}>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search name..."
               
              />
              <select value={searchPrimary} onChange={(e) => setSearchPrimary(e.target.value)} >
                <option value="All">Primary Muscle (All)</option>
                {primaryMuscles.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select value={searchSecondary} onChange={(e) => setSearchSecondary(e.target.value)} >
                <option value="All">Secondary Muscle (All)</option>
                {secondaryMuscles.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select value={searchSource} onChange={(e) => setSearchSource(e.target.value as SearchSource)} >
                <option value="all">Source (All)</option>
                <option value="defaults">Defaults</option>
                <option value="home_made">Home Made *</option>
              </select>
              <Button variant="pill" active={searchMachine} onClick={() => setSearchMachine((prev) => !prev)} aria-pressed={searchMachine}>
                <span className="w-2.5 h-2.5 rounded-full border border-strong transition-all duration-150" style={{ background: searchMachine ? "var(--text-primary)" : "transparent" }} />
                Machine
              </Button>
              <Button variant="pill" active={searchFreeWeight} onClick={() => setSearchFreeWeight((prev) => !prev)} aria-pressed={searchFreeWeight}>
                <span className="w-2.5 h-2.5 rounded-full border border-strong transition-all duration-150" style={{ background: searchFreeWeight ? "var(--text-primary)" : "transparent" }} />
                Free weight
              </Button>
              <Button variant="pill" active={searchCable} onClick={() => setSearchCable((prev) => !prev)} aria-pressed={searchCable}>
                <span className="w-2.5 h-2.5 rounded-full border border-strong transition-all duration-150" style={{ background: searchCable ? "var(--text-primary)" : "transparent" }} />
                Cable
              </Button>
              <Button variant="pill" active={searchBodyWeight} onClick={() => setSearchBodyWeight((prev) => !prev)} aria-pressed={searchBodyWeight}>
                <span className="w-2.5 h-2.5 rounded-full border border-strong transition-all duration-150" style={{ background: searchBodyWeight ? "var(--text-primary)" : "transparent" }} />
                Bodyweight
              </Button>
              <Button variant="pill" active={searchCompound} onClick={() => setSearchCompound((prev) => !prev)} aria-pressed={searchCompound}>
                <span className="w-2.5 h-2.5 rounded-full border border-strong transition-all duration-150" style={{ background: searchCompound ? "var(--text-primary)" : "transparent" }} />
                Compound
              </Button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 14, minHeight: 280 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ fontWeight: 600 }}>Results</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{filteredCatalog.length} found</div>
                  </div>
                  <Button
                    onClick={() => {
                      setAddMovementOpen((prev) => !prev);
                      setAddMovementError(null);
                    }}
                    size="sm"
                  >
                    Can't find a movement? Create a new one!
                  </Button>
                </div>
                {addMovementOpen && (
                  <div className="bg-elevated border border-subtle rounded-md p-3 mb-3 flex flex-col gap-3">
                    <input
                      value={addMovementName}
                      onChange={(e) => setAddMovementName(e.target.value)}
                      placeholder="Movement name"
                     
                    />
                    <select
                      value={addMovementPrimary}
                      onChange={(e) => setAddMovementPrimary(e.target.value)}
                                         >
                      <option value="">Primary muscle</option>
                      {primaryMuscles.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <div className="flex flex-wrap gap-3">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="add-movement-equipment"
                          checked={addMovementEquipment === 'machine'}
                          onChange={() => setAddMovementEquipment('machine')}
                        />
                        Machine
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="add-movement-equipment"
                          checked={addMovementEquipment === 'free_weight'}
                          onChange={() => setAddMovementEquipment('free_weight')}
                        />
                        Free weight
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="add-movement-equipment"
                          checked={addMovementEquipment === 'cable'}
                          onChange={() => setAddMovementEquipment('cable')}
                        />
                        Cable
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="add-movement-equipment"
                          checked={addMovementEquipment === 'body_weight'}
                          onChange={() => setAddMovementEquipment('body_weight')}
                        />
                        Bodyweight
                      </label>
                    </div>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={addMovementCompound}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setAddMovementCompound(checked);
                          if (!checked) setAddMovementSecondary('');
                        }}
                      />
                      Compound
                    </label>
                    {addMovementCompound && (
                      <select
                        value={addMovementSecondary}
                        onChange={(e) => setAddMovementSecondary(e.target.value)}
                                             >
                        <option value="">Secondary muscle</option>
                        {primaryMuscles
                          .filter((m) => m !== addMovementPrimary)
                          .map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                      </select>
                    )}
                    {addMovementError && (
                      <div className="text-error text-[13px]">{addMovementError}</div>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button
                        onClick={() => {
                          resetAddMovement();
                          setAddMovementOpen(false);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button onClick={handleAddMovement} variant="primary">
                        Add
                      </Button>
                    </div>
                  </div>
                )}
                <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
                  {filteredCatalog.length === 0 ? (
                    <div className="text-muted">No matches.</div>
                  ) : (
                    filteredCatalog.map((ex) => (
                      <div key={`${ex.isCustom ? 'custom' : 'catalog'}:${ex.id}`} className="border border-subtle rounded-sm p-2 flex justify-between items-center gap-2">
                        <div>
                          <div className="font-semibold">{ex.name}{ex.isCustom ? ' *' : ''}</div>
                          <div className="text-muted text-[13px]">
                            {ex.primaryMuscle}{ex.secondaryMuscles.length ? ` / ${ex.secondaryMuscles.join(', ')}` : ''}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button onClick={() => addToQueue(ex)} size="sm">Add</Button>
                          {ex.isCustom && (
                            <Button onClick={() => handleDeleteCustomFromSearch(ex)} size="sm">Delete</Button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="border border-default rounded-md p-3">
                <div className="font-semibold mb-2">Queue</div>
                {searchQueue.length === 0 ? (
                  <div className="text-muted">No exercises selected.</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {searchQueue.map((q) => (
                      <div key={q.name} className="border border-subtle rounded-sm p-2 flex justify-between items-center gap-2">
                        <div>{q.name}</div>
                        <Button onClick={() => removeFromQueue(q.name)} size="sm">Remove</Button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex justify-end mt-3">
                  <Button onClick={applyQueueToDay} variant="primary" disabled={searchQueue.length === 0}>
                    Add to Day
                  </Button>
                </div>
              </div>
            </div>
            <div className="text-muted text-[13px] text-left">
              * = self made movement
            </div>
      </Modal>
    </Card>
  );
}

