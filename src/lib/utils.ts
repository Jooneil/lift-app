import type { StreakConfig, StreakState } from '../api/userPrefs';

export const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

export const normalizeExerciseName = (name: string) => name.trim();
export const normalizeFilterValue = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
export const exerciseKey = (entry: { exerciseId?: string; exerciseName?: string | null }) => {
  if (entry.exerciseId) return `id:${entry.exerciseId}`;
  const name = normalizeExerciseName(entry.exerciseName || '').toLowerCase();
  return `name:${name}`;
};

export const parseBool = (value: string) => /^(true|1|yes|y)$/i.test(String(value || '').trim());

export function fixMojibake(value: unknown): string {
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

export const getUserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
};

export const toLocalDateString = (date: Date, timezone: string): string => {
  try {
    return date.toLocaleDateString('en-CA', { timeZone: timezone });
  } catch {
    return date.toISOString().split('T')[0];
  }
};

export const daysBetween = (startDateStr: string, endDate: Date, timezone: string): number => {
  const startStr = startDateStr.split('T')[0];
  const endStr = toLocalDateString(endDate, timezone);
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
};

export const isWorkoutDay = (config: StreakConfig, date: Date): boolean => {
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
      if (daysSinceStart < 0) return false;
      const dayInCycle = daysSinceStart % cycleLength;
      return dayInCycle < daysOn;
    }
    case 'weekly': {
      const dayOfWeek = new Date(toLocalDateString(date, timezone) + 'T12:00:00').getDay();
      return (config.weeklyDays ?? []).includes(dayOfWeek);
    }
    default:
      return false;
  }
};

export const checkStreakStatus = (
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
  const isHitToday = lastWorkoutStr === todayStr;

  if (!lastWorkoutStr) {
    return { currentStreak: 0, isHitToday: false, streakBroken: false };
  }

  let streakBroken = false;
  let checkDate = new Date(lastWorkoutStr + 'T12:00:00');
  checkDate.setDate(checkDate.getDate() + 1);
  const todayDate = new Date(todayStr + 'T12:00:00');

  while (checkDate < todayDate) {
    if (isWorkoutDay(config, checkDate)) {
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
