
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Auth from "./Auth";
import { api, exerciseApi, exerciseCatalogApi, planApi, sessionApi, templateApi } from "./api";
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

const BTN_STYLE = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid var(--border-default)",
  background: "var(--bg-card)",
  color: "var(--text-primary)",
  fontWeight: 500,
  transition: "all 0.15s ease",
} as const;

const PRIMARY_BTN_STYLE = {
  padding: "12px 16px",
  borderRadius: 10,
  border: "1px solid var(--border-strong)",
  background: "var(--text-primary)",
  color: "var(--bg-base)",
  fontWeight: 600,
  boxShadow: "0 2px 8px rgba(255, 255, 255, 0.1)",
} as const;

const SMALL_BTN_STYLE = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-elevated)",
  color: "var(--text-secondary)",
  fontSize: 12,
  fontWeight: 500,
  transition: "all 0.15s ease",
} as const;

const FILTER_TOGGLE_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 12px",
  borderRadius: 999,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-elevated)",
  fontSize: 12,
  fontWeight: 500,
  transition: "all 0.15s ease",
} as const;

const CARD_STYLE = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 14,
  padding: 16,
  boxShadow: "var(--shadow-card)",
} as const;

const MODAL_OVERLAY_STYLE = {
  position: "fixed" as const,
  inset: 0,
  background: "rgba(0, 0, 0, 0.75)",
  backdropFilter: "blur(4px)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: 16,
  zIndex: 30,
} as const;

const MODAL_CONTENT_STYLE = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 16,
  padding: 20,
  boxShadow: "var(--shadow-lg)",
  maxHeight: "85vh",
  overflowY: "auto" as const,
} as const;

const INPUT_STYLE = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border-default)",
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  transition: "all 0.15s ease",
} as const;

const SELECT_STYLE = {
  ...INPUT_STYLE,
  cursor: "pointer",
} as const;

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

