import type { Plan, CatalogExercise, PlanWeek, PlanExercise } from '../types';
import { getUserPrefs, type UserPrefsData } from '../api/userPrefs';
import { normalizeExerciseName } from './utils';

export const csvEscape = (val: string) => '"' + String(val ?? '').replace(/"/g, '""') + '"';

export const buildCatalogByName = (catalog: CatalogExercise[]) => {
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

export function planToCSV(plan: Plan, catalogByName?: Map<string, CatalogExercise>, exerciseNotes?: Record<string, string>): string {
  const header = [
    'planName', 'weekName', 'dayName', 'exerciseName', 'targetSets',
    'targetReps', 'myoReps', 'note', 'isCustom', 'primaryMuscle',
    'equipment', 'isCompound', 'secondaryMuscles',
  ];
  const rows: string[] = [header.join(',')];
  for (const wk of plan.weeks) {
    const weekName = wk.name || '';
    for (const dy of wk.days) {
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
          ? meta.machine ? 'machine'
            : meta.freeWeight ? 'free_weight'
              : meta.cable ? 'cable'
                : meta.bodyWeight ? 'body_weight' : ''
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

export function downloadCSV(filename: string, csv: string) {
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

export async function exportPlanCSV(plan: Plan, catalogByName?: Map<string, CatalogExercise>) {
  let notes: Record<string, string> = {};
  try {
    const up = await getUserPrefs().catch(() => null);
    const p = (up?.prefs as UserPrefsData | null) || null;
    if (p?.exercise_notes) notes = p.exercise_notes;
  } catch { /* ignore */ }
  const csv = planToCSV(plan, catalogByName, notes);
  downloadCSV(`${plan.name || 'plan'}.csv`, csv);
}

export function generateExerciseCatalogCSV(exercises: CatalogExercise[]): string {
  const header = ['exerciseName', 'primaryMuscle', 'equipment', 'isCompound', 'secondaryMuscles', 'isCustom'];
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

export function generateAIPrompt(prefs: {
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
    if (days <= 3) {
      splitGuidance = `Full Body split (${days}x/week). Higher intensity per session, vary rep ranges across days (strength day, hypertrophy day, etc.). Include compound and isolation work.`;
    } else if (days === 4) {
      splitGuidance = `Upper/Lower split (${days}x/week). Higher volume per session with strategic exercise selection. Vary rep ranges between the two upper and two lower days.`;
    } else {
      splitGuidance = `Push/Pull/Legs or similar specialization split (${days}x/week). Higher volume and exercise variety. Can include dedicated arm/shoulder days if 6 days.`;
    }
  }

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

export function calculateSetsPerMuscle(
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

export function calculateWeekSetsPerMuscle(
  week: PlanWeek,
  catalogExercises: CatalogExercise[]
): Record<string, number> {
  const allItems = week.days.flatMap((day) => day.items);
  return calculateSetsPerMuscle(allItems, catalogExercises);
}
