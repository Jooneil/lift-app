// api.ts – client helpers for server API
// Works with App.tsx imports: { api, planApi, prefsApi, sessionApi }
// and supports sessionApi.complete(..., completed?)

export type ServerPlanItem = {
  id?: string;
  exerciseName?: string;
  targetSets?: number;
  targetReps?: string;
};

export type ServerPlanDay = {
  id?: string;
  name?: string;
  items?: ServerPlanItem[];
};

export type ServerPlanWeek = {
  id?: string;
  name?: string;
  days?: ServerPlanDay[];
};

export type ServerPlanData = {
  weeks?: ServerPlanWeek[];
  days?: ServerPlanDay[];
};

export type ServerPlanRow = {
  id: number;
  name?: string;
  data?: ServerPlanData;
  archived?: 0 | 1 | boolean;
  predecessor_plan_id?: number | null;
};

export type SessionSetPayload = {
  id: string;
  setIndex: number;
  weight: number | null;
  reps: number | null;
};

export type SessionEntryPayload = {
  id: string;
  exerciseName: string;
  sets: SessionSetPayload[];
};

export type SessionPayload = {
  id: string;
  planId: string;
  planWeekId: string;
  planDayId: string;
  date: string;
  entries: SessionEntryPayload[];
  completed?: boolean;
  ghostSeed?: boolean;
};

const BASE = ""; // same origin (Vite proxy or same host)

// ---------- tiny fetch helpers ----------
async function j<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
    ...opts,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const data: unknown = await res.json();
      if (data && typeof data === "object" && "error" in data) {
        const errObj = data as { error?: string };
        if (errObj.error) msg = errObj.error;
      }
    } catch { void 0; }
    throw new Error(msg);
  }
  // 204 no content?
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

// ---------- auth ----------
export const api = {
  me(): Promise<{ id: number; username: string } | null> {
    return j("/api/me");
  },
  supaSession(accessToken: string): Promise<{ id: number; username: string }> {
    return j("/api/supa/session", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
  },
  login(username: string, password: string): Promise<{ id: number; username: string }> {
    return j("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
  },
  register(username: string, password: string): Promise<{ id: number; username: string }> {
    return j("/api/register", { method: "POST", body: JSON.stringify({ username, password }) });
  },
  logout(): Promise<{ ok: true }> {
    return j("/api/logout", { method: "POST" });
  },
};

// ---------- plans ----------
export const planApi = {
  list(): Promise<ServerPlanRow[]> {
    return j("/api/plans");
  },
  create(name: string, data: ServerPlanData): Promise<ServerPlanRow> {
    return j("/api/plans", { method: "POST", body: JSON.stringify({ name, data }) });
  },
  update(id: number, name: string, data: ServerPlanData): Promise<ServerPlanRow> {
    return j(`/api/plans/${id}`, { method: "PUT", body: JSON.stringify({ name, data }) });
  },
  remove(id: number): Promise<{ ok: true }> {
    return j(`/api/plans/${id}`, { method: "DELETE" });
  },

  // archive helpers (server endpoints you already added)
  archive(id: number): Promise<{ ok: true; id: number }> {
    return j(`/api/plans/${id}/archive`, { method: "POST" });
  },
  unarchive(id: number): Promise<{ ok: true; id: number }> {
    return j(`/api/plans/${id}/unarchive`, { method: "POST" });
  },
  listArchived(): Promise<ServerPlanRow[]> {
    return j("/api/plans?archived=1");
  },
  rollover(id: number): Promise<ServerPlanRow> {
    return j(`/api/plans/${id}/rollover`, { method: "POST" });
  },
};

// ---------- templates ----------
export type ServerTemplateRow = ServerPlanRow;

export const templateApi = {
  list(): Promise<ServerTemplateRow[]> {
    return j("/api/templates");
  },
  create(name: string, data: ServerPlanData): Promise<ServerTemplateRow> {
    return j("/api/templates", { method: "POST", body: JSON.stringify({ name, data }) });
  },
  update(id: number, name: string, data: ServerPlanData): Promise<ServerTemplateRow> {
    return j(`/api/templates/${id}`, { method: "PUT", body: JSON.stringify({ name, data }) });
  },
  remove(id: number): Promise<{ ok: true }> {
    return j(`/api/templates/${id}`, { method: "DELETE" });
  },
};

// ---------- prefs (last plan/week/day) ----------
export const prefsApi = {
  async get(): Promise<{ lastPlanServerId?: number; lastWeekId?: string; lastDayId?: string } | null> {
    try {
      return await j("/api/prefs");
    } catch (err) {
      if (err instanceof Error && /404/.test(err.message)) {
        return null;
      }
      throw err;
    }
  },
  save(lastPlanServerId: number | null, lastWeekId: string | null, lastDayId: string | null): Promise<{ ok: true }> {
    return j("/api/prefs", {
      method: "PUT",
      body: JSON.stringify({ lastPlanServerId, lastWeekId, lastDayId }),
    });
  },
};

// ---------- session (workout logs) ----------
export const sessionApi = {
  // save arbitrary session blob
  save(
    planServerId: number,
    planWeekId: string,
    planDayId: string,
    session: SessionPayload
  ): Promise<{ ok: true }> {
    return j("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        planServerId,
        weekId: planWeekId,
        dayId: planDayId,
        data: session,
      }),
    });
  },

  // mark complete; optional 4th boolean lets you set/unset completion
  // Your App.tsx calls: complete(id, weekId, dayId, true) and complete(id, weekId, dayId, val)
  complete(
    planServerId: number,
    planWeekId: string,
    planDayId: string,
    completed?: boolean
  ): Promise<{ ok: true }> {
    const body: { planServerId: number; weekId: string; dayId: string; completed?: boolean } = {
      planServerId,
      weekId: planWeekId,
      dayId: planDayId,
    };
    if (typeof completed === "boolean") body.completed = completed;
    return j("/api/completed", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  // last completed day for a plan (server should return { week_id, day_id } or null)
  lastCompleted(planServerId: number): Promise<{ week_id: string; day_id: string } | null> {
    return j(`/api/completed/last?planServerId=${encodeURIComponent(String(planServerId))}`);
  },

  // last saved session blob for a specific week/day (used for ghosting)
  last(
    planServerId: number,
    planWeekId: string,
    planDayId: string
  ): Promise<SessionPayload | null> {
    const u = `/api/sessions/last?planServerId=${encodeURIComponent(
      String(planServerId)
    )}&weekId=${encodeURIComponent(planWeekId)}&dayId=${encodeURIComponent(planDayId)}`;
    return j(u);
  },
  status(planServerId: number, planWeekId: string, planDayId: string): Promise<{ completed: boolean }> {
    const url = `/api/completed/get?planServerId=${encodeURIComponent(String(planServerId))}&weekId=${encodeURIComponent(planWeekId)}&dayId=${encodeURIComponent(planDayId)}`;
    return j(url);
  },
  completedList(planServerId: number): Promise<Array<{ week_id: string; day_id: string }>> {
    const url = `/api/completed/all?planServerId=${encodeURIComponent(String(planServerId))}`;
    return j(url);
  },
};