function planToCSV(plan: Plan, catalogByName?: Map<string, CatalogExercise>): string {
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
      let seed: Record<string, string> = {};
      try {
        const seedKey = `noteSeed:${plan.serverId ?? plan.id}:${dy.id}`;
        const raw = localStorage.getItem(seedKey);
        if (raw) seed = JSON.parse(raw) || {};
      } catch { /* ignore */ }
      for (const it of dy.items) {
        const note = seed[it.exerciseName || ''] || '';
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

function exportPlanCSV(plan: Plan, catalogByName?: Map<string, CatalogExercise>) {
  const csv = planToCSV(plan, catalogByName);
  downloadCSV(`${plan.name || 'plan'}.csv`, csv);
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
    let pulling = false;
    const threshold = 100;
    let indicator: HTMLDivElement | null = null;

    const createIndicator = () => {
      const el = document.createElement('div');
      el.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; height: 0;
        background: var(--bg-elevated); display: flex; align-items: center;
        justify-content: center; font-size: 14px; color: var(--text-secondary);
        overflow: hidden; z-index: 9999; transition: none;
      `;
      document.body.prepend(el);
      return el;
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (window.scrollY === 0) {
        startY = e.touches[0].clientY;
        pulling = true;
        if (!indicator) indicator = createIndicator();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!pulling || !indicator) return;
      const currentY = e.touches[0].clientY;
      const pullDistance = Math.max(0, currentY - startY);

      if (pullDistance > 0 && window.scrollY === 0) {
        const height = Math.min(pullDistance * 0.5, threshold);
        indicator.style.height = `${height}px`;
        indicator.textContent = pullDistance > threshold ? 'Release to refresh' : 'Pull to refresh';
      }
    };

    const handleTouchEnd = () => {
      if (!pulling || !indicator) return;
      const height = parseFloat(indicator.style.height);

      if (height >= threshold * 0.5) {
        indicator.textContent = 'Refreshing...';
        indicator.style.height = '50px';
        setTimeout(() => window.location.reload(), 300);
      } else {
        indicator.style.height = '0';
        setTimeout(() => { indicator?.remove(); indicator = null; }, 200);
      }
      pulling = false;
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      indicator?.remove();
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
        <div style={{ padding: 20 }}>Loading...</div>
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
      console.error('Failed to save streak:', err);
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
        console.error("Failed to load plans/prefs", err);
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
    <div style={{ maxWidth: 680, width: "100%", margin: "0 auto", padding: 20 }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        paddingBottom: 12,
        marginBottom: 16,
        borderBottom: "1px solid var(--border-subtle)"
      }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
          {streakConfig?.enabled && (
            <div
              style={{
                position: 'relative',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                cursor: 'pointer',
                transition: 'all var(--transition-fast)',
              }}
              onClick={() => setShowStreakSettings(true)}
              title={`${currentStreak} day streak`}
            >
              <span
                style={{
                  fontSize: 28,
                  filter: streakHitToday ? 'none' : 'grayscale(100%)',
                  opacity: streakHitToday ? 1 : 0.5,
                  lineHeight: 1,
                }}
              >
                🔥
              </span>
              <span
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -45%)',
                  fontSize: 11,
                  fontWeight: 700,
                  color: streakHitToday ? '#000' : 'var(--text-muted)',
                  textShadow: streakHitToday ? '0 0 2px rgba(255,255,255,0.8)' : 'none',
                  pointerEvents: 'none',
                }}
              >
                {currentStreak}
              </span>
            </div>
          )}
          <button onClick={() => setUserMenuOpen((v) => !v)} style={BTN_STYLE} aria-expanded={userMenuOpen} aria-haspopup="menu">Profile</button>
          {userMenuOpen && (
            <div role="menu" style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              padding: 12,
              marginTop: 8,
              minWidth: 220,
              zIndex: 30,
              boxShadow: 'var(--shadow-lg)'
            }}>
              <div style={{ padding: '4px 8px', color: 'var(--text-muted)', fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Logged in as</div>
              <div
                style={{ padding: '4px 8px 12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220, color: 'var(--text-primary)' }}
                title={user.username}
              >
                <strong>{user.username}</strong>
              </div>
              <button onClick={() => { setUserMenuOpen(false); setShowStreakSettings(true); }} style={{ ...SMALL_BTN_STYLE, width: '100%', marginBottom: 8 }} role="menuitem">Streak Settings</button>
              <button onClick={() => { setUserMenuOpen(false); handleOpenArchive(); }} style={{ ...SMALL_BTN_STYLE, width: '100%', marginBottom: 8 }} role="menuitem">Archive</button>
              <button onClick={() => { setUserMenuOpen(false); onLogout(); }} style={{ ...SMALL_BTN_STYLE, width: '100%' }} role="menuitem">Logout</button>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => { setUserMenuOpen(false); setMode("builder"); setShowPlanList(false); setSelectedPlanId(null); }}
            style={{
              ...BTN_STYLE,
              background: mode === "builder" ? "var(--accent-muted)" : "var(--bg-card)",
              borderColor: mode === "builder" ? "var(--border-strong)" : "var(--border-default)"
            }}
            aria-pressed={mode === "builder"}
          >Builder</button>
          <button
            onClick={() => { setUserMenuOpen(false); setMode("workout"); }}
            style={{
              ...BTN_STYLE,
              background: mode === "workout" ? "var(--accent-muted)" : "var(--bg-card)",
              borderColor: mode === "workout" ? "var(--border-strong)" : "var(--border-default)"
            }}
            aria-pressed={mode === "workout"}
          >Workout</button>
        </div>
      </div>

      {mode === "builder" && (
        <BuilderPage
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
        />
      )}

      {mode === "workout" && (
        <div style={CARD_STYLE}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <label style={{ color: 'var(--text-secondary)', fontWeight: 500, fontSize: 14 }}>Plan:</label>
              <select
                value={selectedPlanId ?? ''}
                onChange={(e) => {
                  const newPlanId = e.target.value || null;
                  selectPlan(newPlanId);
                  setSession(null);
                }}
                style={SELECT_STYLE}
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
                  <button
                    onClick={() => {
                      const prev = prevWeekDay(selectedPlan, selectedWeekId, selectedDayId);
                      setSelectedWeekId(prev.weekId);
                      setSelectedDayId(prev.dayId);
                      setSession(null);
                      setShouldAutoNavigate(false);
                    }}
                    style={SMALL_BTN_STYLE}
                  >Previous</button>
                  <button
                    onClick={() => {
                      const next = nextWeekDay(selectedPlan, selectedWeekId, selectedDayId);
                      setSelectedWeekId(next.weekId);
                      setSelectedDayId(next.dayId);
                      setSession(null);
                      setShouldAutoNavigate(false);
                    }}
                    style={SMALL_BTN_STYLE}
                  >Next</button>
                </>
              )}
            </div>

            {selectedPlan && (
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ color: 'var(--text-secondary)', fontWeight: 500, fontSize: 14 }}>Week:</label>
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
                  style={SELECT_STYLE}
                >
                  {selectedPlan.weeks.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>

                <label style={{ color: 'var(--text-secondary)', fontWeight: 500, fontSize: 14 }}>Day:</label>
                <select
                  value={selectedDayId ?? ''}
                  onChange={(e) => {
                    setSelectedDayId(e.target.value || null);
                    setSession(null);
                    setShouldAutoNavigate(false);
                  }}
                  style={SELECT_STYLE}
                >
                  {(selectedWeek ?? { days: [] as PlanDay[] }).days.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => setShowPlanSettings(true)}
                  style={SMALL_BTN_STYLE}
                  title="Plan Settings"
                >
                  Settings
                </button>
              </div>
            )}
          </div>

          {!selectedPlan ? (
            <p style={{ color: 'var(--text-muted)' }}>No plan selected.</p>
          ) : !selectedDay ? (
            <div style={{ color: 'var(--text-muted)' }}>Select a day.</div>
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
        </div>
      )}
      {showArchiveList && (
        <div style={{ ...MODAL_OVERLAY_STYLE, zIndex: 20 }}>
          <div style={{ ...MODAL_CONTENT_STYLE, maxWidth: 950, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>Archived Plans</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={closeArchive} style={BTN_STYLE}>Close</button>
              </div>
            </div>
            {archivedError && <div style={{ color: '#f88', padding: '8px 12px', background: 'rgba(255, 136, 136, 0.1)', borderRadius: 8 }}>{archivedError}</div>}
            {archivedLoading ? (
              <div style={{ color: 'var(--text-muted)', padding: 20, textAlign: 'center' }}>Loading archived plans...</div>
            ) : archivedPlans.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', padding: 20, textAlign: 'center' }}>No archived plans yet.</div>
            ) : (
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: '0 0 280px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {archivedPlans.map((plan) => (
                    <div
                      key={plan.id}
                      style={{
                        background: viewArchivedPlan?.id === plan.id ? 'var(--accent-muted)' : 'var(--bg-card)',
                        border: `1px solid ${viewArchivedPlan?.id === plan.id ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
                        borderRadius: 10,
                        padding: 12,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <button onClick={() => openArchivedPlan(plan)} style={{ ...BTN_STYLE, flex: 1, textAlign: 'left' }}>
                        {plan.name}
                      </button>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => handleDeleteArchivedPlan(plan)} style={SMALL_BTN_STYLE}>Delete</button>
                        <button onClick={() => exportPlanCSV(plan, buildCatalogByName(searchCatalogExercises))} style={SMALL_BTN_STYLE}>Export</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{
                  flex: 1,
                  minWidth: 320,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 12,
                  padding: 16,
                  maxHeight: '60vh',
                  overflowY: 'auto'
                }}>
                  {!viewArchivedPlan ? (
                    <div style={{ color: 'var(--text-muted)', padding: 20, textAlign: 'center' }}>Select an archived plan to view details.</div>
                  ) : viewArchivedLoading ? (
                    <div style={{ color: 'var(--text-muted)', padding: 20, textAlign: 'center' }}>Loading sessions...</div>
                  ) : (
                    <div>
                      <h3 style={{ marginTop: 0 }}>{viewArchivedPlan.name}</h3>
                      {viewArchivedPlan.weeks.map((week) => {
                        const sessionWeek = viewArchivedSessions[week.id] || {};
                        return (
                          <div key={week.id} style={{ marginBottom: 16 }}>
                            <h4 style={{ marginBottom: 8 }}>{week.name}</h4>
                            {week.days.map((day) => {
                              const session = sessionWeek[day.id] || null;
                              return (
                                <div key={day.id} style={{ marginBottom: 12 }}>
                                  <h5 style={{ margin: '6px 0' }}>{day.name}</h5>
                                  {day.items.length === 0 ? (
                                    <div style={{ color: '#777' }}>No exercises defined for this day.</div>
                                  ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                                          <div key={item.id} style={{
                                            background: 'var(--bg-elevated)',
                                            border: '1px solid var(--border-subtle)',
                                            borderRadius: 10,
                                            padding: 12
                                          }}>
                                            <div style={{ fontWeight: 600, fontSize: 14 }}>{item.exerciseName}</div>
                                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                                              Target: {item.targetSets} set{item.targetSets === 1 ? '' : 's'}
                                              {item.targetReps ? ` - ${item.targetReps}` : ''}
                                            </div>
                                            {rowCount === 0 ? (
                                              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No recorded sets.</div>
                                            ) : (
                                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                                <thead>
                                                  <tr style={{ textAlign: 'left' }}>
                                                    <th style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase' }}>Set</th>
                                                    <th style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase' }}>Weight</th>
                                                    <th style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase' }}>Reps</th>
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {Array.from({ length: rowCount }).map((_, idx) => {
                                                    const recorded = sets[idx];
                                                    return (
                                                      <tr key={idx} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                                        <td style={{ padding: '8px 0', color: 'var(--text-secondary)' }}>{idx + 1}</td>
                                                        <td style={{ padding: '8px 0', fontWeight: recorded?.weight != null ? 600 : 400 }}>{recorded?.weight ?? '-'}</td>
                                                        <td style={{ padding: '8px 0', fontWeight: recorded?.reps != null ? 600 : 400 }}>{recorded?.reps ?? '-'}</td>
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
          </div>
        </div>
      )}

      {/* Streak Settings Modal */}
      {showStreakSettings && (
        <div style={MODAL_OVERLAY_STYLE}>
          <div style={{ ...MODAL_CONTENT_STYLE, maxWidth: 420 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>Streak Settings</h3>
              <button onClick={() => setShowStreakSettings(false)} style={BTN_STYLE}>Close</button>
            </div>

            {/* Current streak display */}
            {streakConfig?.enabled && (
              <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 12,
                padding: 16,
                marginBottom: 20,
                textAlign: 'center'
              }}>
                <div style={{ fontSize: 48, marginBottom: 8 }}>🔥</div>
                <div style={{ fontSize: 32, fontWeight: 700 }}>{currentStreak}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                  {currentStreak === 1 ? 'day streak' : 'day streak'}
                </div>
                {streakState?.longestStreak != null && streakState.longestStreak > 0 && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 8 }}>
                    Longest: {streakState.longestStreak} days
                  </div>
                )}
              </div>
            )}

            {/* Enable/disable toggle */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 0',
              borderBottom: '1px solid var(--border-subtle)'
            }}>
              <span style={{ fontWeight: 500 }}>Enable Streak Tracking</span>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
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
                  style={{ width: 20, height: 20 }}
                />
              </label>
            </div>

            {/* Schedule mode selection */}
            {streakConfig?.enabled && (
              <>
                <div style={{ marginTop: 20 }}>
                  <div style={{ fontWeight: 500, marginBottom: 12 }}>Schedule Mode</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['daily', 'rolling', 'weekly'] as StreakScheduleMode[]).map((mode) => (
                      <button
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
                          ...BTN_STYLE,
                          flex: 1,
                          background: streakConfig.scheduleMode === mode ? 'var(--accent-muted)' : 'var(--bg-card)',
                          borderColor: streakConfig.scheduleMode === mode ? 'var(--border-strong)' : 'var(--border-default)',
                          textTransform: 'capitalize'
                        }}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Rolling mode settings */}
                {streakConfig.scheduleMode === 'rolling' && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Days On</label>
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
                          style={{ width: '100%', padding: '10px 12px' }}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Days Off</label>
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
                          style={{ width: '100%', padding: '10px 12px' }}
                        />
                      </div>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                      Example: {streakConfig.rollingDaysOn ?? 3} days on, {streakConfig.rollingDaysOff ?? 1} day{(streakConfig.rollingDaysOff ?? 1) !== 1 ? 's' : ''} off
                    </div>
                  </div>
                )}

                {/* Weekly mode settings */}
                {streakConfig.scheduleMode === 'weekly' && (
                  <div style={{ marginTop: 16 }}>
                    <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>Workout Days</label>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dayName, idx) => {
                        const selected = streakConfig.weeklyDays?.includes(idx) ?? false;
                        return (
                          <button
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
                            style={{
                              ...SMALL_BTN_STYLE,
                              minWidth: 44,
                              background: selected ? 'var(--accent-muted)' : 'var(--bg-card)',
                              borderColor: selected ? 'var(--border-strong)' : 'var(--border-default)',
                            }}
                          >
                            {dayName}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Reset streak button */}
                <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
                  <button
                    onClick={() => {
                      if (confirm('Reset your streak to 0? This cannot be undone.')) {
                        const resetState = { currentStreak: 0, longestStreak: streakState?.longestStreak ?? 0, lastWorkoutDate: null };
                        setStreakState(resetState);
                        setCurrentStreak(0);
                        setStreakHitToday(false);
                        upsertUserPrefs({ streak_state: resetState });
                      }
                    }}
                    style={{ ...SMALL_BTN_STYLE, color: '#f88' }}
                  >
                    Reset Streak
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Plan Settings Modal */}
      {showPlanSettings && selectedPlan && (
        <div style={MODAL_OVERLAY_STYLE}>
          <div style={{ ...MODAL_CONTENT_STYLE, maxWidth: 360 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>Plan Settings</h3>
              <button onClick={() => setShowPlanSettings(false)} style={BTN_STYLE}>Close</button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 500, color: 'var(--text-secondary)', fontSize: 14 }}>
                Plan Type
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => handleGhostModeChange('default')}
                  style={{
                    ...BTN_STYLE,
                    flex: 1,
                    background: (selectedPlan.ghostMode ?? 'default') === 'default' ? 'var(--accent-muted)' : 'var(--bg-card)',
                    borderColor: (selectedPlan.ghostMode ?? 'default') === 'default' ? 'var(--border-strong)' : 'var(--border-default)',
                  }}
                >
                  Default
                </button>
                <button
                  onClick={() => handleGhostModeChange('full-body')}
                  style={{
                    ...BTN_STYLE,
                    flex: 1,
                    background: selectedPlan.ghostMode === 'full-body' ? 'var(--accent-muted)' : 'var(--bg-card)',
                    borderColor: selectedPlan.ghostMode === 'full-body' ? 'var(--border-strong)' : 'var(--border-default)',
                  }}
                >
                  Full Body
                </button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.4 }}>
                {(selectedPlan.ghostMode ?? 'default') === 'default'
                  ? 'Ghost shows your most recent performance regardless of day.'
                  : 'Ghost only shows performance from the same day (e.g., Tuesday vs Tuesday).'}
              </p>
            </div>

            <button
              onClick={async () => {
                if (!selectedPlan.serverId) return;
                const payload = { weeks: selectedPlan.weeks, ghostMode: selectedPlan.ghostMode };
                await planApi.update(selectedPlan.serverId, selectedPlan.name, payload);
                setShowPlanSettings(false);
                window.location.reload();
              }}
              style={{ ...BTN_STYLE, width: '100%', background: 'var(--accent-muted)', borderColor: 'var(--border-strong)' }}
            >
              Save & Apply
            </button>
          </div>
        </div>
      )}

      {/* Streak Reconfigure Prompt (after Finish & Archive) */}
      {showStreakReconfigPrompt && (
        <div style={MODAL_OVERLAY_STYLE}>
          <div style={{ ...MODAL_CONTENT_STYLE, maxWidth: 360, textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 20 }}>Plan Complete!</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
              Great work finishing your plan. Would you like to update your streak schedule?
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                onClick={() => setShowStreakReconfigPrompt(false)}
                style={BTN_STYLE}
              >
                Keep Current
              </button>
              <button
                onClick={() => {
                  setShowStreakReconfigPrompt(false);
                  setShowStreakSettings(true);
                }}
                style={{ ...BTN_STYLE, background: 'var(--accent-muted)', borderColor: 'var(--border-strong)' }}
              >
                Update Schedule
              </button>
            </div>
          </div>
        </div>
      )}
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
  const [prevNotes, setPrevNotes] = useState<Record<string, string | null>>({});
  const [openNotes, setOpenNotes] = useState<Record<string, boolean>>({});
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
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
      setPrevNotes({});
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
        const ordered: Array<{ weekId: string; dayId: string; dayIndex: number }> = [];
        for (const w of plan.weeks) {
          for (let di = 0; di < w.days.length; di++) {
            ordered.push({ weekId: w.id, dayId: w.days[di].id, dayIndex: di });
          }
        }
        const currentIdx = ordered.findIndex((d) => d.dayId === day.id && d.weekId === currentWeekId);
        if (currentIdx <= 0) {
          setPrevNotes({});
          return;
        }

        const targets = day.items.map((item) => ({
          exerciseId: item.exerciseId,
          exerciseName: item.exerciseName,
        }));
        if (targets.length === 0) {
          setGhost({});
          setPrevNotes({});
          return;
        }

        const ghostMap: Record<string, { weight: number | null; reps: number | null }[]> = {};
        const notesMap: Record<string, string | null> = {};
        const remaining = new Set(targets.map((t) => exerciseKey(t)));

        for (let idx = currentIdx - 1; idx >= 0; idx--) {
          if (remaining.size === 0) break;
          const prev = ordered[idx];
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

              const noteVal = (entry as any).note ?? null;
              notesMap[targetKey] = noteVal;
              if (nameKey && !notesMap[nameKey]) notesMap[nameKey] = noteVal;

              remaining.delete(targetKey);
            }
          }
        }

        if (!cancelled) {
          if (Object.keys(ghostMap).length > 0) setGhost(ghostMap);
          else setGhost({});

          // Load historical ghost data for sets that might not have regular ghost
          void loadHistoricalGhost(targets);

          try {
            const seedKey = `noteSeed:${plan.serverId ?? plan.id}:${day.id}`;
            const raw = localStorage.getItem(seedKey);
            if (raw) {
              const seed = JSON.parse(raw) as Record<string, string>;
              for (const [ex, note] of Object.entries(seed)) {
                const nameKey = `name:${normalizeExerciseName(ex).toLowerCase()}`;
                if (!notesMap[nameKey] || String(notesMap[nameKey]).trim() === '') {
                  notesMap[nameKey] = note;
                }
              }
            }
          } catch { /* ignore */ }
          setPrevNotes(notesMap);
        }
      } catch {
        if (!cancelled) {
          setGhost({});
          setPrevNotes({});
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [plan.serverId, currentWeekId, plan.weeks, day.id, plan.id]);

  // Seed notes from previous week where notes are missing
  useEffect(() => {
    if (!session || session.planDayId !== day.id) return;
    if (!prevNotes) return;
    const nextEntries = session.entries.map((e) => {
      const hasNote = !!(e.note && String(e.note).trim() !== "");
      const key = exerciseKey(e);
      const suggested = prevNotes[key] ?? prevNotes[`name:${normalizeExerciseName(e.exerciseName).toLowerCase()}`];
      if (hasNote || !suggested || String(suggested).trim() === "") return e;
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
  }, [prevNotes, session, day.id]);

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
    const next: Session = {
      ...s,
      entries: s.entries.map((e) =>
        e.id === entryId ? { ...e, note: noteText.trim() === '' ? null : noteText } : e
      ),
    };
    try {
      if (entry) {
        const seedKey = `noteSeed:${plan.serverId ?? plan.id}:${day.id}`;
        let seed: Record<string, string> = {};
        try {
          const raw = localStorage.getItem(seedKey);
          if (raw) seed = JSON.parse(raw) || {};
        } catch { /* ignore */ }
        const name = entry.exerciseName || '';
        const trimmed = noteText.trim();
        if (trimmed) seed[name] = trimmed; else delete seed[name];
        try { localStorage.setItem(seedKey, JSON.stringify(seed)); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    saveNow(next);
    return next;
  });
};const updateSet = (entryId: string, setId: string, patch: Partial<SessionSet>) => {
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
      {session.entries.map((entry, entryIndex) => (
        <div key={entry.id} style={{
          background: 'var(--bg-elevated)',
          border: editingEntryId === entry.id ? '1px solid var(--accent)' : '1px solid var(--border-default)',
          borderRadius: 14,
          padding: 16,
          marginBottom: 14,
          boxShadow: 'var(--shadow-card)',
          transition: 'all 0.15s ease',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                {entry.exerciseName}
                {entry.myoRepMatch && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: '#a78bfa', fontWeight: 500 }}>MYO</span>
                )}
              </h3>
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setOpenExerciseMenu(openExerciseMenu === entry.id ? null : entry.id)}
                  style={{
                    ...SMALL_BTN_STYLE,
                    padding: '4px 8px',
                    minWidth: 32,
                  }}
                  title="Options"
                >
                  ⋮
                </button>
                {openExerciseMenu === entry.id && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 10,
                    padding: 8,
                    marginTop: 4,
                    minWidth: 160,
                    zIndex: 20,
                    boxShadow: 'var(--shadow-lg)',
                  }}>
                    <button
                      onClick={() => {
                        setOpenExerciseMenu(null);
                        setEditingEntryId(entry.id);
                        setEditDraftSets(entry.sets.map(s => ({ ...s })));
                      }}
                      style={{ ...SMALL_BTN_STYLE, width: '100%', textAlign: 'left', marginBottom: 4 }}
                    >
                      Edit Sets
                    </button>
                    <button
                      onClick={() => { setOpenExerciseMenu(null); openReplaceSearch(entry, entryIndex); }}
                      style={{ ...SMALL_BTN_STYLE, width: '100%', textAlign: 'left', marginBottom: 4 }}
                    >
                      Replace
                    </button>
                    <button
                      onClick={() => { setOpenExerciseMenu(null); openHistory({ exerciseId: entry.exerciseId, exerciseName: entry.exerciseName }); }}
                      style={{ ...SMALL_BTN_STYLE, width: '100%', textAlign: 'left', marginBottom: 4 }}
                    >
                      History
                    </button>
                    <button
                      onClick={() => openMyoScopeModal(entry.id)}
                      style={{
                        ...SMALL_BTN_STYLE,
                        width: '100%',
                        textAlign: 'left',
                        background: entry.myoRepMatch ? 'rgba(167, 139, 250, 0.15)' : 'var(--bg-card)',
                        borderColor: entry.myoRepMatch ? '#a78bfa' : 'var(--border-subtle)',
                        color: entry.myoRepMatch ? '#a78bfa' : 'var(--text-primary)',
                      }}
                    >
                      Myo-Rep Match {entry.myoRepMatch ? '✓' : ''}
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div>
              <button
                onClick={() => {
                  setOpenNotes((prev) => ({ ...prev, [entry.id]: true }));
                  setNotesDraft((prev) => ({ ...prev, [entry.id]: entry.note ?? '' }));
                }}
                style={{
                  ...SMALL_BTN_STYLE,
                  borderColor: entry.note && String(entry.note).trim() !== '' ? 'var(--success)' : 'var(--border-subtle)',
                  background: entry.note && String(entry.note).trim() !== '' ? 'var(--success-muted)' : 'var(--bg-elevated)',
                }}
                title="Notes"
              >
                Notes
              </button>
            </div>
          </div>

          {openNotes[entry.id] ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <textarea
                value={notesDraft[entry.id] ?? ''}
                onChange={(e) => setNotesDraft((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                style={{
                  ...INPUT_STYLE,
                  minHeight: 120,
                  resize: 'vertical',
                  width: '100%',
                }}
                placeholder="Add notes for this exercise"
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  onClick={() => setOpenNotes((prev) => ({ ...prev, [entry.id]: false }))}
                  style={SMALL_BTN_STYLE}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    updateEntryNote(entry.id, notesDraft[entry.id] ?? '');
                    setOpenNotes((prev) => ({ ...prev, [entry.id]: false }));
                  }}
                  style={PRIMARY_BTN_STYLE}
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            editingEntryId === entry.id ? (
              <>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '50px 1fr 1fr 36px',
                  gap: 10,
                  marginBottom: 10,
                  padding: '0 4px',
                  color: 'var(--text-muted)',
                  fontSize: 12,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  textAlign: 'center',
                }}>
                  <div>Set</div>
                  <div>Weight</div>
                  <div>Reps</div>
                  <div></div>
                </div>

                {editDraftSets.map((set, i) => (
                  <div key={set.id} style={{
                    display: 'grid',
                    gridTemplateColumns: '50px 1fr 1fr 36px',
                    gap: 10,
                    marginBottom: 10,
                    padding: '4px',
                    borderRadius: 10,
                    background: (set.weight != null || set.reps != null) ? 'var(--accent-subtle)' : 'transparent',
                  }}>
                    <div style={{
                      alignSelf: 'center',
                      textAlign: 'center',
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                      fontSize: 14,
                    }}>{i + 1}</div>
                    <div style={{
                      alignSelf: 'center',
                      textAlign: 'center',
                      fontSize: 14,
                      color: set.weight != null ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}>{set.weight ?? '—'}</div>
                    <div style={{
                      alignSelf: 'center',
                      textAlign: 'center',
                      fontSize: 14,
                      color: set.reps != null ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}>{set.reps ?? '—'}</div>
                    <button
                      onClick={() => removeDraftSet(set.id)}
                      style={{
                        ...SMALL_BTN_STYLE,
                        padding: '2px 6px',
                        minWidth: 0,
                        color: '#ef4444',
                        borderColor: '#ef4444',
                        fontSize: 14,
                      }}
                      title="Remove set"
                    >
                      ✕
                    </button>
                  </div>
                ))}

                <button
                  onClick={addDraftSet}
                  style={{ ...SMALL_BTN_STYLE, width: '100%', marginBottom: 12 }}
                >
                  + Add Set
                </button>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={cancelEdit} style={SMALL_BTN_STYLE}>Cancel</button>
                  <button onClick={saveEditSets} style={PRIMARY_BTN_STYLE}>Save</button>
                </div>
              </>
            ) : (
              <>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '50px 1fr 1fr',
                  gap: 10,
                  marginBottom: 10,
                  padding: '0 4px',
                  color: 'var(--text-muted)',
                  fontSize: 12,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  textAlign: 'center',
                }}>
                  <div>Set</div>
                  <div>Weight</div>
                  <div style={{ color: entry.myoRepMatch ? '#a78bfa' : 'var(--text-muted)' }}>
                    {entry.myoRepMatch ? 'Match' : 'Reps'}
                  </div>
                </div>

                {entry.sets.map((set, i) => {
                  const ghostSet = getGhost(entry.exerciseId, entry.exerciseName, i);
                  const hasValue = set.weight != null || set.reps != null;
                  return (
                    <div key={set.id} style={{
                      display: 'grid',
                      gridTemplateColumns: '50px 1fr 1fr',
                      gap: 10,
                      marginBottom: 10,
                      padding: '4px',
                      borderRadius: 10,
                      background: hasValue ? 'var(--accent-subtle)' : 'transparent',
                      transition: 'background 0.15s ease',
                    }}>
                      <div style={{
                        alignSelf: 'center',
                        textAlign: 'center',
                        fontWeight: 600,
                        color: 'var(--text-secondary)',
                        fontSize: 14,
                      }}>{i + 1}</div>
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
                        style={{
                          ...INPUT_STYLE,
                          width: '100%',
                          minWidth: 0,
                          textAlign: 'center',
                          fontWeight: set.weight != null ? 600 : 400,
                        }}
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
                        style={{
                          ...INPUT_STYLE,
                          width: '100%',
                          minWidth: 0,
                          textAlign: 'center',
                          fontWeight: set.reps != null ? 600 : 400,
                        }}
                      />
                    </div>
                  );
                })}

                {entry.sets.length === 0 && <div style={{ color: 'var(--text-muted)' }}>No sets yet.</div>}
              </>
            )
          )}
        </div>
      ))}

      <div
        style={{
          marginTop: 20,
          paddingTop: 16,
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'pointer',
          padding: '8px 12px',
          borderRadius: 10,
          background: completed ? 'var(--success-muted)' : 'transparent',
          border: `1px solid ${completed ? 'var(--success)' : 'var(--border-subtle)'}`,
          transition: 'all 0.15s ease',
        }}>
          <input
            type="checkbox"
            checked={completed}
            onChange={(e) => {
              const value = e.target.checked;
              markSessionCompleted(value);
              setCompleted(value);
            }}
          />
          <span style={{ fontWeight: 500, color: completed ? 'var(--success)' : 'var(--text-secondary)' }}>
            Completed
          </span>
        </label>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {isLastDay && onFinishPlan && (
            <button onClick={onFinishPlan} style={PRIMARY_BTN_STYLE} disabled={finishingPlan}>
              {finishingPlan ? 'Finishing...' : 'Finish & Archive'}
            </button>
          )}

          {!isLastDay && (
            <button onClick={handleDone} style={PRIMARY_BTN_STYLE}>
              Done (Next Day)
            </button>
          )}
        </div>
      </div>

      {replaceSearchOpen && (
        <div style={MODAL_OVERLAY_STYLE}>
          <div style={{ ...MODAL_CONTENT_STYLE, maxWidth: 980, width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>
                Replace Exercise{replaceTargetEntry ? ` - ${replaceTargetEntry.exerciseName}` : ''}
              </h3>
              <button onClick={closeReplaceSearch} style={BTN_STYLE}>Cancel</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <input
                value={replaceSearchText}
                onChange={(e) => setReplaceSearchText(e.target.value)}
                placeholder="Search name..."
                style={INPUT_STYLE}
              />
              <select value={replaceSearchPrimary} onChange={(e) => setReplaceSearchPrimary(e.target.value)} style={SELECT_STYLE}>
                <option value="All">Primary Muscle (All)</option>
                {replacePrimaryMuscles.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select value={replaceSearchSecondary} onChange={(e) => setReplaceSearchSecondary(e.target.value)} style={SELECT_STYLE}>
                <option value="All">Secondary Muscle (All)</option>
                {replaceSecondaryMuscles.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select value={replaceSearchSource} onChange={(e) => setReplaceSearchSource(e.target.value as SearchSource)} style={SELECT_STYLE}>
                <option value="all">Source (All)</option>
                <option value="defaults">Defaults</option>
                <option value="home_made">Home Made *</option>
              </select>
              <button
                type="button"
                onClick={() => setReplaceSearchMachine((prev) => !prev)}
                style={{
                  ...FILTER_TOGGLE_STYLE,
                  background: replaceSearchMachine ? 'var(--accent-muted)' : 'var(--bg-elevated)',
                  borderColor: replaceSearchMachine ? 'var(--border-strong)' : 'var(--border-subtle)',
                }}
                aria-pressed={replaceSearchMachine}
              >
                <span style={{ width: 10, height: 10, borderRadius: "50%", border: "1px solid var(--border-strong)", background: replaceSearchMachine ? "var(--text-primary)" : "transparent", transition: 'all 0.15s ease' }} />
                Machine
              </button>
              <button
                type="button"
                onClick={() => setReplaceSearchFreeWeight((prev) => !prev)}
                style={{
                  ...FILTER_TOGGLE_STYLE,
                  background: replaceSearchFreeWeight ? 'var(--accent-muted)' : 'var(--bg-elevated)',
                  borderColor: replaceSearchFreeWeight ? 'var(--border-strong)' : 'var(--border-subtle)',
                }}
                aria-pressed={replaceSearchFreeWeight}
              >
                <span style={{ width: 10, height: 10, borderRadius: "50%", border: "1px solid var(--border-strong)", background: replaceSearchFreeWeight ? "var(--text-primary)" : "transparent", transition: 'all 0.15s ease' }} />
                Free weight
              </button>
              <button
                type="button"
                onClick={() => setReplaceSearchCable((prev) => !prev)}
                style={{
                  ...FILTER_TOGGLE_STYLE,
                  background: replaceSearchCable ? 'var(--accent-muted)' : 'var(--bg-elevated)',
                  borderColor: replaceSearchCable ? 'var(--border-strong)' : 'var(--border-subtle)',
                }}
                aria-pressed={replaceSearchCable}
              >
                <span style={{ width: 10, height: 10, borderRadius: "50%", border: "1px solid var(--border-strong)", background: replaceSearchCable ? "var(--text-primary)" : "transparent", transition: 'all 0.15s ease' }} />
                Cable
              </button>
              <button
                type="button"
                onClick={() => setReplaceSearchBodyWeight((prev) => !prev)}
                style={{
                  ...FILTER_TOGGLE_STYLE,
                  background: replaceSearchBodyWeight ? 'var(--accent-muted)' : 'var(--bg-elevated)',
                  borderColor: replaceSearchBodyWeight ? 'var(--border-strong)' : 'var(--border-subtle)',
                }}
                aria-pressed={replaceSearchBodyWeight}
              >
                <span style={{ width: 10, height: 10, borderRadius: "50%", border: "1px solid var(--border-strong)", background: replaceSearchBodyWeight ? "var(--text-primary)" : "transparent", transition: 'all 0.15s ease' }} />
                Bodyweight
              </button>
              <button
                type="button"
                onClick={() => setReplaceSearchCompound((prev) => !prev)}
                style={{
                  ...FILTER_TOGGLE_STYLE,
                  background: replaceSearchCompound ? 'var(--accent-muted)' : 'var(--bg-elevated)',
                  borderColor: replaceSearchCompound ? 'var(--border-strong)' : 'var(--border-subtle)',
                }}
                aria-pressed={replaceSearchCompound}
              >
                <span style={{ width: 10, height: 10, borderRadius: "50%", border: "1px solid var(--border-strong)", background: replaceSearchCompound ? "var(--text-primary)" : "transparent", transition: 'all 0.15s ease' }} />
                Compound
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ border: '1px solid #333', borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontWeight: 600 }}>Results</div>
                  <div style={{ color: '#777', fontSize: 12 }}>{replaceFilteredCatalog.length} found</div>
                </div>
                  <button
                    onClick={() => {
                      setReplaceAddMovementOpen((prev) => !prev);
                      setReplaceAddMovementError(null);
                    }}
                    style={{ ...SMALL_BTN_STYLE, fontSize: 12, padding: '4px 8px' }}
                  >
                    Can't find it? Create one!
                  </button>
                </div>
                {replaceAddMovementOpen && (
                  <div style={{ border: '1px solid #222', borderRadius: 8, padding: 8, marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input
                      value={replaceAddMovementName}
                      onChange={(e) => setReplaceAddMovementName(e.target.value)}
                      placeholder="Movement name"
                      style={{ padding: 8, borderRadius: 8, border: '1px solid #444' }}
                    />
                    <select
                      value={replaceAddMovementPrimary}
                      onChange={(e) => setReplaceAddMovementPrimary(e.target.value)}
                      style={{ padding: 8, borderRadius: 8, border: '1px solid #444' }}
                    >
                      <option value="">Primary muscle</option>
                      {replacePrimaryMuscles.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="radio"
                          name="replace-add-movement-equipment"
                          checked={replaceAddMovementEquipment === 'machine'}
                          onChange={() => setReplaceAddMovementEquipment('machine')}
                        />
                        Machine
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="radio"
                          name="replace-add-movement-equipment"
                          checked={replaceAddMovementEquipment === 'free_weight'}
                          onChange={() => setReplaceAddMovementEquipment('free_weight')}
                        />
                        Free weight
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="radio"
                          name="replace-add-movement-equipment"
                          checked={replaceAddMovementEquipment === 'cable'}
                          onChange={() => setReplaceAddMovementEquipment('cable')}
                        />
                        Cable
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="radio"
                          name="replace-add-movement-equipment"
                          checked={replaceAddMovementEquipment === 'body_weight'}
                          onChange={() => setReplaceAddMovementEquipment('body_weight')}
                        />
                        Bodyweight
                      </label>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                        style={{ padding: 8, borderRadius: 8, border: '1px solid #444' }}
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
                      <div style={{ color: '#f88', fontSize: 12 }}>{replaceAddMovementError}</div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <button
                        onClick={() => {
                          resetReplaceAddMovement();
                          setReplaceAddMovementOpen(false);
                        }}
                        style={BTN_STYLE}
                      >
                        Cancel
                      </button>
                      <button onClick={handleReplaceAddMovement} style={PRIMARY_BTN_STYLE}>
                        Add
                      </button>
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '40vh', overflowY: 'auto' }}>
                  {replaceFilteredCatalog.length === 0 ? (
                    <div style={{ color: '#777' }}>No matches.</div>
                  ) : (
                    replaceFilteredCatalog.map((ex) => (
                      <div key={`${ex.isCustom ? 'custom' : 'catalog'}:${ex.id}`} style={{ border: '1px solid #222', borderRadius: 8, padding: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{ex.name}{ex.isCustom ? ' *' : ''}</div>
                          <div style={{ color: '#777', fontSize: 11 }}>
                            {ex.primaryMuscle}{ex.secondaryMuscles.length ? ` / ${ex.secondaryMuscles.join(', ')}` : ''}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <button onClick={() => addReplaceQueue(ex)} style={{ ...SMALL_BTN_STYLE, fontSize: 12, padding: '3px 8px' }}>Add</button>
                          {ex.isCustom && (
                            <button onClick={() => handleDeleteCustomFromReplace(ex)} style={{ ...SMALL_BTN_STYLE, fontSize: 12, padding: '3px 8px' }}>Del</button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div style={{ border: '1px solid #333', borderRadius: 10, padding: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Queue:</div>
                  {replaceQueue.length === 0 ? (
                    <div style={{ color: '#777', fontSize: 12 }}>None selected</div>
                  ) : (
                    replaceQueue.map((q) => (
                      <div key={q.name} style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        background: 'var(--accent-subtle)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 6,
                        padding: '2px 6px',
                        fontSize: 12,
                      }}>
                        <span>{q.name}</span>
                        <button
                          onClick={() => removeReplaceQueue(q.name)}
                          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 2px', fontSize: 13, lineHeight: 1 }}
                        >✕</button>
                      </div>
                    ))
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                  <button onClick={closeReplaceSearch} style={{ ...BTN_STYLE, fontSize: 12, padding: '5px 10px' }}>Cancel</button>
                  <button onClick={() => applyReplaceQueue("today")} style={{ ...PRIMARY_BTN_STYLE, fontSize: 12, padding: '5px 10px' }} disabled={replaceQueue.length === 0}>
                    Today Only
                  </button>
                  <button onClick={() => applyReplaceQueue("remaining")} style={{ ...PRIMARY_BTN_STYLE, fontSize: 12, padding: '5px 10px' }} disabled={replaceQueue.length === 0}>
                    Rest of Meso
                  </button>
                </div>
              </div>
            </div>
            <div style={{ color: '#777', fontSize: 12, textAlign: 'left' }}>
              * = self made movement
            </div>
          </div>
        </div>
      )}

      {myoScopeEntry && (
        <div style={MODAL_OVERLAY_STYLE}>
          <div style={{ ...MODAL_CONTENT_STYLE, maxWidth: 320, textAlign: 'center' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>Myo-Rep Match</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 20 }}>
              {myoScopeEntry.currentValue ? 'Turn off' : 'Turn on'} Myo-Rep Match for <strong>{myoScopeEntry.exerciseName}</strong>?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                onClick={applyMyoToday}
                style={{ ...BTN_STYLE, width: '100%' }}
              >
                Just Today
              </button>
              <button
                onClick={applyMyoRestOfPlan}
                style={{
                  ...BTN_STYLE,
                  width: '100%',
                  background: 'rgba(167, 139, 250, 0.15)',
                  borderColor: '#a78bfa',
                  color: '#a78bfa',
                }}
              >
                {plan.ghostMode === 'full-body' ? 'All ' + day.name + ' Days' : 'Entire Plan'}
              </button>
              <button
                onClick={() => setMyoScopeEntry(null)}
                style={{ ...BTN_STYLE, width: '100%', marginTop: 8 }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {historyOpen && (
        <div style={MODAL_OVERLAY_STYLE}>
          <div style={{ ...MODAL_CONTENT_STYLE, maxWidth: 520, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>History{historyEntry ? ` - ${historyEntry.exerciseName}` : ''}</h3>
              <button
                onClick={() => {
                  setHistoryOpen(false);
                  setHistoryError(null);
                }}
                style={BTN_STYLE}
              >
                Close
              </button>
            </div>

            {historyLoading ? (
              <div style={{ color: 'var(--text-muted)', padding: 20, textAlign: 'center' }}>Loading history...</div>
            ) : historyError ? (
              <div style={{ color: '#f88', padding: '10px 12px', background: 'rgba(255, 136, 136, 0.1)', borderRadius: 8 }}>{historyError}</div>
            ) : !historyPr && historyItems.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', padding: 20, textAlign: 'center' }}>No recorded sets yet.</div>
            ) : (
              <>
                {historyPr && (
                  <div style={{
                    border: '1px solid var(--success)',
                    borderRadius: 12,
                    padding: 16,
                    background: 'var(--success-muted)',
                    boxShadow: '0 0 20px rgba(74, 222, 128, 0.1)'
                  }}>
                    <div style={{
                      fontWeight: 600,
                      color: 'var(--success)',
                      fontSize: 12,
                      marginBottom: 8,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}>Personal Best</div>
                    <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>
                      {historyPr.weight} <span style={{ color: 'var(--text-muted)', fontSize: 16, fontWeight: 400 }}>×</span> {historyPr.reps}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 6 }}>{formatHistoryDate(historyPr.date)}</div>
                  </div>
                )}

                {historyItems.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    <div style={{
                      fontWeight: 600,
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      marginBottom: 10,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}>Progression</div>
                    {historyItems.map((item, idx) => (
                      <div key={`${item.date}-${item.weight}-${item.reps}-${idx}`} style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        padding: '12px 0',
                        borderBottom: idx < historyItems.length - 1 ? '1px solid var(--border-subtle)' : 'none'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--border-strong)' }} />
                          <span style={{ fontWeight: 600, fontSize: 15 }}>{item.weight}</span>
                          <span style={{ color: 'var(--text-muted)' }}>×</span>
                          <span style={{ fontWeight: 600, fontSize: 15 }}>{item.reps}</span>
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{formatHistoryDate(item.date)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
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
        console.error('Failed to delete plan', err);
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
              for (let r = 1; r < rows.length; r++) {
                const row = rows[r];
                if (!row || row.length === 0) continue;
                const wName = row[idx.weekName] || '';
                const dName = row[idx.dayName] || '';
                const exName = row[idx.exerciseName] || '';
                const note = (row[idx.note] || '').trim();
                if (!exName || !note) continue;
                const week = plan.weeks.find((w) => (w.name || '') === wName) || null;
                const dayIdx = week ? week.days.findIndex((d) => (d.name || '') === dName) : -1;
                if (dayIdx < 0) continue;
                const seedKey = `noteSeed:${plan.serverId ?? plan.id}:${dayIdx}`;
                let seed: Record<string, string> = {};
                try { const raw = localStorage.getItem(seedKey); if (raw) seed = JSON.parse(raw) || {}; } catch { /* ignore */ }
                seed[exName] = note;
                try { localStorage.setItem(seedKey, JSON.stringify(seed)); } catch { /* ignore */ }
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

  

  return (
    <div style={CARD_STYLE}>
      <datalist id="exercise-options">
        {catalogExercises.map((exercise) => (
          <option key={exercise.id} value={exercise.name} />
        ))}
      </datalist>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => setShowPlanList(true)} style={BTN_STYLE}>
            Manage Plans & Templates</button>
          <button onClick={handleCreatePlan} style={BTN_STYLE}>
            + Plan
          </button>
          {(exerciseLoading || catalogLoading) && (
            <div style={{ color: 'var(--text-muted)', alignSelf: 'center', fontSize: 12 }}>Loading exercises...</div>
          )}
          {selectedPlan && (
            <>
              <button onClick={handleAddWeek} style={BTN_STYLE}>
                + Week
              </button>
              {selectedPlan.weeks.length > 1 && (
                <button onClick={handleCopyWeekOneToAll} style={BTN_STYLE}>
                  Copy Week 1 to All
                </button>
              )}
              <button onClick={handleSavePlan} style={PRIMARY_BTN_STYLE} disabled={saving}>
                {saving ? 'Saving...' : 'Save Plan'}
              </button>
              <button onClick={handleSaveAsTemplate} style={BTN_STYLE} disabled={saving}>
                Save as Template
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div style={{ color: '#f88', marginTop: 8, padding: '10px 12px', background: 'rgba(255, 136, 136, 0.1)', borderRadius: 8 }}>{error}</div>}

      {!selectedPlan ? (
        <div style={{ marginTop: 16, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>Create a plan to get started.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 14, color: 'var(--text-secondary)' }}>Plan Name</label>
            <input
              value={selectedPlan.name}
              onChange={(e) => handlePlanNameChange(e.target.value)}
              style={{ ...INPUT_STYLE, width: '100%' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 14, color: 'var(--text-secondary)' }}>Plan Type</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => updatePlan(selectedPlan.id, (p) => ({ ...p, ghostMode: 'default' }))}
                style={{
                  ...BTN_STYLE,
                  flex: 1,
                  background: (selectedPlan.ghostMode ?? 'default') === 'default' ? 'var(--accent-muted)' : 'var(--bg-card)',
                  borderColor: (selectedPlan.ghostMode ?? 'default') === 'default' ? 'var(--border-strong)' : 'var(--border-default)',
                }}
              >
                Default
              </button>
              <button
                onClick={() => updatePlan(selectedPlan.id, (p) => ({ ...p, ghostMode: 'full-body' }))}
                style={{
                  ...BTN_STYLE,
                  flex: 1,
                  background: selectedPlan.ghostMode === 'full-body' ? 'var(--accent-muted)' : 'var(--bg-card)',
                  borderColor: selectedPlan.ghostMode === 'full-body' ? 'var(--border-strong)' : 'var(--border-default)',
                }}
              >
                Full Body
              </button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.4 }}>
              {(selectedPlan.ghostMode ?? 'default') === 'default'
                ? 'Ghost shows your most recent performance regardless of day.'
                : 'Ghost only shows performance from the same day (e.g., Tuesday vs Tuesday).'}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {selectedPlan.weeks.map((week) => (
              <div key={week.id} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      value={week.name}
                      onChange={(e) => handleWeekNameChange(week.id, e.target.value)}
                      style={{ ...INPUT_STYLE, minWidth: 140, fontWeight: 600 }}
                    />
                    <button onClick={() => handleAddDay(week.id)} style={SMALL_BTN_STYLE}>
                      + Day
                    </button>
                  </div>
                  <button onClick={() => handleRemoveWeek(week.id)} style={SMALL_BTN_STYLE} disabled={selectedPlan.weeks.length <= 1}>
                    Delete Week
                  </button>
                </div>

                {week.days.some((d) => d.items.length > 0) && (
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    marginBottom: 12,
                    padding: '8px 12px',
                    background: 'var(--bg-card)',
                    borderRadius: 10,
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                  }}>
                    <span style={{ fontWeight: 600, marginRight: 4 }}>Week Total:</span>
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
                  style={{ display: 'flex', flexDirection: 'column', gap: 12, touchAction: draggingDayId && dayDragActive ? 'none' as any : 'auto' }}
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
                    borderRadius: 10,
                    padding: 12,
                    transition: 'all 0.15s ease',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
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
                          style={{
                            textAlign: 'center',
                            fontSize: 18,
                            lineHeight: '18px',
                            padding: '6px 10px',
                            userSelect: 'none',
                            touchAction: 'none',
                            cursor: 'grab',
                            background: 'var(--bg-elevated)',
                            borderRadius: 8,
                            color: 'var(--text-muted)',
                          }}
                          aria-label="Drag day handle"
                          title="Drag to reorder day"
                        >
                          ≡
                        </div>
                        <input
                          value={day.name}
                          onChange={(e) => handleDayNameChange(week.id, day.id, e.target.value)}
                          style={{ ...INPUT_STYLE, minWidth: 120 }}
                        />
                        <button onClick={() => handleAddExercise(week.id, day.id)} style={SMALL_BTN_STYLE}>
                          + Exercise
                        </button>
                        <button onClick={() => handleDuplicateDay(week.id, day.id)} style={SMALL_BTN_STYLE}>
                          Duplicate Day
                        </button>
                      </div>
                      <button onClick={() => handleRemoveDay(week.id, day.id)} style={SMALL_BTN_STYLE} disabled={week.days.length <= 1}>
                        Delete Day
                      </button>
                    </div>

                    {day.items.length > 0 && (
                      <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        marginBottom: 12,
                        padding: '8px 12px',
                        background: 'var(--bg-elevated)',
                        borderRadius: 10,
                        fontSize: 13,
                        color: 'var(--text-secondary)',
                      }}>
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
                      <div style={{ color: '#777', fontSize: 13 }}>No exercises yet.</div>
                    ) : (
                      <div
                        style={{ display: 'flex', flexDirection: 'column', gap: 8, touchAction: draggingExerciseId && dragActive ? 'none' as any : 'auto' }}
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
                                <div style={{ height: 8, borderTop: '2px dashed #888', borderRadius: 8 }} />
                              )}
                              <div
                                key={item.id}
                                data-exercise-id={item.id}
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'auto 1fr auto auto auto auto',
                                  gap: 6,
                                  alignItems: 'center',
                                  cursor: 'grab',
                                  opacity: draggingExerciseId === item.id && dragActive ? 0.6 : 1,
                                  background: 'transparent',
                                  borderTop: '1px solid #333',
                                  borderBottom: '1px solid #333',
                                  borderLeft: '1px solid #333',
                                  borderRight: '1px solid #333',
                                  borderRadius: 8,
                                  padding: 6,
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
                                  style={{ textAlign: 'center', fontSize: 18, lineHeight: '18px', padding: '0 6px', userSelect: 'none', touchAction: 'none', cursor: 'grab' }}
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
                                style={{ padding: 6, borderRadius: 8, border: '1px solid #444' }}
                                placeholder="Exercise name"
                              />
                              <button
                                onClick={() => openSearchForItem(week.id, day.id, item.id)}
                                style={SMALL_BTN_STYLE}
                              >
                                Search
                              </button>
                              <select
                                value={String(item.targetSets)}
                                onChange={(e) =>
                                  handleExerciseChange(week.id, day.id, item.id, {
                                    targetSets: Number(e.target.value),
                                  })
                                }
                                style={{ padding: '6px 20px 6px 6px', borderRadius: 8, border: '1px solid #444', width: 48 }}
                                title={`${item.targetSets} ${item.targetSets === 1 ? 'set' : 'sets'}`}
                              >
                                {options.map((count) => (
                                  <option key={count} value={count}>
                                    {count}
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={() => handleExerciseChange(week.id, day.id, item.id, { myoReps: !item.myoReps })}
                                style={{
                                  ...SMALL_BTN_STYLE,
                                  padding: '4px 8px',
                                  fontSize: 11,
                                  background: item.myoReps ? 'rgba(167, 139, 250, 0.15)' : 'var(--bg-card)',
                                  borderColor: item.myoReps ? '#a78bfa' : 'var(--border-subtle)',
                                  color: item.myoReps ? '#a78bfa' : 'var(--text-muted)',
                                }}
                                title="Myo-Rep Match"
                              >
                                MYO
                              </button>
                              <button onClick={() => handleRemoveExercise(week.id, day.id, item.id)} style={{ ...SMALL_BTN_STYLE, padding: '4px 8px' }} title="Remove exercise">
                                X
                              </button>
                              </div>
                              {draggingExerciseId && dragActive && dragWeekId === week.id && dragDayId === day.id && dragInsertIndex === idx + 1 && (
                                <div style={{ height: 8, borderTop: '2px dashed #888', borderRadius: 8 }} />
                              )}
                            </>
                          );
                        })}
                        {draggingExerciseId && dragActive && dragWeekId === week.id && dragDayId === day.id && dragInsertIndex === day.items.length && (
                          <div style={{ height: 8, borderTop: '2px dashed #888', borderRadius: 8 }} />
                        )}
                      </div>
                    )}
                    {draggingDayId && dayDragActive && dayDragWeekId === week.id && dayDragInsertIndex === dayIdx + 1 && (
                      <div style={{ height: 8, borderTop: '2px dashed #888', borderRadius: 8, margin: '10px 0' }} />
                    )}
                  </div>
                ))}
                {draggingDayId && dayDragActive && dayDragWeekId === week.id && dayDragInsertIndex === week.days.length && (
                  <div style={{ height: 8, borderTop: '2px dashed #888', borderRadius: 8 }} />
                )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showPlanList && (
        <div style={{ ...MODAL_OVERLAY_STYLE, zIndex: 10 }}>
          <div style={{ ...MODAL_CONTENT_STYLE, maxWidth: 480, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>Manage {manageTab === 'plans' ? 'Plans' : 'Templates'}</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {manageTab === 'plans' && (
                  <>
                    <button onClick={handleClickImportPlan} style={SMALL_BTN_STYLE}>Import Plan (CSV)</button>
                    <input ref={importInputRef} type="file" accept=".csv" onChange={handleImportPlanFile} style={{ display: 'none' }} />
                  </>
                )}
                <button onClick={() => setShowPlanList(false)} style={BTN_STYLE}>
                  Close
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12 }}>
              <button
                onClick={() => setManageTab('plans')}
                style={{
                  ...BTN_STYLE,
                  background: manageTab === 'plans' ? 'var(--accent-muted)' : 'var(--bg-card)',
                  borderColor: manageTab === 'plans' ? 'var(--border-strong)' : 'var(--border-default)',
                }}
                aria-pressed={manageTab === 'plans'}
              >Plans</button>
              <button
                onClick={() => setManageTab('templates')}
                style={{
                  ...BTN_STYLE,
                  background: manageTab === 'templates' ? 'var(--accent-muted)' : 'var(--bg-card)',
                  borderColor: manageTab === 'templates' ? 'var(--border-strong)' : 'var(--border-default)',
                }}
                aria-pressed={manageTab === 'templates'}
              >Templates</button>
            </div>
            {manageTab === 'plans' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {plans.length === 0 && <div style={{ color: 'var(--text-muted)', padding: 16, textAlign: 'center' }}>No plans yet.</div>}
                {plans.map((plan) => (
                  <div key={plan.id} style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 10,
                    padding: 12,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                    transition: 'all 0.15s ease',
                  }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{plan.name}</div>
                      {plan.serverId && <div style={{ fontSize: 12, color: 'var(--success)', fontWeight: 500 }}>Synced</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => {
                          const fullPlan = plans.find((p) => p.id === plan.id) || null;
                          onSelectPlan(plan.id, fullPlan ?? null);
                          setShowPlanList(false);
                        }}
                        style={SMALL_BTN_STYLE}
                      >
                        Open
                      </button>
                      <button onClick={() => handleExportPlanCSV(plan)} style={SMALL_BTN_STYLE}>Export</button>
                      <button onClick={() => handleDeletePlan(plan.id)} style={SMALL_BTN_STYLE}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {templatesError && <div style={{ color: '#f88', padding: '10px 12px', background: 'rgba(255, 136, 136, 0.1)', borderRadius: 8 }}>{templatesError}</div>}
                {templatesLoading ? (
                  <div style={{ color: 'var(--text-muted)', padding: 16, textAlign: 'center' }}>Loading templates...</div>
                ) : templates.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', padding: 16, textAlign: 'center' }}>No templates yet.</div>
                ) : (
                  templates.map((tpl) => (
                    <div key={tpl.id} style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 10,
                      padding: 12,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 10,
                      transition: 'all 0.15s ease',
                    }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{tpl.name}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => openTemplate(tpl)} style={SMALL_BTN_STYLE}>Open</button>
                        <button onClick={() => renameTemplate(tpl)} style={SMALL_BTN_STYLE}>Rename</button>
                        <button onClick={() => handleExportTemplateCSV(tpl)} style={SMALL_BTN_STYLE}>Export</button>
                        <button onClick={() => deleteTemplate(tpl)} style={SMALL_BTN_STYLE}>Delete</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {searchOpen && (
        <div style={MODAL_OVERLAY_STYLE}>
          <div style={{ ...MODAL_CONTENT_STYLE, maxWidth: 980, width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>Search Exercises</h3>
              <button onClick={() => setSearchOpen(false)} style={BTN_STYLE}>Close</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search name..."
                style={INPUT_STYLE}
              />
              <select value={searchPrimary} onChange={(e) => setSearchPrimary(e.target.value)} style={SELECT_STYLE}>
                <option value="All">Primary Muscle (All)</option>
                {primaryMuscles.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select value={searchSecondary} onChange={(e) => setSearchSecondary(e.target.value)} style={{ padding: 8, borderRadius: 8, border: '1px solid #444' }}>
                <option value="All">Secondary Muscle (All)</option>
                {secondaryMuscles.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select value={searchSource} onChange={(e) => setSearchSource(e.target.value as SearchSource)} style={{ padding: 8, borderRadius: 8, border: '1px solid #444' }}>
                <option value="all">Source (All)</option>
                <option value="defaults">Defaults</option>
                <option value="home_made">Home Made *</option>
              </select>
              <button
                type="button"
                onClick={() => setSearchMachine((prev) => !prev)}
                style={{
                  ...FILTER_TOGGLE_STYLE,
                  background: searchMachine ? 'var(--accent-muted)' : 'var(--bg-elevated)',
                  borderColor: searchMachine ? 'var(--border-strong)' : 'var(--border-subtle)',
                }}
                aria-pressed={searchMachine}
              >
                <span style={{ width: 10, height: 10, borderRadius: "50%", border: "1px solid var(--border-strong)", background: searchMachine ? "var(--text-primary)" : "transparent", transition: 'all 0.15s ease' }} />
                Machine
              </button>
              <button
                type="button"
                onClick={() => setSearchFreeWeight((prev) => !prev)}
                style={{
                  ...FILTER_TOGGLE_STYLE,
                  background: searchFreeWeight ? 'var(--accent-muted)' : 'var(--bg-elevated)',
                  borderColor: searchFreeWeight ? 'var(--border-strong)' : 'var(--border-subtle)',
                }}
                aria-pressed={searchFreeWeight}
              >
                <span style={{ width: 10, height: 10, borderRadius: "50%", border: "1px solid var(--border-strong)", background: searchFreeWeight ? "var(--text-primary)" : "transparent", transition: 'all 0.15s ease' }} />
                Free weight
              </button>
              <button
                type="button"
                onClick={() => setSearchCable((prev) => !prev)}
                style={{
                  ...FILTER_TOGGLE_STYLE,
                  background: searchCable ? 'var(--accent-muted)' : 'var(--bg-elevated)',
                  borderColor: searchCable ? 'var(--border-strong)' : 'var(--border-subtle)',
                }}
                aria-pressed={searchCable}
              >
                <span style={{ width: 10, height: 10, borderRadius: "50%", border: "1px solid var(--border-strong)", background: searchCable ? "var(--text-primary)" : "transparent", transition: 'all 0.15s ease' }} />
                Cable
              </button>
              <button
                type="button"
                onClick={() => setSearchBodyWeight((prev) => !prev)}
                style={{
                  ...FILTER_TOGGLE_STYLE,
                  background: searchBodyWeight ? 'var(--accent-muted)' : 'var(--bg-elevated)',
                  borderColor: searchBodyWeight ? 'var(--border-strong)' : 'var(--border-subtle)',
                }}
                aria-pressed={searchBodyWeight}
              >
                <span style={{ width: 10, height: 10, borderRadius: "50%", border: "1px solid var(--border-strong)", background: searchBodyWeight ? "var(--text-primary)" : "transparent", transition: 'all 0.15s ease' }} />
                Bodyweight
              </button>
              <button
                type="button"
                onClick={() => setSearchCompound((prev) => !prev)}
                style={{
                  ...FILTER_TOGGLE_STYLE,
                  background: searchCompound ? 'var(--accent-muted)' : 'var(--bg-elevated)',
                  borderColor: searchCompound ? 'var(--border-strong)' : 'var(--border-subtle)',
                }}
                aria-pressed={searchCompound}
              >
                <span style={{ width: 10, height: 10, borderRadius: "50%", border: "1px solid var(--border-strong)", background: searchCompound ? "var(--text-primary)" : "transparent", transition: 'all 0.15s ease' }} />
                Compound
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 14, minHeight: 280 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontWeight: 600 }}>Results</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{filteredCatalog.length} found</div>
                  </div>
                  <button
                    onClick={() => {
                      setAddMovementOpen((prev) => !prev);
                      setAddMovementError(null);
                    }}
                    style={SMALL_BTN_STYLE}
                  >
                    Can't find a movement? Create a new one!
                  </button>
                </div>
                {addMovementOpen && (
                  <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 12, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <input
                      value={addMovementName}
                      onChange={(e) => setAddMovementName(e.target.value)}
                      placeholder="Movement name"
                      style={INPUT_STYLE}
                    />
                    <select
                      value={addMovementPrimary}
                      onChange={(e) => setAddMovementPrimary(e.target.value)}
                      style={SELECT_STYLE}
                    >
                      <option value="">Primary muscle</option>
                      {primaryMuscles.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="radio"
                          name="add-movement-equipment"
                          checked={addMovementEquipment === 'machine'}
                          onChange={() => setAddMovementEquipment('machine')}
                        />
                        Machine
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="radio"
                          name="add-movement-equipment"
                          checked={addMovementEquipment === 'free_weight'}
                          onChange={() => setAddMovementEquipment('free_weight')}
                        />
                        Free weight
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="radio"
                          name="add-movement-equipment"
                          checked={addMovementEquipment === 'cable'}
                          onChange={() => setAddMovementEquipment('cable')}
                        />
                        Cable
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="radio"
                          name="add-movement-equipment"
                          checked={addMovementEquipment === 'body_weight'}
                          onChange={() => setAddMovementEquipment('body_weight')}
                        />
                        Bodyweight
                      </label>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                        style={{ padding: 8, borderRadius: 8, border: '1px solid #444' }}
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
                      <div style={{ color: '#f88', fontSize: 12 }}>{addMovementError}</div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <button
                        onClick={() => {
                          resetAddMovement();
                          setAddMovementOpen(false);
                        }}
                        style={BTN_STYLE}
                      >
                        Cancel
                      </button>
                      <button onClick={handleAddMovement} style={PRIMARY_BTN_STYLE}>
                        Add
                      </button>
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '50vh', overflowY: 'auto' }}>
                  {filteredCatalog.length === 0 ? (
                    <div style={{ color: '#777' }}>No matches.</div>
                  ) : (
                    filteredCatalog.map((ex) => (
                      <div key={`${ex.isCustom ? 'custom' : 'catalog'}:${ex.id}`} style={{ border: '1px solid #222', borderRadius: 8, padding: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{ex.name}{ex.isCustom ? ' *' : ''}</div>
                          <div style={{ color: '#777', fontSize: 12 }}>
                            {ex.primaryMuscle}{ex.secondaryMuscles.length ? ` / ${ex.secondaryMuscles.join(', ')}` : ''}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => addToQueue(ex)} style={SMALL_BTN_STYLE}>Add</button>
                          {ex.isCustom && (
                            <button onClick={() => handleDeleteCustomFromSearch(ex)} style={SMALL_BTN_STYLE}>Delete</button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div style={{ border: '1px solid #333', borderRadius: 10, padding: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Queue</div>
                {searchQueue.length === 0 ? (
                  <div style={{ color: '#777' }}>No exercises selected.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {searchQueue.map((q) => (
                      <div key={q.name} style={{ border: '1px solid #222', borderRadius: 8, padding: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <div>{q.name}</div>
                        <button onClick={() => removeFromQueue(q.name)} style={SMALL_BTN_STYLE}>Remove</button>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                  <button onClick={applyQueueToDay} style={PRIMARY_BTN_STYLE} disabled={searchQueue.length === 0}>
                    Add to Day
                  </button>
                </div>
              </div>
            </div>
            <div style={{ color: '#777', fontSize: 12, textAlign: 'left' }}>
              * = self made movement
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

