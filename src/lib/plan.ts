import type { Plan, PlanDay, PlanWeek, Session, SessionEntry, SessionSet } from '../types';
import type {
  ServerPlanData,
  ServerPlanWeek,
  ServerPlanDay as ServerPlanDayRow,
  ServerPlanItem as ServerPlanItemRow,
} from '../api';
import { uuid, fixMojibake, normalizeExerciseName } from './utils';

export function startSessionFromDay(plan: Plan, weekId: string, dayId: string): Session {
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

export function mergeSessionWithDay(planDay: PlanDay, prev: Session): Session {
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

export function mapRowToWeeks(d: ServerPlanData, { includeLegacyFlatDays = false } = {}): PlanWeek[] {
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

export function firstWeekDayOf(plan: Plan) {
  const wk = plan.weeks[0] ?? null;
  const dy = wk?.days[0] ?? null;
  return { weekId: wk?.id ?? null, dayId: dy?.id ?? null };
}

export function nextWeekDay(plan: Plan, currentWeekId: string, currentDayId: string) {
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

export function prevWeekDay(plan: Plan, currentWeekId: string, currentDayId: string) {
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
