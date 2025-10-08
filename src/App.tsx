
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Auth from "./Auth";
import { api, planApi, sessionApi, templateApi } from "./api";
import { getUserPrefs, upsertUserPrefs } from './api/userPrefs';
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
} from "./api";

type Plan = { id: string; serverId?: string; predecessorPlanId?: string; name: string; weeks: PlanWeek[] };
type PlanWeek = { id: string; name: string; days: PlanDay[] };
type PlanDay = { id: string; name: string; items: PlanExercise[] };
type PlanExercise = { id: string; exerciseName: string; targetSets: number; targetReps?: string };

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
type SessionEntry = { id: string; exerciseName: string; sets: SessionSet[] };
type SessionSet = { id: string; setIndex: number; weight: number | null; reps: number | null };

type ArchivedSessionMap = Record<string, Record<string, Session | null>>;


type Mode = "builder" | "workout";

const SET_COUNT_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

const BTN_STYLE = { padding: "8px 10px", borderRadius: 8, border: "1px solid #444", background: "transparent" } as const;
const PRIMARY_BTN_STYLE = { padding: "10px 12px", borderRadius: 10, border: "1px solid #444", background: "#222", color: "#fff" } as const;
const SMALL_BTN_STYLE = { padding: "6px 8px", borderRadius: 8, border: "1px solid #444", background: "transparent", fontSize: 12 } as const;

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
      exerciseName: item.exerciseName,
      sets: Array.from({ length: item.targetSets }, (_, i) => ({
        id: uuid(),
        setIndex: i,
        weight: null,
        reps: null,
      })),
    })),
    completed: false,
  };
}

// Merge an existing session with the latest plan day shape.
// - Keeps weights/reps that already exist for matching exercise names and set indices
// - Adds new exercises/sets as nulls
// - Drops exercises removed from the plan
function mergeSessionWithDay(planDay: PlanDay, prev: Session): Session {
  const nextEntries: SessionEntry[] = planDay.items.map((item) => {
    const existing = (prev.entries || []).find((e) => e.exerciseName === item.exerciseName) || null;
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
      exerciseName: item.exerciseName,
      sets,
    };
  });
  return { ...prev, entries: nextEntries };
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


