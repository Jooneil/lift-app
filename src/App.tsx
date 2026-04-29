
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Auth from "./Auth";
import { Badge, Button, Card, EmptyState, Modal, Skeleton, KebabIcon, XIcon, TimerIcon, FlameIcon, ChevronLeftIcon } from "./components";
import { api, aiApi, exerciseApi, exerciseCatalogApi, planApi, sessionApi, templateApi } from "./api";
import { getUserPrefs, upsertUserPrefs, DEFAULT_WORKOUT_PREFS, type StreakConfig, type StreakState, type StreakScheduleMode, type UserPrefsData, type WorkoutPrefs } from './api/userPrefs';
import { supabase } from "./supabaseClient";
import type {
  ServerPlanRow,
  ServerPlanData,
  SessionPayload,
  SessionEntryPayload,
  SessionSetPayload,
  SessionRow,
  ExerciseCatalogRow,
  CustomExerciseRow,
} from "./api";
import type { Plan, PlanWeek, PlanDay, PlanExercise, Exercise, CatalogExercise, ImportedExerciseMeta, PlanImportResult, Session, SessionEntry, SessionSet, ArchivedSessionMap, GhostSet, Mode } from './types';
import { SET_COUNT_OPTIONS, MUSCLE_GROUPS } from './types';
import { uuid, normalizeExerciseName, exerciseKey, parseBool, fixMojibake, getUserTimezone, toLocalDateString, isWorkoutDay, checkStreakStatus } from './lib/utils';
import { buildCatalogByName, downloadCSV, exportPlanCSV, generateExerciseCatalogCSV, generateAIPrompt, calculateSetsPerMuscle, calculateWeekSetsPerMuscle } from './lib/csv';
import { startSessionFromDay, mergeSessionWithDay, mapRowToWeeks, nextWeekDay } from './lib/plan';
import AddExerciseSheet from './components/AddExercise/AddExerciseSheet';
import PullToRefresh from './components/pullToRefresh/PullToRefresh';
import DayPickerDropdown from './components/WorkoutHeader/DayPickerDropdown';
import GearMenu from './components/WorkoutHeader/GearMenu';
import AppMenu from './components/WorkoutHeader/AppMenu';