// previousWeekDay function was unused; removed to satisfy lints
export default function App() {
  const [user, setUser] = useState<{ id: number; username: string } | null>(null);
  const [checking, setChecking] = useState(true);

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

  return (
    <div>
      {checking ? (
        <div style={{ padding: 20 }}>Loading...</div>
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
  const selectionOriginRef = useRef<"auto" | "user">("auto");

  // Ensure default view is Workout on load
  useEffect(() => {
    setMode("workout");
  }, []);

  const mapServerPlan = (row: ServerPlanRow): Plan => {
    const d = (row?.data ?? {}) as import("./api").ServerPlanData;
    const weeks: PlanWeek[] = Array.isArray(d.weeks)
      ? (d.weeks as ServerPlanWeek[]).map((week) => ({
          id: week.id ?? uuid(),
          name: week.name ?? "Week",
          days: (week.days ?? []).map((day: ServerPlanDayRow) => ({
            id: day.id ?? uuid(),
            name: day.name ?? "Day",
            items: (day.items ?? []).map((item: ServerPlanItemRow) => ({
              id: item.id ?? uuid(),
              exerciseName: item.exerciseName ?? "Exercise",
              targetSets: Number(item.targetSets) || 0,
              targetReps: item.targetReps ?? "",
            })),
          })),
        }))
      : [
          {
            id: uuid(),
            name: "Week 1",
            days: (d.days ?? []).map((day: ServerPlanDayRow) => ({
              id: day.id ?? uuid(),
              name: day.name ?? "Day",
              items: (day.items ?? []).map((item: ServerPlanItemRow) => ({
                id: item.id ?? uuid(),
                exerciseName: item.exerciseName ?? "Exercise",
                targetSets: Number(item.targetSets) || 0,
                targetReps: item.targetReps ?? "",
              })),
            })),
          },
        ];

    return {
      id: uuid(),
      serverId: row.id,
      predecessorPlanId: typeof row.predecessor_plan_id === "string" ? row.predecessor_plan_id : undefined,
      name: row.name ?? "Plan",
      weeks,
    };
  };

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

  // When entering Builder, open plan/template chooser by default
  useEffect(() => {
    if (mode === "builder") {
      setShowPlanList(true);
    }
  }, [mode]);

  


  useEffect(() => {
    (async () => {
      try {
        const rows = await planApi.list();
        const loaded: Plan[] = rows.map((row) => mapServerPlan(row));
        setPlans(loaded);

        const up = await getUserPrefs().catch(() => null);
        const p = (up?.prefs as { last_plan_server_id?: string|null; last_week_id?: string|null; last_day_id?: string|null } | null) || null;
        const prefs = {
          lastPlanServerId: p?.last_plan_server_id ?? null,
          lastWeekId: p?.last_week_id ?? null,
          lastDayId: p?.last_day_id ?? null,
        };

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
    upsertUserPrefs({ last_plan_server_id: planIdStr, last_week_id: weekId, last_day_id: dayId }).catch(() => {});
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
    const map: ArchivedSessionMap = {};
    try {
      for (const week of plan.weeks) {
        map[week.id] = {};
        for (const day of week.days) {
          let sessionData: Session | null = null;
          try {
            const raw = await sessionApi.last(plan.serverId, week.id, day.id);
            if (raw && raw.entries) {
              sessionData = {
                id: uuid(),
                planId: plan.id,
                planWeekId: week.id,
                planDayId: day.id,
                date: raw.date ?? new Date().toISOString(),
                entries: raw.entries.map((entry: SessionEntryPayload) => ({
                  id: uuid(),
                  exerciseName: entry.exerciseName ?? "Exercise",
                  sets: (entry.sets ?? []).map((set: Partial<SessionSetPayload>, index: number) => ({
                    id: uuid(),
                    setIndex: index,
                    weight: set.weight ?? null,
                    reps: set.reps ?? null,
                  })),
                })),
              };
            }
          } catch {
            sessionData = null;
          }
          map[week.id][day.id] = sessionData;
        }
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

  const handleFinishPlan = async () => {
    if (!selectedPlan || !selectedWeek || !selectedDay || finishingPlan) return;
    setFinishingPlan(true);
    try {
      let planToArchive = selectedPlan;
      let serverPlanId = selectedPlan.serverId;
      const payload = { weeks: selectedPlan.weeks };
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
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setFinishingPlan(false);
    }
  };

  // goToPreviousDay removed (unused)

  const isLastDayOfPlan = (() => {
    if (!selectedPlan || !selectedWeek || !selectedDay) return false;
    const lastWeek = selectedPlan.weeks[selectedPlan.weeks.length - 1];
    if (!lastWeek || lastWeek.id !== selectedWeek.id) return false;
    const lastDay = lastWeek.days[lastWeek.days.length - 1];
    return !!lastDay && lastDay.id === selectedDay.id;
  })();
  
  return (
    <div style={{ maxWidth: 680, width: "100%", margin: "0 auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 8, marginBottom: 12, borderBottom: "1px solid #444" }}>
        <div style={{ position: 'relative' }}>
          <button onClick={() => setUserMenuOpen((v) => !v)} style={BTN_STYLE} aria-expanded={userMenuOpen} aria-haspopup="menu">
          <button onClick={() => setUserMenuOpen((v) => !v)} style={BTN_STYLE} aria-expanded={userMenuOpen} aria-haspopup="menu">Profile</button>
          {userMenuOpen && (
            <div role="menu" style={{ position: 'absolute', top: '100%', left: 0, background: '#111', border: '1px solid #444', borderRadius: 8, padding: 8, marginTop: 6, minWidth: 200, zIndex: 30 }}>
              <div style={{ padding: '4px 6px', color: '#bbb', fontSize: 12 }}>Logged in as</div>
              <div style={{ padding: '0 6px 6px', wordBreak: 'break-all' }}><strong>{user.username}</strong></div>
              <button onClick={() => { setUserMenuOpen(false); onLogout(); }} style={SMALL_BTN_STYLE} role="menuitem">Logout</button>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => { setUserMenuOpen(false); setMode("builder"); setShowPlanList(true); setSelectedPlanId(null); }} style={BTN_STYLE} aria-pressed={mode === "builder"}>Builder</button>
          <button onClick={() => { setUserMenuOpen(false); setMode("workout"); }} style={BTN_STYLE} aria-pressed={mode === "workout"}>Workout</button>
          <button onClick={() => { setUserMenuOpen(false); handleOpenArchive(); }} style={BTN_STYLE}>Archive</button>
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
        <div style={{ border: "1px solid #444", borderRadius: 12, padding: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
            <label>Plan:</label>
            <select
              value={selectedPlanId ?? ''}
              onChange={(e) => {
                const newPlanId = e.target.value || null;
                selectPlan(newPlanId);
                setSession(null);
              }}
              style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #444" }}
            >
              {plans.length === 0 && <option value="">No plans yet</option>}
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            {selectedPlan && (
              <>
                <label>Week:</label>
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
                  style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #444" }}
                >
                  {selectedPlan.weeks.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>

                <label>Day:</label>
                <select
                  value={selectedDayId ?? ''}
                  onChange={(e) => {
                    setSelectedDayId(e.target.value || null);
                    setSession(null);
                    setShouldAutoNavigate(false);
                  }}
                  style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #444" }}
                >
                  {(selectedWeek ?? { days: [] as PlanDay[] }).days.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>

          {!selectedPlan ? (
            <p style={{ color: '#777' }}>No plan selected.</p>
          ) : !selectedDay ? (
            <div style={{ color: '#777' }}>Select a day.</div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{selectedPlan.name}</div>
                  <div style={{ color: '#888', fontSize: 12 }}>{selectedDay.name}</div>
                </div>
              </div>

              <WorkoutPage
                plan={selectedPlan}
                day={selectedDay}
                session={session}
                setSession={setSession}
                onMarkDone={async () => {
                  if (!selectedPlan || !selectedWeek || !selectedDay) return;
                  setCompleted(true);
                  const serverId = selectedPlan.serverId;
                  if (serverId) {
                    try {
                      await sessionApi.complete(serverId, selectedWeek.id, selectedDay.id, true);
                    } catch { void 0; }
                  }

                  const nxt = nextWeekDay(selectedPlan, selectedWeek.id, selectedDay.id);
                  setSelectedWeekId(nxt.weekId);
                  setSelectedDayId(nxt.dayId);
                  setSession(null);
                  setShouldAutoNavigate(false);
                }}
                completed={completed}
                setCompleted={async (val: boolean) => {
                  setCompleted(val);
                  const serverId = selectedPlan?.serverId;
                  if (serverId && selectedWeek && selectedDay) {
                    try {
                      await sessionApi.complete(serverId, selectedWeek.id, selectedDay.id, val);
                    } catch { void 0; }
                  }
                }}
                isLastDay={isLastDayOfPlan}
                onFinishPlan={handleFinishPlan}
                finishingPlan={finishingPlan}
              />
            </>
          )}
        </div>
      )}
      {showArchiveList && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 16, zIndex: 20 }}>
          <div style={{ background: '#111', border: '1px solid #444', borderRadius: 12, padding: 16, maxWidth: 950, width: '100%', maxHeight: '80vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <h3 style={{ margin: 0 }}>Archived Plans</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={closeArchive} style={BTN_STYLE}>Close</button>
              </div>
            </div>
            {archivedError && <div style={{ color: '#f88' }}>{archivedError}</div>}
            {archivedLoading ? (
              <div style={{ color: '#777' }}>Loading archived plans...</div>
            ) : archivedPlans.length === 0 ? (
              <div style={{ color: '#777' }}>No archived plans yet.</div>
            ) : (
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: '0 0 260px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {archivedPlans.map((plan) => (
                    <div
                      key={plan.id}
                      style={{ border: '1px solid #333', borderRadius: 8, padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
                    >
                      <button onClick={() => openArchivedPlan(plan)} style={BTN_STYLE}>
                        {plan.name}
                      </button>
                      <button onClick={() => handleDeleteArchivedPlan(plan)} style={BTN_STYLE}>Delete</button>
                    </div>
                  ))}
                </div>
                <div style={{ flex: 1, minWidth: 320, border: '1px solid #333', borderRadius: 8, padding: 12, maxHeight: '60vh', overflowY: 'auto' }}>
                  {!viewArchivedPlan ? (
                    <div style={{ color: '#777' }}>Select an archived plan to view details.</div>
                  ) : viewArchivedLoading ? (
                    <div style={{ color: '#777' }}>Loading sessions...</div>
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
                                        const entry = session?.entries?.find((entry) => entry.exerciseName === item.exerciseName) || null;
                                        const sets = entry?.sets ?? [];
                                        const rowCount = Math.max(item.targetSets, sets.length);
                                        return (
                                          <div key={item.id} style={{ border: '1px solid #444', borderRadius: 8, padding: 8 }}>
                                            <div style={{ fontWeight: 600 }}>{item.exerciseName}</div>
                                            <div style={{ fontSize: 12, color: '#aaa', marginBottom: 6 }}>
                                              Target: {item.targetSets} set{item.targetSets === 1 ? '' : 's'}
                                              {item.targetReps ? ` - ${item.targetReps}` : ''}
                                            </div>
                                            {rowCount === 0 ? (
                                              <div style={{ color: '#777' }}>No recorded sets.</div>
                                            ) : (
                                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                                <thead>
                                                  <tr style={{ textAlign: 'left' }}>
                                                    <th style={{ paddingBottom: 4, borderBottom: '1px solid #333' }}>Set</th>
                                                    <th style={{ paddingBottom: 4, borderBottom: '1px solid #333' }}>Weight</th>
                                                    <th style={{ paddingBottom: 4, borderBottom: '1px solid #333' }}>Reps</th>
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {Array.from({ length: rowCount }).map((_, idx) => {
                                                    const recorded = sets[idx];
                                                    return (
                                                      <tr key={idx} style={{ borderBottom: '1px solid #222' }}>
                                                        <td style={{ padding: '4px 0' }}>{idx + 1}</td>
                                                        <td style={{ padding: '4px 0' }}>{recorded?.weight ?? '-'}</td>
                                                        <td style={{ padding: '4px 0' }}>{recorded?.reps ?? '-'}</td>
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
    </div>
  );
}
function WorkoutPage({
  plan,
  day,
  session,
  setSession,
  onMarkDone,
  completed,
  setCompleted,
  isLastDay,
  onFinishPlan,
  finishingPlan,
}: {
  plan: Plan;
  day: PlanDay;
  session: Session | null;
  setSession: React.Dispatch<React.SetStateAction<Session | null>>;
  onMarkDone: () => void;
  completed: boolean;
  setCompleted: (value: boolean) => void | Promise<void>;
  isLastDay: boolean;
  onFinishPlan?: () => void;
  finishingPlan: boolean;
}) {
  const [ghost, setGhost] = useState<Record<string, { weight: number | null; reps: number | null }[]>>({});

  const currentWeek = useMemo(
    () => plan.weeks.find((w) => w.days.some((d) => d.id === day.id)) || null,
    [plan.weeks, day.id]
  );
  const currentWeekId = currentWeek?.id ?? null;

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
                ghostMap[entry.exerciseName] = (entry.sets ?? []).map((set: Partial<SessionSetPayload>) => ({
                  weight: set.weight ?? null,
                  reps: set.reps ?? null,
                }));
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
    if (!serverId) {
      setCompleted(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await sessionApi.status(serverId, currentWeekId, day.id);
        if (!cancelled) setCompleted(!!res?.completed);
      } catch {
        if (!cancelled) setCompleted(false);
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

    (async () => {
      try {
        const wIdx = plan.weeks.findIndex((w) => w.days.some((d) => d.id === day.id));
        if (wIdx <= 0) return;

        const currWeek = plan.weeks[wIdx];
        const dayIdx = currWeek.days.findIndex((d) => d.id === day.id);
        if (dayIdx < 0) {
          setGhost({});
          return;
        }

        const prevWeek = plan.weeks[wIdx - 1];
        const prevDay = prevWeek.days[dayIdx];
        if (!prevDay) {
          setGhost({});
          return;
        }

        let ghostData: SessionPayload | null = null;
        if (serverId) {
          try {
            ghostData = await sessionApi.last(serverId, prevWeek.id, prevDay.id);
          } catch {
            /* ignore and try local */
          }
        }

        if (!ghostData || !ghostData.entries) {
          // Try localStorage fallback (handles unsaved plans and pre-save sessions)
          const keysToTry: string[] = [];
          if (serverId) keysToTry.push(`session:${serverId}:${prevWeek.id}:${prevDay.id}`);
          keysToTry.push(`session:${plan.id}:${prevWeek.id}:${prevDay.id}`);
          for (const k of keysToTry) {
            try {
              const raw = localStorage.getItem(k);
              if (raw) {
                const parsed = JSON.parse(raw) as SessionPayload;
                if (parsed && parsed.entries) {
                  ghostData = parsed;
                  break;
                }
              }
            } catch {
              /* ignore */
            }
          }
        }

        if (!ghostData || !ghostData.entries) {
          setGhost({});
          return;
        }

        const map: Record<string, { weight: number | null; reps: number | null }[]> = {};
        for (const entry of ghostData.entries) {
          map[entry.exerciseName] = (entry.sets || []).map((s: Partial<SessionSetPayload>) => ({
            weight: s.weight ?? null,
            reps: s.reps ?? null,
          }));
        }
        setGhost(map);
      } catch {
        setGhost({});
      }
    })();
  }, [plan.serverId, currentWeekId, plan.weeks, day.id, plan.id]);

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

  if (!session || session.planDayId !== day.id) return null;

  const getGhost = (exerciseName: string, idx: number) => {
    const arr = ghost[exerciseName];
    if (!arr || !arr[idx]) return { weight: null, reps: null };
    return arr[idx];
  };

  const saveNow = (next: Session) => {
    try {
      localStorage.setItem(
        `session:${plan.serverId ?? plan.id}:${next.planWeekId}:${next.planDayId}`,
        JSON.stringify(next)
      );
    } catch { void 0; }
    const serverId = plan.serverId;
    if (!serverId) return;
    sessionApi.save(serverId, next.planWeekId, next.planDayId, next).catch(() => void 0);
  };

  const markSessionCompleted = (flag: boolean) => {
    setSession((prev) => {
      if (!prev) return prev;
      const next: Session = { ...prev, completed: flag };
      saveNow(next);
      return next;
    });
  };

  const addSetToEntry = (entryId: string) => {
    setSession((s) => {
      if (!s) return s;
      const next: Session = {
        ...s,
        entries: s.entries.map((entry) =>
          entry.id === entryId
            ? { ...entry, sets: [...entry.sets, { id: uuid(), setIndex: entry.sets.length, weight: null, reps: null }] }
            : entry
        ),
      };
      saveNow(next);
      return next;
    });
  };

  const removeLastSetFromEntry = (entryId: string) => {
    setSession((s) => {
      if (!s) return s;
      const next: Session = {
        ...s,
        entries: s.entries.map((entry) =>
          entry.id === entryId
            ? { ...entry, sets: entry.sets.slice(0, -1) }
            : entry
        ),
      };
      saveNow(next);
      return next;
    });
  };

  const updateSet = (entryId: string, setId: string, patch: Partial<SessionSet>) => {
    setSession((s) => {
      if (!s) return s;
      const next: Session = {
        ...s,
        entries: s.entries.map((entry) =>
          entry.id === entryId
            ? {
                ...entry,
                sets: entry.sets.map((set) => (set.id === setId ? { ...set, ...patch } : set)),
              }
            : entry
        ),
      };
      saveNow(next);
      return next;
    });
  };

  

  const handleDone = async () => {
    markSessionCompleted(true);
    await onMarkDone();
  };


  return (
    <div>
      {session.entries.map((entry) => (
        <div key={entry.id} style={{ border: '1px solid #444', borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>{entry.exerciseName}</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => addSetToEntry(entry.id)} style={BTN_STYLE}>+ Set</button>
              <button onClick={() => removeLastSetFromEntry(entry.id)} style={BTN_STYLE}>- Set</button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8, color: '#777' }}>
            <div>Set</div>
            <div>Weight</div>
            <div>Reps</div>
          </div>

          {entry.sets.map((set, i) => {
            const ghostSet = getGhost(entry.exerciseName, i);
            return (
              <div key={set.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div style={{ alignSelf: 'center' }}>{i + 1}</div>
                <input
                  inputMode="decimal"
                  placeholder={ghostSet.weight == null ? '' : String(ghostSet.weight)}
                  value={set.weight ?? ''}
                  onChange={(e) =>
                    updateSet(entry.id, set.id, {
                      weight: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                  style={{ padding: 8, borderRadius: 8, border: '1px solid #444', opacity: set.weight == null ? 0.9 : 1 }}
                />
                <input
                  inputMode="numeric"
                  placeholder={ghostSet.reps == null ? '' : String(ghostSet.reps)}
                  value={set.reps ?? ''}
                  onChange={(e) =>
                    updateSet(entry.id, set.id, {
                      reps: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                  style={{ padding: 8, borderRadius: 8, border: '1px solid #444', opacity: set.reps == null ? 0.9 : 1 }}
                />
              </div>
            );
          })}

          {entry.sets.length === 0 && <div style={{ color: '#777' }}>No sets yet.</div>}
        </div>
      ))}

      <div
        style={{
          marginTop: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={completed}
            onChange={(e) => {
              const value = e.target.checked;
              markSessionCompleted(value);
              setCompleted(value);
            }}
          />
          Completed
        </label>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
    </div>
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

  

  const mapServerTemplate = (row: ServerPlanRow): Plan => {
    const d = (row?.data ?? {}) as ServerPlanData;
    const weeks: PlanWeek[] = Array.isArray(d.weeks)
      ? (d.weeks as ServerPlanWeek[]).map((week) => ({
          id: week.id ?? uuid(),
          name: week.name ?? "Week",
          days: (week.days ?? []).map((day: ServerPlanDayRow) => ({
            id: day.id ?? uuid(),
            name: day.name ?? "Day",
            items: (day.items ?? []).map((item: ServerPlanItemRow) => ({
              id: item.id ?? uuid(),
              exerciseName: item.exerciseName ?? "Exercise",
              targetSets: Number(item.targetSets) || 0,
              targetReps: item.targetReps ?? "",
            })),
          })),
        }))
      : [];
    return { id: uuid(), serverId: row.id, name: row.name ?? "Template", weeks };
  };

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
      const payload = { weeks: selectedPlan.weeks };
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

  

  return (
    <div style={{ border: '1px solid #444', borderRadius: 12, padding: 12, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setShowPlanList(true)} style={BTN_STYLE}>
            Manage Plans & Templates
          <button onClick={handleCreatePlan} style={BTN_STYLE}>
            + Plan
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

      {error && <div style={{ color: '#f88', marginTop: 8 }}>{error}</div>}

      {!selectedPlan ? (
        <div style={{ marginTop: 16, color: '#777' }}>Create a plan to get started.</div>
      ) : (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Plan Name</label>
            <input
              value={selectedPlan.name}
              onChange={(e) => handlePlanNameChange(e.target.value)}
              style={{ padding: 8, borderRadius: 8, border: '1px solid #444', width: '100%' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {selectedPlan.weeks.map((week) => (
              <div key={week.id} style={{ border: '1px solid #444', borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      value={week.name}
                      onChange={(e) => handleWeekNameChange(week.id, e.target.value)}
                      style={{ padding: 6, borderRadius: 8, border: '1px solid #444', minWidth: 140 }}
                    />
                    <button onClick={() => handleAddDay(week.id)} style={SMALL_BTN_STYLE}>
                      + Day
                    </button>
                  </div>
                  <button onClick={() => handleRemoveWeek(week.id)} style={SMALL_BTN_STYLE} disabled={selectedPlan.weeks.length <= 1}>
                    Delete Week
                  </button>
                </div>

                {week.days.map((day) => (
                  <div key={day.id} style={{ border: '1px solid #333', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                          value={day.name}
                          onChange={(e) => handleDayNameChange(week.id, day.id, e.target.value)}
                          style={{ padding: 6, borderRadius: 8, border: '1px solid #444', minWidth: 120 }}
                        />
                        <button onClick={() => handleAddExercise(week.id, day.id)} style={SMALL_BTN_STYLE}>
                          + Exercise
                        </button>
                      </div>
                      <button onClick={() => handleRemoveDay(week.id, day.id)} style={SMALL_BTN_STYLE} disabled={week.days.length <= 1}>
                        Delete Day
                      </button>
                    </div>

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
                                  gridTemplateColumns: 'auto 2fr 1fr 1fr auto',
                                  gap: 8,
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
                                  onChange={(e) => handleExerciseChange(week.id, day.id, item.id, { exerciseName: e.target.value })}
                                  style={{ padding: 6, borderRadius: 8, border: '1px solid #444' }}
                                  placeholder="Exercise name"
                                />
                              <select
                                value={String(item.targetSets)}
                                onChange={(e) =>
                                  handleExerciseChange(week.id, day.id, item.id, {
                                    targetSets: Number(e.target.value),
                                  })
                                }
                                style={{ padding: 6, borderRadius: 8, border: '1px solid #444' }}
                              >
                                {options.map((count) => (
                                  <option key={count} value={count}>
                                    {count} {count === 1 ? 'set' : 'sets'}
                                  </option>
                                ))}
                              </select>
                              <input
                                value={item.targetReps ?? ''}
                                onChange={(e) => handleExerciseChange(week.id, day.id, item.id, { targetReps: e.target.value })}
                                style={{ padding: 6, borderRadius: 8, border: '1px solid #444' }}
                                placeholder="Reps / notes"
                              />
                              <button onClick={() => handleRemoveExercise(week.id, day.id, item.id)} style={SMALL_BTN_STYLE}>
                                Remove
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
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {showPlanList && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 16, zIndex: 10 }}>
          <div style={{ background: '#111', border: '1px solid #444', borderRadius: 12, padding: 16, maxWidth: 420, width: '100%', maxHeight: '80vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Manage Plans & Templates</h3>
              <button onClick={() => setShowPlanList(false)} style={BTN_STYLE}>
                Close
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setManageTab('plans')} style={BTN_STYLE} aria-pressed={manageTab==='plans'}>Plans</button>
              <button onClick={() => setManageTab('templates')} style={BTN_STYLE} aria-pressed={manageTab==='templates'}>Templates</button>
            </div>
            {manageTab === 'plans' ? (
              <>
                {plans.length === 0 && <div style={{ color: '#777' }}>No plans yet.</div>}
                {plans.map((plan) => (
                  <div key={plan.id} style={{ border: '1px solid #333', borderRadius: 8, padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{plan.name}</div>
                      {plan.serverId && <div style={{ fontSize: 12, color: '#777' }}>Synced</div>}
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
                      <button onClick={() => handleDeletePlan(plan.id)} style={SMALL_BTN_STYLE}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <>
                {templatesError && <div style={{ color: '#f88' }}>{templatesError}</div>}
                {templatesLoading ? (
                  <div style={{ color: '#777' }}>Loading templates...</div>
                ) : templates.length === 0 ? (
                  <div style={{ color: '#777' }}>No templates yet.</div>
                ) : (
                  templates.map((tpl) => (
                    <div key={tpl.id} style={{ border: '1px solid #333', borderRadius: 8, padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{tpl.name}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => openTemplate(tpl)} style={SMALL_BTN_STYLE}>Open</button>
                        <button onClick={() => renameTemplate(tpl)} style={SMALL_BTN_STYLE}>Rename</button>
                        <button onClick={() => deleteTemplate(tpl)} style={SMALL_BTN_STYLE}>Delete</button>
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