export default function App() {
  const [user, setUser] = useState<{ id: number; username: string } | null>(null);
  const [checking, setChecking] = useState(true);
  const [forcePasswordReset, setForcePasswordReset] = useState(false);

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
      <PullToRefresh onRefresh={() => window.location.reload()} />
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
  const [openHeaderMenu, setOpenHeaderMenu] = useState<'day' | 'gear' | 'app' | null>(null);
  const [showPlanPicker, setShowPlanPicker] = useState(false);
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
  const [workoutPrefs, setWorkoutPrefs] = useState<Required<WorkoutPrefs>>({ ...DEFAULT_WORKOUT_PREFS });
  const [showWorkoutPrefs, setShowWorkoutPrefs] = useState(false);
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

        // Load workout preferences
        if (p?.workout_prefs) {
          setWorkoutPrefs({ ...DEFAULT_WORKOUT_PREFS, ...p.workout_prefs });
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
              <FlameIcon
                size={28}
                color={streakHitToday ? '#f97316' : 'var(--text-muted)'}
              />
              <span
                style={{
                  transform: 'translate(-50%, -45%)',
                  color: streakHitToday ? '#fff' : 'var(--text-muted)',
                  textShadow: streakHitToday ? '0 1px 2px rgba(0,0,0,0.6)' : 'none',
                }}
                className="absolute top-1/2 left-1/2 text-[11px] font-bold pointer-events-none"
              >
                {currentStreak}
              </span>
            </div>
          )}
          <button
            onClick={() => setOpenHeaderMenu(v => v === 'app' ? null : 'app')}
            title="Settings"
            style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: openHeaderMenu === 'app' ? 'var(--text-primary)' : 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="10" cy="4" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="10" cy="16" r="1.5" /></svg>
          </button>
          {openHeaderMenu === 'app' && (
            <>
              <div onClick={() => setOpenHeaderMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
              <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50 }}>
                <AppMenu
                  userEmail={user.username}
                  onPreferences={() => { setOpenHeaderMenu(null); setShowWorkoutPrefs(true); }}
                  onArchive={() => { setOpenHeaderMenu(null); handleOpenArchive(); }}
                  onLogout={() => { setOpenHeaderMenu(null); onLogout(); }}
                />
              </div>
            </>
          )}
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
          onBack={() => setMode("workout")}
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
          <div className="mb-4" style={{ position: 'relative' }}>
            {/* Header row: plan name · day chip · gear */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 12 }}>
              <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedPlan?.name ?? 'No plan'}
              </span>

              {selectedPlan && selectedWeekId && selectedDayId && (
                <button
                  onClick={() => setOpenHeaderMenu(v => v === 'day' ? null : 'day')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: 'var(--accent-blue-muted)', border: '1px solid var(--accent-blue)', borderRadius: 9999, color: 'var(--accent-blue)', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer', flexShrink: 0 }}
                >
                  W{selectedPlan.weeks.findIndex(w => w.id === selectedWeekId) + 1}·D{(selectedWeek?.days.findIndex(d => d.id === selectedDayId) ?? -1) + 1}
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ transform: openHeaderMenu === 'day' ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}><path d="M3 5l3 3 3-3" /></svg>
                </button>
              )}

              {selectedPlan && (
                <button
                  onClick={() => setOpenHeaderMenu(v => v === 'gear' ? null : 'gear')}
                  title="Plan settings"
                  style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: openHeaderMenu === 'gear' ? 'var(--text-primary)' : 'var(--text-muted)', display: 'flex', flexShrink: 0 }}
                >
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
                    <path d="M16.2 12.2a1.4 1.4 0 0 0 .3 1.5l.05.05a1.7 1.7 0 1 1-2.4 2.4l-.05-.05a1.4 1.4 0 0 0-1.5-.3 1.4 1.4 0 0 0-.85 1.3v.13a1.7 1.7 0 1 1-3.4 0v-.07a1.4 1.4 0 0 0-.9-1.3 1.4 1.4 0 0 0-1.5.3l-.05.05a1.7 1.7 0 1 1-2.4-2.4l.05-.05a1.4 1.4 0 0 0 .3-1.5 1.4 1.4 0 0 0-1.3-.85H2.4a1.7 1.7 0 1 1 0-3.4h.07a1.4 1.4 0 0 0 1.3-.9 1.4 1.4 0 0 0-.3-1.5l-.05-.05a1.7 1.7 0 1 1 2.4-2.4l.05.05a1.4 1.4 0 0 0 1.5.3h.06a1.4 1.4 0 0 0 .85-1.3V2.4a1.7 1.7 0 0 1 3.4 0v.07a1.4 1.4 0 0 0 .85 1.3 1.4 1.4 0 0 0 1.5-.3l.05-.05a1.7 1.7 0 1 1 2.4 2.4l-.05.05a1.4 1.4 0 0 0-.3 1.5v.06a1.4 1.4 0 0 0 1.3.85h.13a1.7 1.7 0 0 1 0 3.4h-.07a1.4 1.4 0 0 0-1.3.85Z" />
                  </svg>
                </button>
              )}
            </div>

            {/* Day picker dropdown */}
            {openHeaderMenu === 'day' && selectedPlan && selectedWeekId && selectedDayId && (
              <>
                <div onClick={() => setOpenHeaderMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
                <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50 }}>
                  <DayPickerDropdown
                    plan={selectedPlan}
                    selectedWeekId={selectedWeekId}
                    selectedDayId={selectedDayId}
                    onSelectDay={(weekId, dayId) => {
                      setSelectedWeekId(weekId);
                      setSelectedDayId(dayId);
                      setSession(null);
                      setShouldAutoNavigate(false);
                    }}
                    onClose={() => setOpenHeaderMenu(null)}
                  />
                </div>
              </>
            )}

            {/* Gear menu dropdown */}
            {openHeaderMenu === 'gear' && selectedPlan && (
              <>
                <div onClick={() => setOpenHeaderMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
                <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50 }}>
                  <GearMenu
                    planCount={plans.length}
                    ghostMode={selectedPlan.ghostMode ?? 'default'}
                    onGhostModeChange={handleGhostModeChange}
                    onNewPlan={() => { setMode('builder'); setShowPlanList(false); setSelectedPlanId(null); }}
                    onSwitchPlan={() => { setShowPlanPicker(true); }}
                    onEditPlan={() => { setMode('builder'); setShowPlanList(false); }}
                    onClose={() => setOpenHeaderMenu(null)}
                  />
                </div>
              </>
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
                  await updateStreak();
                }}
                onContinueAfterDone={() => {
                  if (!selectedPlan || !selectedWeek || !selectedDay) return;
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
                currentStreak={currentStreak}
                streakEnabled={!!(streakConfig?.enabled)}
                workoutPrefs={workoutPrefs}
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
      {/* Plan picker — shown from "Switch plan" in gear menu */}
      <Modal open={showPlanPicker} onClose={() => setShowPlanPicker(false)} title="Switch plan" maxWidth={380}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {plans.length === 0 && <p style={{ color: 'var(--text-muted)', margin: 0 }}>No plans yet.</p>}
          {plans.map(p => (
            <button
              key={p.id}
              onClick={() => {
                selectPlan(p.id);
                setSession(null);
                setShowPlanPicker(false);
              }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                background: p.id === selectedPlanId ? 'var(--accent-blue-muted)' : 'var(--bg-card)',
                border: `1px solid ${p.id === selectedPlanId ? 'var(--accent-blue)' : 'var(--border-subtle)'}`,
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 15, color: p.id === selectedPlanId ? 'var(--accent-blue)' : 'var(--text-primary)' }}>{p.name}</span>
              {p.id === selectedPlanId && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-blue)' }}>ACTIVE</span>}
            </button>
          ))}
        </div>
      </Modal>

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
                <div className="flex justify-center mb-2"><FlameIcon size={48} color="#f97316" /></div>
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

      {/* Workout Preferences Modal */}
      <Modal open={showWorkoutPrefs} onClose={() => setShowWorkoutPrefs(false)} title="Workout Preferences" maxWidth={420}>
        {(() => {
          const savePrefs = (patch: Partial<Required<WorkoutPrefs>>) => {
            const updated = { ...workoutPrefs, ...patch };
            setWorkoutPrefs(updated);
            upsertUserPrefs({ workout_prefs: updated });
          };
          const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
          return (
            <>
              <div className="flex justify-between items-center py-3 border-b border-b-subtle">
                <div>
                  <div className="font-medium">Rest Timer</div>
                  <div className="text-[13px] text-muted">Show countdown after each set</div>
                </div>
                <label className="flex items-center cursor-pointer">
                  <input type="checkbox" checked={workoutPrefs.rest_timer_enabled} onChange={(e) => savePrefs({ rest_timer_enabled: e.target.checked })} className="w-5 h-5" />
                </label>
              </div>

              {workoutPrefs.rest_timer_enabled && (
                <>
                  <div className="py-3 border-b border-b-subtle">
                    <div className="font-medium mb-2">Default Duration</div>
                    <div className="flex gap-2 mb-2">
                      {[60, 90, 120, 180].map(s => (
                        <Button
                          key={s}
                          onClick={() => savePrefs({ rest_duration: s })}
                          className="flex-1"
                          style={{
                            background: workoutPrefs.rest_duration === s ? 'var(--accent-muted)' : 'var(--bg-card)',
                            borderColor: workoutPrefs.rest_duration === s ? 'var(--border-strong)' : 'var(--border-default)',
                          }}
                        >
                          {fmtDur(s)}
                        </Button>
                      ))}
                    </div>
                    {![60, 90, 120, 180].includes(workoutPrefs.rest_duration) && (
                      <div className="text-[13px] text-muted mb-1">Custom: {fmtDur(workoutPrefs.rest_duration)}</div>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[13px] text-muted shrink-0">Custom (s):</span>
                      <input
                        type="number"
                        min={10}
                        max={600}
                        value={workoutPrefs.rest_duration}
                        onChange={(e) => {
                          const val = Math.max(10, Math.min(600, parseInt(e.target.value) || 90));
                          savePrefs({ rest_duration: val });
                        }}
                        className="w-20 text-center"
                        style={{ fontSize: 14, padding: '4px 8px', borderRadius: 8 }}
                      />
                      <span className="text-[13px] text-muted">{fmtDur(workoutPrefs.rest_duration)}</span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center py-3 border-b border-b-subtle">
                    <div>
                      <div className="font-medium">Auto-start</div>
                      <div className="text-[13px] text-muted">Begin timer automatically after logging a set</div>
                    </div>
                    <label className="flex items-center cursor-pointer">
                      <input type="checkbox" checked={workoutPrefs.auto_start_rest} onChange={(e) => savePrefs({ auto_start_rest: e.target.checked })} className="w-5 h-5" />
                    </label>
                  </div>
                  <div className="flex justify-between items-center py-3 border-b border-b-subtle">
                    <div>
                      <div className="font-medium">Sound</div>
                      <div className="text-[13px] text-muted">Beep when rest is complete</div>
                    </div>
                    <label className="flex items-center cursor-pointer">
                      <input type="checkbox" checked={workoutPrefs.rest_sound} onChange={(e) => savePrefs({ rest_sound: e.target.checked })} className="w-5 h-5" />
                    </label>
                  </div>
                </>
              )}

              <div className="flex justify-between items-center py-3">
                <div>
                  <div className="font-medium">Show Previous</div>
                  <div className="text-[13px] text-muted">Display last session's weights as placeholders</div>
                </div>
                <label className="flex items-center cursor-pointer">
                  <input type="checkbox" checked={workoutPrefs.show_ghost} onChange={(e) => savePrefs({ show_ghost: e.target.checked })} className="w-5 h-5" />
                </label>
              </div>
            </>
          );
        })()}
      </Modal>

      {/* Plan Settings Modal */}
      <Modal open={!!(showPlanSettings && selectedPlan)} onClose={() => setShowPlanSettings(false)} title="Plan Settings" maxWidth={360}>
        {selectedPlan && (
          <>
            <div className="flex gap-2 mb-4">
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => { setShowPlanSettings(false); setMode("builder"); setShowPlanList(false); setSelectedPlanId(null); }}
              >
                + New Plan
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => { setShowPlanSettings(false); setShowPlanList(true); }}
              >
                Manage Plans
              </Button>
            </div>
            <Button
              onClick={() => { setShowPlanSettings(false); setMode("builder"); setShowPlanList(false); }}
              block
              className="mb-4"
            >
              Edit plan structure
            </Button>
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
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="mb-3" aria-hidden="true">
            <rect x="20" y="2" width="6" height="8" rx="2" fill="#818cf8" transform="rotate(10 20 2)"/>
            <rect x="3" y="12" width="5" height="9" rx="2" fill="#f97316" transform="rotate(-25 3 12)"/>
            <rect x="37" y="8" width="5" height="9" rx="2" fill="#22c55e" transform="rotate(20 37 8)"/>
            <rect x="7" y="29" width="6" height="6" rx="2" fill="#eab308" transform="rotate(-10 7 29)"/>
            <rect x="36" y="26" width="5" height="9" rx="2" fill="#ec4899" transform="rotate(30 36 26)"/>
            <rect x="18" y="38" width="5" height="7" rx="2" fill="#f97316" transform="rotate(5 18 38)"/>
            <rect x="31" y="36" width="6" height="6" rx="2" fill="#818cf8" transform="rotate(-15 31 36)"/>
          </svg>
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
  onContinueAfterDone,
  completed,
  setCompleted,
  isLastDay,
  onFinishPlan,
  finishingPlan,
  currentStreak,
  streakEnabled,
  workoutPrefs,
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
  onMarkDone: () => void | Promise<void>;
  onContinueAfterDone: () => void;
  completed: boolean;
  setCompleted: (value: boolean) => void | Promise<void>;
  isLastDay: boolean;
  onFinishPlan?: () => void;
  finishingPlan: boolean;
  currentStreak: number;
  streakEnabled: boolean;
  workoutPrefs: Required<WorkoutPrefs>;
  onUpdatePlan: (plan: Plan) => void;
}) {
  const [replaceSheetOpen, setReplaceSheetOpen] = useState(false);
  const [replaceTargetEntry, setReplaceTargetEntry] = useState<{ exerciseId?: string; exerciseName: string } | null>(null);
  const [replaceTargetIndex, setReplaceTargetIndex] = useState<number | null>(null);
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
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const allTimePRRef = useRef<Record<string, number>>({});
  const sessionStartRef = useRef<number | null>(null);
  const [elapsedDisplay, setElapsedDisplay] = useState('');
  const timerPausedRef = useRef(false);
  const [sessionTimerPaused, setSessionTimerPaused] = useState(false);
  const [showTimerPopover, setShowTimerPopover] = useState(false);
  const timerPopoverRef = useRef<HTMLDivElement>(null);
  const [progressIsStuck, setProgressIsStuck] = useState(false);
  const progressSentinelRef = useRef<HTMLDivElement>(null);
  const REST_DURATION = workoutPrefs.rest_timer_enabled ? workoutPrefs.rest_duration : 90;
  const [restTimer, setRestTimer] = useState<{ secondsLeft: number; total: number; entryId: string; done?: boolean; paused?: boolean } | null>(null);
  const restTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [restTimerPopoverOpen, setRestTimerPopoverOpen] = useState(false);
  const restTimerPopoverRef = useRef<HTMLDivElement>(null);

  const formatElapsed = useCallback(() => {
    if (!sessionStartRef.current) return '';
    const mins = Math.floor((Date.now() - sessionStartRef.current) / 60000);
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }, []);

  // Detect first set logged, update elapsed immediately
  useEffect(() => {
    if (sessionStartRef.current != null) return;
    if (!session) return;
    const hasLogged = session.entries.some(e => e.sets.some(s => s.weight != null && s.reps != null));
    if (hasLogged) {
      sessionStartRef.current = Date.now();
      setElapsedDisplay(formatElapsed());
    }
  }, [session, formatElapsed]);

  // Refresh elapsed every 30s (skip when paused)
  useEffect(() => {
    const id = setInterval(() => {
      if (!timerPausedRef.current) setElapsedDisplay(formatElapsed());
    }, 30000);
    return () => clearInterval(id);
  }, [formatElapsed]);

  // IntersectionObserver for sticky progress bar
  useEffect(() => {
    const el = progressSentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setProgressIsStuck(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Close session timer popover on outside click
  useEffect(() => {
    if (!showTimerPopover) return;
    const handler = (e: MouseEvent) => {
      if (timerPopoverRef.current && !timerPopoverRef.current.contains(e.target as Node)) {
        setShowTimerPopover(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTimerPopover]);

  // Close rest timer popover on outside click
  useEffect(() => {
    if (!restTimerPopoverOpen) return;
    const handler = (e: MouseEvent) => {
      if (restTimerPopoverRef.current && !restTimerPopoverRef.current.contains(e.target as Node)) {
        setRestTimerPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [restTimerPopoverOpen]);

  const handleResetTimer = () => {
    sessionStartRef.current = Date.now();
    timerPausedRef.current = false;
    setSessionTimerPaused(false);
    setElapsedDisplay('0 min');
    setShowTimerPopover(false);
  };

  const handleStopTimer = () => {
    sessionStartRef.current = Date.now();
    timerPausedRef.current = true;
    setSessionTimerPaused(true);
    setElapsedDisplay('0 min');
    setShowTimerPopover(false);
  };

  const handleStartTimer = () => {
    sessionStartRef.current = Date.now();
    timerPausedRef.current = false;
    setSessionTimerPaused(false);
    setElapsedDisplay('0 min');
    setShowTimerPopover(false);
  };

  const playBeep = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.6);
    } catch { /* ignore */ }
  }, []);

  const startRestTimer = useCallback((entryId: string) => {
    if (restTimerRef.current) clearInterval(restTimerRef.current);
    setRestTimer({ secondsLeft: REST_DURATION, total: REST_DURATION, entryId });
    restTimerRef.current = setInterval(() => {
      setRestTimer(prev => {
        if (!prev) return null;
        if (prev.secondsLeft <= 1) {
          if (restTimerRef.current) clearInterval(restTimerRef.current);
          if (workoutPrefs.rest_sound) playBeep();
          setTimeout(() => setRestTimer(null), 3000);
          return { ...prev, secondsLeft: 0, done: true };
        }
        return { ...prev, secondsLeft: prev.secondsLeft - 1 };
      });
    }, 1000);
  }, [REST_DURATION, workoutPrefs.rest_sound, playBeep]);

  const dismissRestTimer = useCallback(() => {
    if (restTimerRef.current) clearInterval(restTimerRef.current);
    setRestTimer(null);
    setRestTimerPopoverOpen(false);
  }, []);

  const stopRestTimer = useCallback(() => {
    if (restTimerRef.current) clearInterval(restTimerRef.current);
    setRestTimer(prev => prev ? { ...prev, paused: true } : null);
    setRestTimerPopoverOpen(false);
  }, []);

  const resetRestTimer = useCallback((entryId: string) => {
    setRestTimerPopoverOpen(false);
    startRestTimer(entryId);
  }, [startRestTimer]);

  const adjustRestTimer = useCallback((delta: number) => {
    setRestTimer(prev => {
      if (!prev || prev.done) return prev;
      return { ...prev, secondsLeft: Math.max(1, prev.secondsLeft + delta) };
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => () => { if (restTimerRef.current) clearInterval(restTimerRef.current); }, []);

  const loggedSets = useMemo(() =>
    session ? session.entries.reduce((acc, e) => acc + e.sets.filter(s => s.weight != null && s.reps != null).length, 0) : 0,
    [session]
  );
  const totalSets = useMemo(() =>
    session ? session.entries.reduce((acc, e) => acc + e.sets.length, 0) : 0,
    [session]
  );

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


  const openReplaceSearch = (entry: SessionEntry, entryIndex: number) => {
    setReplaceTargetEntry({ exerciseId: entry.exerciseId, exerciseName: entry.exerciseName });
    setReplaceTargetIndex(entryIndex);
    setReplaceSheetOpen(true);
  };

  const closeReplaceSearch = () => {
    setReplaceSheetOpen(false);
  };

  const handleSheetConfirmReplace = async (firstName: string, scope: "today" | "remaining", extras: string[]) => {
    if (!replaceTargetEntry) return;
    if (typeof onReplaceExercise === "function") onReplaceExercise(replaceTargetEntry, firstName, scope);
    historyCacheRef.current = null;
    if (extras.length > 0 && typeof onInsertExercisesAt === "function" && currentWeekId && replaceTargetIndex != null) {
      await onInsertExercisesAt(currentWeekId, day.id, replaceTargetIndex, extras);
    }
  };

  const handleDeleteCustomFromReplace = async (id: string) => {
    if (!onDeleteCustomExercise) return;
    await onDeleteCustomExercise(id);
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
    // Fetch all-time best volumes per exercise (excluding today's session) for PR comparison
    try {
      const rows = await sessionApi.listAll();
      const bests: Record<string, number> = {};
      for (const row of rows) {
        // Skip the current session — it's already been saved, don't count it as "history"
        if (session &&
            String(row.plan_id) === String(plan.serverId) &&
            row.week_id === session.planWeekId &&
            row.day_id === session.planDayId) continue;
        const payload = row.data;
        if (!payload?.entries) continue;
        for (const entry of payload.entries) {
          const name = (entry.exerciseName || '').trim().toLowerCase();
          if (!name) continue;
          for (const s of (entry.sets || [])) {
            if (s.weight != null && s.reps != null) {
              const vol = s.weight * s.reps;
              if (vol > (bests[name] || 0)) bests[name] = vol;
            }
          }
        }
      }
      allTimePRRef.current = bests;
    } catch {
      allTimePRRef.current = {};
    }
    setShowCompletionModal(true);
  };


  return (
    <div>
      <datalist id="exercise-options-workout">
        {exerciseOptions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {/* Sticky progress sentinel — IntersectionObserver fires when this scrolls off-screen */}
      <div ref={progressSentinelRef} aria-hidden="true" style={{ height: 1, marginTop: -1 }} />
      {totalSets > 0 && (
        <div className={`progress-sticky${progressIsStuck ? ' is-stuck' : ''}`}>
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-[12px] font-medium uppercase tracking-[0.05em] text-muted">
              {loggedSets} of {totalSets} sets logged
            </span>
            {elapsedDisplay && (
              <div className="relative" ref={timerPopoverRef}>
                <button
                  onClick={() => setShowTimerPopover(v => !v)}
                  className="text-[12px] font-medium uppercase tracking-[0.05em] text-muted"
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}
                >
                  {timerPausedRef.current ? '⏸ ' : ''}{elapsedDisplay}
                </button>
                {showTimerPopover && (
                  <div className="dropdown-menu absolute top-full right-0 bg-elevated border border-subtle rounded-md p-1 mt-1 z-30 shadow-[var(--shadow-lg)]" style={{ display: 'flex', flexDirection: 'column', minWidth: 120 }}>
                    <button
                      onClick={handleResetTimer}
                      className="text-left px-3 py-2 text-[13px] rounded hover:bg-accent-muted transition-colors duration-100"
                      style={{ display: 'block', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}
                    >
                      Reset
                    </button>
                    {sessionTimerPaused ? (
                      <button
                        onClick={handleStartTimer}
                        className="text-left px-3 py-2 text-[13px] rounded hover:bg-accent-muted transition-colors duration-100"
                        style={{ display: 'block', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}
                      >
                        Start
                      </button>
                    ) : (
                      <button
                        onClick={handleStopTimer}
                        className="text-left px-3 py-2 text-[13px] rounded hover:bg-accent-muted transition-colors duration-100"
                        style={{ display: 'block', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}
                      >
                        Stop
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <div style={{ height: 2, background: 'var(--bg-subtle, rgba(255,255,255,0.06))', borderRadius: 1 }}>
            <div style={{
              height: 2,
              width: `${(loggedSets / totalSets) * 100}%`,
              background: 'var(--accent-blue)',
              borderRadius: 1,
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {session.entries.map((entry, entryIndex) => (
        <div key={entry.id} className="list-stagger bg-elevated rounded-md p-4 shadow-card transition-all duration-150 ease-in-out border-l-[3px]" style={{
          '--i': entryIndex,
          borderLeftColor: 'var(--accent-blue)',
          borderTop: '1px solid var(--border-subtle)',
          borderRight: '1px solid var(--border-subtle)',
          borderBottom: '1px solid var(--border-subtle)',
        } as React.CSSProperties}>
          {/* Header: Name + timer pill + kebab */}
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="m-0 text-[15px] font-semibold flex-1 min-w-0">
              {entry.exerciseName}
            </h3>
            <div className="flex items-center gap-1 shrink-0">
              {/* Rest timer pill — always visible when rest timer enabled */}
              {workoutPrefs.rest_timer_enabled && (() => {
                const thisTimer = restTimer?.entryId === entry.id ? restTimer : null;
                const isDone = thisTimer?.done;
                const isPaused = thisTimer?.paused;
                const isActive = thisTimer && !isDone && !isPaused;
                const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

                if (isDone) {
                  return (
                    <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 9999, border: '1px solid var(--success)', background: 'var(--success-muted)', color: 'var(--success)', whiteSpace: 'nowrap' }}>
                      Rest done
                    </span>
                  );
                }
                if (isPaused) {
                  return (
                    <button
                      onClick={dismissRestTimer}
                      style={{ fontSize: 12, padding: '3px 10px', borderRadius: 9999, border: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}
                      title="Tap to dismiss"
                    >
                      ⏸ {fmtDur(thisTimer!.secondsLeft)}
                    </button>
                  );
                }
                if (isActive) {
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, position: 'relative' }} ref={restTimerPopoverRef}>
                      <button
                        onClick={() => adjustRestTimer(-15)}
                        style={{ fontSize: 11, padding: '2px 6px', borderRadius: 9999, border: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', lineHeight: 1.4 }}
                        title="–15 seconds"
                      >–15</button>
                      <button
                        onClick={() => setRestTimerPopoverOpen(v => !v)}
                        style={{ fontSize: 12, padding: '3px 10px', borderRadius: 9999, border: '1px solid var(--accent-blue)', background: 'var(--accent-blue-muted)', color: 'var(--accent-blue)', cursor: 'pointer', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <TimerIcon size={12} /> {fmtDur(restTimer!.secondsLeft)}
                      </button>
                      <button
                        onClick={() => adjustRestTimer(15)}
                        style={{ fontSize: 11, padding: '2px 6px', borderRadius: 9999, border: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', lineHeight: 1.4 }}
                        title="+15 seconds"
                      >+15</button>
                      {restTimerPopoverOpen && (
                        <div className="dropdown-menu" style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '4px', minWidth: 110, zIndex: 30, boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <button onClick={() => resetRestTimer(entry.id)} style={{ width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 13, borderRadius: 6, background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-muted)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                          >Reset</button>
                          <button onClick={stopRestTimer} style={{ width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 13, borderRadius: 6, background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-muted)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                          >Stop</button>
                          <button onClick={dismissRestTimer} style={{ width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 13, borderRadius: 6, background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-muted)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                          >Dismiss</button>
                        </div>
                      )}
                    </div>
                  );
                }
                // Inactive: faint, no interaction
                return (
                  <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 9999, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', opacity: 0.4, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', userSelect: 'none' }}>
                    {fmtDur(REST_DURATION)}
                  </span>
                );
              })()}
              <div className="relative">
                <Button
                  onClick={() => setOpenExerciseMenu(openExerciseMenu === entry.id ? null : entry.id)}
                  size="sm"
                  style={{ padding: '4px 8px', minWidth: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  title="Options"
                >
                  <KebabIcon size={16} />
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
                    className="text-error border-error min-w-0"
                    style={{ padding: '2px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    title="Remove set"
                  >
                    <XIcon size={13} />
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
              <div className="grid grid-cols-[28px_1fr_1fr] gap-2 mb-1 px-1 text-muted text-[11px] font-semibold uppercase tracking-[0.05em] text-center">
                <div></div>
                <div>Weight</div>
                <div style={{ color: entry.myoRepMatch ? 'var(--accent-purple)' : 'var(--text-muted)' }}>
                  {entry.myoRepMatch ? 'Match' : 'Reps'}
                </div>
              </div>

              {entry.sets.map((set, i) => {
                const ghostSet = getGhost(entry.exerciseId, entry.exerciseName, i);
                const hasValue = set.weight != null || set.reps != null;
                return (
                  <div key={set.id} className="grid grid-cols-[28px_1fr_1fr] gap-2 mb-2 items-center" style={{
                    borderBottom: hasValue ? '1px solid var(--accent-blue)' : '1px solid transparent',
                  }}>
                    <div className="flex items-center justify-center w-7 h-7 rounded-full bg-elevated text-muted font-semibold text-[13px] shrink-0">{i + 1}</div>
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      placeholder={!workoutPrefs.show_ghost || ghostSet.weight == null ? '' : String(ghostSet.weight)}
                      value={set.weight ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        const normalized = v.replace(',', '.');
                        const num = normalized === '' ? null : Number(normalized);
                        updateSet(entry.id, set.id, {
                          weight: num !== null && Number.isNaN(num) ? null : num,
                        });
                      }}
                      className="workout-input w-full min-w-0"
                    />
                    <input
                      inputMode="numeric"
                      placeholder={!workoutPrefs.show_ghost || ghostSet.reps == null ? '' : String(ghostSet.reps)}
                      value={set.reps ?? ''}
                      onChange={(e) => {
                        const num = e.target.value === '' ? null : Number(e.target.value);
                        const repsValue = num !== null && Number.isNaN(num) ? null : num;
                        const effectiveWeight = set.weight ?? (repsValue != null ? ghostSet.weight : null);
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
                        // Start rest timer when set becomes complete
                        if (repsValue != null && effectiveWeight != null && workoutPrefs.rest_timer_enabled && workoutPrefs.auto_start_rest) {
                          startRestTimer(entry.id);
                        }
                      }}
                      className="workout-input w-full min-w-0"
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
          display: 'inline-flex',
          alignItems: 'center',
          alignSelf: 'center',
          gap: 8,
          cursor: 'pointer',
          padding: '0 20px',
          height: 40,
          borderRadius: 9999,
          background: completed ? 'var(--success-muted)' : 'var(--bg-card)',
          border: `1.5px solid ${completed ? 'var(--success)' : 'var(--border-default)'}`,
          transition: 'all 0.15s ease',
          flexShrink: 0,
          userSelect: 'none',
        }}>
          <input
            type="checkbox"
            checked={completed}
            onChange={(e) => {
              const value = e.target.checked;
              markSessionCompleted(value);
              setCompleted(value);
            }}
            style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
          />
          {completed ? (
            <svg width="18" height="18" viewBox="0 0 20 20" fill="var(--success)" aria-hidden="true">
              <circle cx="10" cy="10" r="10" />
              <path d="M5.5 10.5L8.5 13.5L14.5 7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" aria-hidden="true">
              <circle cx="10" cy="10" r="9" />
              <path d="M5.5 10.5L8.5 13.5L14.5 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          <span className="font-medium" style={{ color: completed ? 'var(--success)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            {completed ? 'Completed' : 'Mark Complete'}
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

      {/* Completion Modal */}
      <Modal open={showCompletionModal} onClose={() => setShowCompletionModal(false)} maxWidth={400}>
        {(() => {
          const completedSets = session ? session.entries.flatMap(e => e.sets.filter(s => s.weight != null && s.reps != null)) : [];
          const totalVolume = completedSets.reduce((acc, s) => acc + (s.weight ?? 0) * (s.reps ?? 0), 0);
          const elapsedMins = sessionStartRef.current ? Math.floor((Date.now() - sessionStartRef.current) / 60000) : 0;
          const durationStr = elapsedMins < 60
            ? `${elapsedMins}m`
            : `${Math.floor(elapsedMins / 60)}h ${elapsedMins % 60}m`;

          // Two-tier achievement detection
          const prs: { exerciseName: string; weight: number; reps: number }[] = [];
          const improved: { exerciseName: string; weight: number; reps: number }[] = [];
          if (session) {
            const allTimeBests = allTimePRRef.current;
            for (const entry of session.entries) {
              const todayBest = entry.sets
                .filter(s => s.weight != null && s.reps != null)
                .reduce((best, s) => {
                  const vol = (s.weight ?? 0) * (s.reps ?? 0);
                  return vol > best.vol ? { vol, weight: s.weight!, reps: s.reps! } : best;
                }, { vol: 0, weight: 0, reps: 0 });
              if (todayBest.vol === 0) continue;
              const nameLower = (entry.exerciseName || '').trim().toLowerCase();
              const allTimeBest = allTimeBests[nameLower] ?? 0;
              const key = exerciseKey(entry);
              const ghostSets = ghost[key] ?? [];
              const ghostBest = ghostSets.reduce((best, s) => Math.max(best, (s.weight ?? 0) * (s.reps ?? 0)), 0);
              if (todayBest.vol > allTimeBest) {
                prs.push({ exerciseName: entry.exerciseName, weight: todayBest.weight, reps: todayBest.reps });
              } else if (todayBest.vol > ghostBest) {
                improved.push({ exerciseName: entry.exerciseName, weight: todayBest.weight, reps: todayBest.reps });
              }
            }
          }

          return (
            <>
              <div className="flex items-center gap-2 mb-4">
                <h2 className="text-[28px] font-bold m-0">Day complete</h2>
                <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                  <rect x="13" y="1" width="4" height="5" rx="1.5" fill="#818cf8" transform="rotate(10 13 1)"/>
                  <rect x="2" y="8" width="3" height="6" rx="1.5" fill="#f97316" transform="rotate(-25 2 8)"/>
                  <rect x="25" y="5" width="3" height="6" rx="1.5" fill="#22c55e" transform="rotate(20 25 5)"/>
                  <rect x="5" y="19" width="4" height="4" rx="1.5" fill="#eab308" transform="rotate(-10 5 19)"/>
                  <rect x="24" y="17" width="3" height="6" rx="1.5" fill="#ec4899" transform="rotate(30 24 17)"/>
                  <rect x="12" y="25" width="3" height="5" rx="1.5" fill="#f97316" transform="rotate(5 12 25)"/>
                  <rect x="21" y="24" width="4" height="4" rx="1.5" fill="#818cf8" transform="rotate(-15 21 24)"/>
                </svg>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {[
                  { label: 'Sets', value: String(completedSets.length) },
                  { label: 'Volume', value: totalVolume > 0 ? `${totalVolume.toLocaleString()} lbs` : '—' },
                  { label: 'Time', value: elapsedMins > 0 ? durationStr : '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-elevated border border-subtle rounded-md p-3 text-center">
                    <div className="text-[20px] font-bold tabular-nums">{value}</div>
                    <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted mt-0.5">{label}</div>
                  </div>
                ))}
              </div>
              {(prs.length > 0 || improved.length > 0) && (
                <div className="mb-4 flex flex-col gap-1.5">
                  {prs.map((pr) => (
                    <div key={pr.exerciseName} className="flex items-center gap-2 text-[13px] font-medium px-3 py-2 bg-elevated border border-subtle rounded-md">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 3h6v3a3 3 0 0 1-6 0V3ZM3 4h2M11 4h2M6 9h4v3H6zM5 13h6" />
                      </svg>
                      <span style={{ color: '#f59e0b' }} className="font-semibold">PR</span>
                      <span className="text-secondary">{pr.exerciseName}</span>
                      <span className="ml-auto text-muted tabular-nums">{pr.weight} × {pr.reps}</span>
                    </div>
                  ))}
                  {improved.map((item) => (
                    <div key={item.exerciseName} className="flex items-center gap-2 text-[13px] font-medium px-3 py-2 bg-elevated border border-subtle rounded-md">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M7 11V3M4 6l3-3 3 3" />
                      </svg>
                      <span className="text-secondary font-semibold">Up from last</span>
                      <span className="text-muted">{item.exerciseName}</span>
                      <span className="ml-auto text-muted tabular-nums">{item.weight} × {item.reps}</span>
                    </div>
                  ))}
                </div>
              )}
              {streakEnabled && currentStreak > 0 && (
                <div className="flex items-center justify-center gap-2 mb-4 py-3 bg-elevated border border-subtle rounded-md">
                  <FlameIcon size={22} color="#f97316" />
                  <span className="text-[20px] font-bold tabular-nums">{currentStreak}</span>
                  <span className="text-[13px] text-muted">day streak</span>
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  onClick={() => { setShowCompletionModal(false); onContinueAfterDone(); }}
                  variant="primary"
                  block
                >
                  Continue
                </Button>
                <Button
                  onClick={() => setShowCompletionModal(false)}
                  block
                >
                  Stay here
                </Button>
              </div>
            </>
          );
        })()}
      </Modal>

      <AddExerciseSheet
        open={replaceSheetOpen}
        onClose={closeReplaceSearch}
        mode="replace"
        dayName={day.name}
        dayItems={session?.entries.map(e => ({ exerciseName: e.exerciseName, exerciseId: e.exerciseId })) ?? []}
        replaceTarget={replaceTargetEntry ? {
          exerciseName: replaceTargetEntry.exerciseName,
          primaryMuscle: catalogByNameMap.get(replaceTargetEntry.exerciseName.trim().toLowerCase())?.primaryMuscle,
        } : undefined}
        catalogExercises={catalogExercises}
        onConfirmAdd={async () => {}}
        onConfirmReplace={handleSheetConfirmReplace}
        onCreateCustom={async (input) => {
          if (!onCreateCustomExercise) throw new Error('Custom movements are unavailable.');
          return onCreateCustomExercise(input);
        }}
        onDeleteCustom={handleDeleteCustomFromReplace}
      />

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
  onBack,
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
  onBack?: () => void;
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
  const builderInitialSnapshotRef = useRef<Plan | null>(null);
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manageTab, setManageTab] = useState<"plans" | "templates">("plans");
  const [showAIProgramBuilder, setShowAIProgramBuilder] = useState(false);
  const [templates, setTemplates] = useState<Plan[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [addSheetWeekId, setAddSheetWeekId] = useState<string | null>(null);
  const [addSheetDayId, setAddSheetDayId] = useState<string | null>(null);
  const [addSheetItemId, setAddSheetItemId] = useState<string | null>(null);
  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<string>>(new Set());
  const [dayMenuOpenId, setDayMenuOpenId] = useState<string | null>(null);
  const dayMenuRef = useRef<HTMLDivElement>(null);
  const [plansMenuOpen, setPlansMenuOpen] = useState(false);
  const plansMenuRef = useRef<HTMLDivElement>(null);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const [weekMenuOpenId, setWeekMenuOpenId] = useState<string | null>(null);
  const weekMenuRef = useRef<HTMLDivElement>(null);
  const [setWeeksInput, setSetWeeksInput] = useState('');

  // Close builder menus on outside click
  useEffect(() => {
    if (!dayMenuOpenId && !plansMenuOpen && !saveMenuOpen && !weekMenuOpenId) return;
    const handler = (e: MouseEvent) => {
      if (dayMenuRef.current && !dayMenuRef.current.contains(e.target as Node)) setDayMenuOpenId(null);
      if (plansMenuRef.current && !plansMenuRef.current.contains(e.target as Node)) setPlansMenuOpen(false);
      if (saveMenuRef.current && !saveMenuRef.current.contains(e.target as Node)) setSaveMenuOpen(false);
      if (weekMenuRef.current && !weekMenuRef.current.contains(e.target as Node)) setWeekMenuOpenId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dayMenuOpenId, plansMenuOpen, saveMenuOpen, weekMenuOpenId]);

  const toggleWeek = (weekId: string) => {
    setCollapsedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(weekId)) next.delete(weekId);
      else next.add(weekId);
      return next;
    });
  };

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

  // Snapshot the plan when it first loads into the builder for dirty tracking
  useEffect(() => {
    if (selectedPlan && !builderInitialSnapshotRef.current) {
      builderInitialSnapshotRef.current = JSON.parse(JSON.stringify(selectedPlan));
    }
  }, [selectedPlan]);

  const dirty = useMemo(() => {
    if (!selectedPlan || !builderInitialSnapshotRef.current) return false;
    return JSON.stringify(selectedPlan) !== JSON.stringify(builderInitialSnapshotRef.current);
  }, [selectedPlan]);

  const handleBack = () => {
    if (dirty) {
      setShowDiscardModal(true);
    } else {
      builderInitialSnapshotRef.current = null;
      onBack?.();
    }
  };

  const handleDiscard = () => {
    const snapshot = builderInitialSnapshotRef.current;
    builderInitialSnapshotRef.current = null;
    if (snapshot) {
      if (!snapshot.serverId) {
        // New unsaved plan — remove it entirely
        setPlans((prev) => prev.filter((p) => p.id !== snapshot.id));
      } else {
        // Existing plan — restore to snapshot
        setPlans((prev) => prev.map((p) => p.id === snapshot.id ? snapshot : p));
      }
    }
    setShowDiscardModal(false);
    onBack?.();
  };

  // Wire browser/hardware back button while in builder
  useEffect(() => {
    history.pushState({ builder: true }, '');
    const handler = (e: PopStateEvent) => {
      e.preventDefault();
      handleBack();
    };
    window.addEventListener('popstate', handler);
    return () => {
      window.removeEventListener('popstate', handler);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  const handleCreatePlan = () => {
    const newPlan: Plan = {
      id: uuid(),
      name: 'Untitled',
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

  const handleSetWeekCount = (count: number) => {
    if (!selectedPlan || count < 1 || count > 52) return;
    const sourceWeek = selectedPlan.weeks[0];
    const current = selectedPlan.weeks.length;

    const cloneWeek = (index: number): PlanWeek => ({
      id: uuid(),
      name: `Week ${index + 1}`,
      days: sourceWeek.days.map((day) => ({
        id: uuid(),
        name: day.name,
        items: day.items.map((item) => ({
          id: uuid(),
          exerciseId: item.exerciseId,
          exerciseName: item.exerciseName,
          targetSets: item.targetSets,
          targetReps: item.targetReps ?? '',
        })),
      })),
    });

    updatePlan(selectedPlan.id, (plan) => {
      if (count > current) {
        const added = Array.from({ length: count - current }, (_, i) => cloneWeek(current + i));
        return { ...plan, weeks: [...plan.weeks, ...added] };
      } else {
        return { ...plan, weeks: plan.weeks.slice(0, count) };
      }
    });

    setSetWeeksInput('');
  };

  const handleResetWeekToOne = (weekId: string) => {
    if (!selectedPlan) return;
    const sourceWeek = selectedPlan.weeks[0];
    if (!sourceWeek || sourceWeek.id === weekId) return;
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
    updatePlan(selectedPlan.id, (plan) => ({
      ...plan,
      weeks: plan.weeks.map((w) => w.id === weekId ? { ...w, days: clonedDays } : w),
    }));
    if (selectedWeekId === weekId) setSelectedDayId(clonedDays[0]?.id ?? null);
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
    setAddSheetWeekId(weekId);
    setAddSheetDayId(dayId);
    setAddSheetItemId(null);
    setAddSheetOpen(true);
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
    setAddSheetWeekId(weekId);
    setAddSheetDayId(dayId);
    setAddSheetItemId(itemId);
    setAddSheetOpen(true);
  };

  const handleSheetConfirmAdd = async (names: string[]) => {
    if (!selectedPlan || !addSheetWeekId || !addSheetDayId) return;
    const resolved = await Promise.all(names.map(n => onResolveExerciseName(n)));
    updatePlan(selectedPlan.id, (plan) => ({
      ...plan,
      weeks: plan.weeks.map((week) => {
        if (week.id !== addSheetWeekId) return week;
        return {
          ...week,
          days: week.days.map((day) => {
            if (day.id !== addSheetDayId) return day;
            const items = day.items.slice();
            const insertAt = addSheetItemId ? items.findIndex(it => it.id === addSheetItemId) : -1;
            if (insertAt >= 0) {
              const firstEx = resolved[0];
              items[insertAt] = { ...items[insertAt], exerciseName: firstEx?.name ?? names[0], exerciseId: firstEx?.id };
              for (let i = 1; i < resolved.length; i++) {
                const ex = resolved[i];
                items.splice(insertAt + i, 0, { id: uuid(), exerciseName: ex?.name ?? names[i], exerciseId: ex?.id, targetSets: 3, targetReps: '' });
              }
            } else {
              for (let i = 0; i < resolved.length; i++) {
                const ex = resolved[i];
                items.push({ id: uuid(), exerciseName: ex?.name ?? names[i], exerciseId: ex?.id, targetSets: 3, targetReps: '' });
              }
            }
            return { ...day, items };
          }),
        };
      }),
    }));
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
  const dragOffsetYRef = useRef<number>(0);
  const draggedElRef = useRef<HTMLElement | null>(null);

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
      {/* Back button */}
      {onBack && (
        <button
          onClick={handleBack}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500, padding: '0 0 12px 0' }}
        >
          <ChevronLeftIcon size={16} /> Back
        </button>
      )}
      {/* Discard changes confirm modal */}
      <Modal open={showDiscardModal} title="Discard changes?" onClose={() => setShowDiscardModal(false)}>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 20px' }}>Your edits will be lost.</p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setShowDiscardModal(false)}>Keep editing</Button>
          <Button variant="danger" onClick={handleDiscard}>Discard</Button>
        </div>
      </Modal>
      {/* Row 1: Plan name + right-side controls */}
      <div className="flex items-center justify-between gap-3 pb-3">
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted mb-0.5">Plan</span>
          <div className="flex items-center gap-2 min-w-0">
            {selectedPlan ? (
              <input
                value={selectedPlan.name}
                onChange={(e) => handlePlanNameChange(e.target.value)}
                className="text-[18px] font-bold tracking-[-0.02em] bg-transparent border-none shadow-none px-0 min-w-0 flex-1"
                style={{ outline: 'none' }}
                placeholder="Untitled"
              />
            ) : (
              <h2 className="text-[18px] font-bold tracking-[-0.02em] m-0">Plan Builder</h2>
            )}
            {(exerciseLoading || catalogLoading) && (
              <span className="text-muted text-[12px] whitespace-nowrap">Loading…</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Plans dropdown — single button on mobile, expanded on desktop */}
          <div className="relative" ref={plansMenuRef}>
            <button
              onClick={() => setPlansMenuOpen((v) => !v)}
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-primary)' }}
            >
              <span className="hidden sm:inline">Manage </span>Plans <span style={{ fontSize: 13, opacity: 0.8 }}>▾</span>
            </button>
            {plansMenuOpen && (
              <div className="dropdown-menu absolute top-full right-0 bg-elevated border border-subtle rounded-md p-1.5 mt-1 min-w-[170px] z-30 shadow-[var(--shadow-lg)]">
                <button
                  onClick={() => { setPlansMenuOpen(false); setShowPlanList(true); }}
                  className="w-full text-left px-3 py-2 text-[13px] rounded hover:bg-accent-muted transition-colors duration-100"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}
                >
                  Manage Plans
                </button>
                <button
                  onClick={() => { setPlansMenuOpen(false); handleCreatePlan(); }}
                  className="w-full text-left px-3 py-2 text-[13px] rounded hover:bg-accent-muted transition-colors duration-100"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}
                >
                  + New Plan
                </button>
              </div>
            )}
          </div>

          {/* Split save button */}
          {selectedPlan && (
            <div className="relative flex" ref={saveMenuRef}>
              <button
                onClick={async () => { setSaveMenuOpen(false); await handleSavePlan(); }}
                disabled={saving}
                style={{
                  background: 'var(--accent)', color: '#0a0a0c', fontWeight: 600, fontSize: 13,
                  border: 'none', borderRadius: '8px 0 0 8px', padding: '7px 14px',
                  cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
                  borderRight: '1px solid rgba(0,0,0,0.15)',
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => setSaveMenuOpen((v) => !v)}
                disabled={saving}
                style={{
                  background: 'var(--accent)', color: '#0a0a0c',
                  border: 'none', borderRadius: '0 8px 8px 0', padding: '7px 10px',
                  cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
                  fontSize: 13,
                }}
                title="More save options"
              >
                ▾
              </button>
              {saveMenuOpen && (
                <div className="dropdown-menu absolute top-full right-0 bg-elevated border border-subtle rounded-md p-1.5 mt-1 min-w-[200px] z-30 shadow-[var(--shadow-lg)]">
                  <button
                    onClick={async () => { setSaveMenuOpen(false); await handleSavePlan(); await handleSaveAsTemplate(); }}
                    className="w-full text-left px-3 py-2 text-[13px] rounded hover:bg-accent-muted transition-colors duration-100"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}
                    disabled={saving}
                  >
                    Save + Save as Template
                  </button>
                  <button
                    onClick={async () => { setSaveMenuOpen(false); await handleSaveAsTemplate(); }}
                    className="w-full text-left px-3 py-2 text-[13px] rounded hover:bg-accent-muted transition-colors duration-100"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}
                    disabled={saving}
                  >
                    Save as Template only
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-subtle mb-3" />

      {/* Row 2: Week count inline input */}
      {selectedPlan && (
        <div className="flex items-center gap-2 mb-3">
          <div className="flex items-center gap-2">
            <label className="text-[13px] text-muted font-medium whitespace-nowrap">Weeks</label>
            <input
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              min={1}
              max={52}
              value={setWeeksInput || String(selectedPlan.weeks.length)}
              onFocus={(e) => {
                setSetWeeksInput(String(selectedPlan.weeks.length));
                e.target.select();
              }}
              onChange={(e) => setSetWeeksInput(e.target.value)}
              onBlur={(e) => {
                const n = parseInt(e.target.value, 10);
                if (n >= 1 && n <= 52) handleSetWeekCount(n);
                else setSetWeeksInput('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const n = parseInt(setWeeksInput, 10);
                  if (n >= 1 && n <= 52) handleSetWeekCount(n);
                  (e.currentTarget as HTMLInputElement).blur();
                }
                if (e.key === 'Escape') {
                  setSetWeeksInput('');
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              className="text-center font-semibold"
              style={{ width: 52, minHeight: 'auto', height: 32, fontSize: 14, padding: '4px 6px' }}
            />
          </div>
        </div>
      )}

      {error && <div className="text-error mt-2 px-3 py-2.5 bg-error-muted rounded-sm">{error}</div>}

      {!selectedPlan ? (
        <EmptyState message="Create a plan to get started." className="mt-4" />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Plan type toggle */}
          <div>
            <label className="block mb-2 font-semibold text-[13px] text-muted uppercase tracking-[0.04em]">Plan Type</label>
            <div className="flex gap-2">
              <Button
                onClick={() => updatePlan(selectedPlan.id, (p) => ({ ...p, ghostMode: 'default' }))}
                size="sm"
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
                size="sm"
                style={{
                  flex: 1,
                  background: selectedPlan.ghostMode === 'full-body' ? 'var(--accent-muted)' : 'var(--bg-card)',
                  borderColor: selectedPlan.ghostMode === 'full-body' ? 'var(--border-strong)' : 'var(--border-default)',
                }}
              >
                Full Body
              </Button>
            </div>
            <p className="text-[12px] text-muted mt-1.5 leading-snug">
              {(selectedPlan.ghostMode ?? 'default') === 'default'
                ? 'Ghost shows your most recent performance regardless of day.'
                : 'Ghost only shows performance from the same day (e.g., Tuesday vs Tuesday).'}
            </p>
          </div>


          <div className="flex flex-col gap-4">
            {selectedPlan.weeks.map((week) => {
              const isWeekCollapsed = collapsedWeeks.has(week.id);
              return (
              <div key={week.id} className="bg-elevated border border-subtle rounded-md overflow-hidden">
                {/* Week header — always visible, tappable to collapse */}
                <div
                  className="flex justify-between items-center gap-3 p-3 cursor-pointer select-none"
                  onClick={() => toggleWeek(week.id)}
                >
                  <div className="flex gap-2 items-center min-w-0 flex-1">
                    <span className="text-muted text-[13px] transition-transform duration-200" style={{ display: 'inline-block', transform: isWeekCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▾</span>
                    <input
                      value={week.name}
                      onChange={(e) => { e.stopPropagation(); handleWeekNameChange(week.id, e.target.value); }}
                      onClick={(e) => e.stopPropagation()}
                      className="min-w-0 flex-1 font-semibold bg-transparent border-none shadow-none px-1"
                      style={{ outline: 'none' }}
                    />
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    {!isWeekCollapsed && (
                      <Button onClick={() => handleAddDay(week.id)} size="sm">+ Day</Button>
                    )}
                    <div className="relative" ref={weekMenuOpenId === week.id ? weekMenuRef : undefined}>
                      <button
                        onClick={() => setWeekMenuOpenId(weekMenuOpenId === week.id ? null : week.id)}
                        title="Week options"
                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', lineHeight: 1, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }}
                      >
                        <KebabIcon size={16} />
                      </button>
                      {weekMenuOpenId === week.id && (
                        <div className="dropdown-menu absolute top-full right-0 bg-elevated border border-subtle rounded-md p-1.5 mt-1 min-w-[180px] z-30 shadow-[var(--shadow-lg)]">
                          {selectedPlan.weeks[0].id !== week.id && (
                            <button
                              onClick={() => { setWeekMenuOpenId(null); handleResetWeekToOne(week.id); }}
                              className="w-full text-left px-3 py-2 text-[13px] rounded hover:bg-accent-muted transition-colors duration-100"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}
                            >
                              Reset to Week 1
                            </button>
                          )}
                          <button
                            onClick={() => { setWeekMenuOpenId(null); handleRemoveWeek(week.id); }}
                            disabled={selectedPlan.weeks.length <= 1}
                            className="w-full text-left px-3 py-2 text-[13px] rounded hover:bg-accent-muted transition-colors duration-100"
                            style={{ background: 'none', border: 'none', cursor: selectedPlan.weeks.length <= 1 ? 'not-allowed' : 'pointer', color: selectedPlan.weeks.length <= 1 ? 'var(--text-muted)' : 'var(--color-error, #f87171)', opacity: selectedPlan.weeks.length <= 1 ? 0.5 : 1 }}
                          >
                            Delete Week
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {/* Collapsible week body */}
                {!isWeekCollapsed && (
                <div className="px-3 pb-3">

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
                    <div className="flex justify-between items-center gap-2 mb-3">
                      <div className="flex gap-2 items-center min-w-0 flex-1">
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
                          className="text-center text-lg leading-[18px] px-2 py-1 select-none touch-none cursor-grab bg-elevated rounded-sm text-muted flex-shrink-0"
                          aria-label="Drag day handle"
                          title="Drag to reorder day"
                        >
                          ≡
                        </div>
                        <input
                          value={day.name}
                          onChange={(e) => handleDayNameChange(week.id, day.id, e.target.value)}
                          className="min-w-0 flex-1 font-medium"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <Button onClick={() => handleAddExercise(week.id, day.id)} size="sm">+ Exercise</Button>
                        {/* Day ⋮ menu for secondary actions */}
                        <div className="relative" ref={dayMenuOpenId === day.id ? dayMenuRef : undefined}>
                          <button
                            onClick={() => setDayMenuOpenId(dayMenuOpenId === day.id ? null : day.id)}
                            title="Day options"
                            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', lineHeight: 1, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }}
                          >
                            <KebabIcon size={16} />
                          </button>
                          {dayMenuOpenId === day.id && (
                            <div className="dropdown-menu absolute top-full right-0 bg-elevated border border-subtle rounded-md p-2 mt-1 min-w-[160px] z-30 shadow-[var(--shadow-lg)]">
                              <Button onClick={() => { setDayMenuOpenId(null); handleDuplicateDay(week.id, day.id); }} size="sm" block className="mb-1 text-left">
                                Duplicate Day
                              </Button>
                              <Button
                                onClick={() => { setDayMenuOpenId(null); handleRemoveDay(week.id, day.id); }}
                                size="sm"
                                block
                                disabled={week.days.length <= 1}
                                className="text-left"
                                style={{ color: week.days.length <= 1 ? undefined : 'var(--color-error, #f87171)' }}
                              >
                                Delete Day
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
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
                      <button
                        onClick={() => handleAddExercise(week.id, day.id)}
                        className="w-full text-left"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px 16px', border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-input)', color: 'var(--text-muted)', fontSize: 14, cursor: 'pointer', transition: 'all 0.15s ease' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-default)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-subtle)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; }}
                      >
                        <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add Exercise
                      </button>
                    ) : (
                      <div
                        className="drag-container flex flex-col gap-2" style={{ touchAction: draggingExerciseId && dragActive ? 'none' as any : 'auto' }}
                        onPointerMove={(e) => {
                          if (!draggingExerciseId || dragWeekId !== week.id || dragDayId !== day.id) return;
                          const dy = Math.abs(e.clientY - dragStartYRef.current);
                          if (!dragActive && dy > 8) setDragActive(true);
                          if (!dragActive) return;
                          e.preventDefault();
                          // Move the dragged element visually
                          dragOffsetYRef.current = e.clientY - dragStartYRef.current;
                          if (draggedElRef.current) {
                            draggedElRef.current.style.transform = `translateY(${dragOffsetYRef.current}px) scale(1.02)`;
                          }
                          // Calculate insert position from non-dragged items
                          const container = e.currentTarget as HTMLElement;
                          const allRows = Array.from(container.querySelectorAll('[data-exercise-id]')) as HTMLElement[];
                          // Get unique items (desktop+mobile share same data-exercise-id, take first visible)
                          const seen = new Set<string>();
                          const rows: HTMLElement[] = [];
                          for (const row of allRows) {
                            const id = row.getAttribute('data-exercise-id')!;
                            if (!seen.has(id) && row.offsetParent !== null) {
                              seen.add(id);
                              rows.push(row);
                            }
                          }
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
                          // Snap back: remove inline transform before reorder
                          if (draggedElRef.current) {
                            draggedElRef.current.style.transform = '';
                          }
                          const insert = dragInsertIndex == null ? day.items.length : dragInsertIndex;
                          handleReorderExerciseAtIndex(week.id, day.id, draggingExerciseId, insert);
                          setDraggingExerciseId(null);
                          setDragWeekId(null);
                          setDragDayId(null);
                          setDragInsertIndex(null);
                          setDragActive(false);
                          dragOffsetYRef.current = 0;
                          draggedElRef.current = null;
                        }}
                        onPointerCancel={() => {
                          if (dragTimerRef.current) { window.clearTimeout(dragTimerRef.current); dragTimerRef.current = null; }
                          if (draggedElRef.current) {
                            draggedElRef.current.style.transform = '';
                          }
                          setDraggingExerciseId(null);
                          setDragWeekId(null);
                          setDragDayId(null);
                          setDragInsertIndex(null);
                          setDragActive(false);
                          dragOffsetYRef.current = 0;
                          draggedElRef.current = null;
                        }}
                      >
                        {day.items.map((item, idx) => {
                          const options = SET_COUNT_OPTIONS.includes(item.targetSets)
                            ? SET_COUNT_OPTIONS
                            : [...SET_COUNT_OPTIONS, item.targetSets].sort((a, b) => a - b);

                          const isDragging = draggingExerciseId === item.id && dragActive;
                          const isDragContext = dragActive && dragWeekId === week.id && dragDayId === day.id;
                          const showPlaceholder = isDragContext && draggingExerciseId !== item.id && dragInsertIndex === idx;

                          return (
                            <>
                              {showPlaceholder && (
                                <div className="drag-placeholder" />
                              )}
                              <div
                                key={item.id}
                                data-exercise-id={item.id}
                                ref={isDragging ? (el) => { draggedElRef.current = el; } : undefined}
                                className={`drag-item hidden sm:grid sm:grid-cols-[auto_1fr_auto_auto_auto_auto] gap-2 items-center border border-default rounded-sm p-2 cursor-grab${isDragging ? ' dragging' : ''}`}
                                style={{
                                  touchAction: draggingExerciseId && dragActive ? 'none' as any : 'auto',
                                  userSelect: draggingExerciseId && dragActive ? 'none' as any : 'auto',
                                }}
                                title="Drag to reorder"
                              >
                                <div
                                  onPointerDown={(e) => {
                                    e.preventDefault();
                                    const exerciseRow = (e.currentTarget as HTMLElement).closest('[data-exercise-id]') as HTMLElement | null;
                                    draggedElRef.current = exerciseRow;
                                    setDraggingExerciseId(item.id);
                                    setDragWeekId(week.id);
                                    setDragDayId(day.id);
                                    setDragActive(false);
                                    dragStartYRef.current = e.clientY;
                                    dragOffsetYRef.current = 0;
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
                                className="py-2 pl-3 pr-7 w-[62px]"
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
                                ref={isDragging ? (el) => { draggedElRef.current = el; } : undefined}
                                className={`drag-item flex flex-col gap-1.5 sm:hidden border border-default rounded-sm p-2 cursor-grab${isDragging ? ' dragging' : ''}`}
                                style={{
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
                                      const exerciseRow = (e.currentTarget as HTMLElement).closest('[data-exercise-id]') as HTMLElement | null;
                                      draggedElRef.current = exerciseRow;
                                      setDraggingExerciseId(item.id);
                                      setDragWeekId(week.id);
                                      setDragDayId(day.id);
                                      setDragActive(false);
                                      dragStartYRef.current = e.clientY;
                                      dragOffsetYRef.current = 0;
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
                                    className="p-1.5 text-[13px] flex-1 min-w-0"
                                    style={{ minHeight: 'auto', height: 36 }}
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
                                      className="pl-2 pr-6 w-[56px]"
                                      style={{ minHeight: 36, fontSize: 13 }}
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
                                  <div className="flex items-center gap-1 ml-auto">
                                    <Button
                                      onClick={() => openSearchForItem(week.id, day.id, item.id)}
                                      size="sm"
                                      style={{ padding: '5px 8px', fontSize: 12, minHeight: 34 }}
                                    >
                                      Search
                                    </Button>
                                    <Button
                                      onClick={() => handleExerciseChange(week.id, day.id, item.id, { myoReps: !item.myoReps })}
                                      size="sm"
                                      style={{
                                        padding: '5px 8px',
                                        fontSize: 12,
                                        minHeight: 34,
                                        background: item.myoReps ? 'var(--accent-purple-muted)' : 'var(--bg-card)',
                                        borderColor: item.myoReps ? 'var(--accent-purple)' : 'var(--border-subtle)',
                                        color: item.myoReps ? 'var(--accent-purple)' : 'var(--text-muted)',
                                      }}
                                      title="Myo-Rep Match"
                                    >
                                      MYO
                                    </Button>
                                    <Button onClick={() => handleRemoveExercise(week.id, day.id, item.id)} size="xs" style={{ minHeight: 34, padding: '5px 8px', fontSize: 12 }} title="Remove exercise">
                                      X
                                    </Button>
                                  </div>
                                </div>
                              </div>
                              {isDragContext && draggingExerciseId !== item.id && dragInsertIndex === idx + 1 && (
                                <div className="drag-placeholder" />
                              )}
                            </>
                          );
                        })}
                        {dragActive && dragWeekId === week.id && dragDayId === day.id && dragInsertIndex === day.items.length && draggingExerciseId !== day.items[day.items.length - 1]?.id && (
                          <div className="drag-placeholder" />
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
                )}
              </div>
            );
            })}
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

      {(() => {
        const sheetDay = selectedPlan?.weeks
          .find(w => w.id === addSheetWeekId)?.days
          .find(d => d.id === addSheetDayId);
        return (
          <AddExerciseSheet
            open={addSheetOpen}
            onClose={() => setAddSheetOpen(false)}
            mode="add"
            dayName={sheetDay?.name ?? ''}
            dayItems={sheetDay?.items.map(it => ({ exerciseName: it.exerciseName, exerciseId: it.exerciseId })) ?? []}
            catalogExercises={catalogExercises}
            onConfirmAdd={handleSheetConfirmAdd}
            onCreateCustom={onCreateCustomExercise}
            onDeleteCustom={onDeleteCustomExercise}
          />
        );
      })()}
    </Card>
  );
}

