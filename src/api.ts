// api.ts – Supabase-backed API used by the app
import { supabase } from './supabaseClient'

export type ServerPlanItem = { id?: string; exerciseId?: string; exerciseName?: string; targetSets?: number; targetReps?: string };
export type ServerPlanDay = { id?: string; name?: string; items?: ServerPlanItem[] };
export type ServerPlanWeek = { id?: string; name?: string; days?: ServerPlanDay[] };
export type ServerPlanData = { weeks?: ServerPlanWeek[]; days?: ServerPlanDay[] };
export type ServerPlanRow = { id: string; name?: string; data?: ServerPlanData; archived?: 0 | 1 | boolean; predecessor_plan_id?: string | null };
export type SessionSetPayload = { id: string; setIndex: number; weight: number | null; reps: number | null };
export type SessionEntryPayload = { id: string; exerciseId?: string; exerciseName: string; sets: SessionSetPayload[] };
export type SessionPayload = { id: string; planId: string; planWeekId: string; planDayId: string; date: string; entries: SessionEntryPayload[]; completed?: boolean; ghostSeed?: boolean };
export type ExerciseRow = { id: string | number; name?: string | null };
export type CustomExerciseRow = {
  id: string | number;
  name?: string | null;
  primary_muscle?: string | null;
  machine?: boolean | null;
  free_weight?: boolean | null;
  cable?: boolean | null;
  body_weight?: boolean | null;
  is_compound?: boolean | null;
  is_custom?: boolean | null;
};
export type ExerciseCatalogRow = {
  id: string | number;
  name?: string | null;
  primary_muscle?: string | null;
  machine?: boolean | null;
  free_weight?: boolean | null;
  cable?: boolean | null;
  body_weight?: boolean | null;
  is_compound?: boolean | null;
  secondary_muscles?: string[] | null;
};
export type SessionRow = { plan_id: string | number; week_id: string; day_id: string; updated_at?: string | null; data?: SessionPayload | null };
// Helper to generate a UUID for tables that may not have a default
const genUuid = () => (
  typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      })
);

export const api = {
  async me(): Promise<{ id: number; username: string } | null> {
    const { data } = await supabase.auth.getUser();
    const email = data?.user?.email || null;
    return email ? { id: 0, username: email } : null;
  },
  async logout(): Promise<{ ok: true }> { await supabase.auth.signOut(); return { ok: true }; },
};

const isMissingTableError = (error: { code?: string; message?: string } | null | undefined) => {
  if (!error) return false;
  const code = error.code || '';
  const message = String(error.message || '').toLowerCase();
  return code === '42P01' || message.includes('does not exist') || message.includes('not found');
};

export const exerciseApi = {
  async list(): Promise<ExerciseRow[]> {
    const { data, error } = await supabase.from('exercises').select('id,name').order('name', { ascending: true });
    if (error) {
      if (isMissingTableError(error as { code?: string; message?: string })) return [];
      throw error;
    }
    return (data ?? []) as ExerciseRow[];
  },
  async findByName(name: string): Promise<ExerciseRow | null> {
    const clean = name.trim();
    if (!clean) return null;
    const { data, error } = await supabase
      .from('exercises')
      .select('id,name')
      .ilike('name', clean)
      .limit(1)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error as { code?: string; message?: string })) return null;
      throw error;
    }
    return (data as ExerciseRow | null) ?? null;
  },
  async findOrCreate(name: string): Promise<ExerciseRow | null> {
    const clean = name.trim();
    if (!clean) return null;
    const existing = await exerciseApi.findByName(clean);
    if (existing) return existing;
    const { data, error } = await supabase
      .from('exercises')
      .insert([{ name: clean }])
      .select('id,name')
      .single();
    if (error) {
      if (isMissingTableError(error as { code?: string; message?: string })) return null;
      const code = (error as { code?: string }).code || '';
      if (code === '23505' || String(error.message || '').toLowerCase().includes('duplicate')) {
        const retry = await exerciseApi.findByName(clean);
        return retry;
      }
      throw error;
    }
    return (data as ExerciseRow | null) ?? null;
  },
  async listCustom(): Promise<CustomExerciseRow[]> {
    const { data, error } = await supabase
      .from('exercises')
      .select('id,name,primary_muscle,machine,free_weight,cable,body_weight,is_compound,is_custom')
      .eq('is_custom', true)
      .order('name', { ascending: true });
    if (error) {
      if (isMissingTableError(error as { code?: string; message?: string })) return [];
      throw error;
    }
    return (data ?? []) as CustomExerciseRow[];
  },
  async createCustom(input: {
    name: string;
    primary_muscle: string;
    machine: boolean;
    free_weight: boolean;
    cable: boolean;
    body_weight: boolean;
    is_compound: boolean;
  }): Promise<CustomExerciseRow | null> {
    const clean = input.name.trim();
    if (!clean) return null;
    const { data, error } = await supabase
      .from('exercises')
      .insert([{
        name: clean,
        primary_muscle: input.primary_muscle,
        machine: input.machine,
        free_weight: input.free_weight,
        cable: input.cable,
        body_weight: input.body_weight,
        is_compound: input.is_compound,
        is_custom: true,
      }])
      .select('id,name,primary_muscle,machine,free_weight,cable,body_weight,is_compound,is_custom')
      .single();
    if (error) {
      if (isMissingTableError(error as { code?: string; message?: string })) return null;
      const code = (error as { code?: string }).code || '';
      if (code === '23505' || String(error.message || '').toLowerCase().includes('duplicate')) {
        const retry = await supabase
          .from('exercises')
          .update({
            primary_muscle: input.primary_muscle,
            machine: input.machine,
            free_weight: input.free_weight,
            cable: input.cable,
            body_weight: input.body_weight,
            is_compound: input.is_compound,
            is_custom: true,
          })
          .ilike('name', clean)
          .select('id,name,primary_muscle,machine,free_weight,cable,body_weight,is_compound,is_custom')
          .maybeSingle();
        if (retry.error) throw retry.error;
        return (retry.data as CustomExerciseRow | null) ?? null;
      }
      throw error;
    }
    return (data as CustomExerciseRow | null) ?? null;
  },
  async deleteCustom(id: string | number): Promise<boolean> {
    const idValue =
      typeof id === 'number'
        ? id
        : /^\d+$/.test(String(id))
          ? Number(id)
          : String(id);
    const { data, error } = await supabase
      .from('exercises')
      .delete()
      .match({ id: idValue, is_custom: true })
      .select('id')
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error as { code?: string; message?: string })) return false;
      throw error;
    }
    return !!data;
  },
};

export const exerciseCatalogApi = {
  async list(): Promise<ExerciseCatalogRow[]> {
    const { data, error } = await supabase
      .from('exercise_catalog')
      .select('id,name,primary_muscle,machine,free_weight,cable,body_weight,is_compound,secondary_muscles')
      .order('primary_muscle', { ascending: true })
      .order('name', { ascending: true });
    if (error) {
      if (isMissingTableError(error as { code?: string; message?: string })) return [];
      throw error;
    }
    return (data ?? []) as ExerciseCatalogRow[];
  },
};

export const planApi = {
  async list(): Promise<ServerPlanRow[]> {
    const { data, error } = await supabase.from('plans').select('id,name,data,archived,predecessor_plan_id').eq('archived', 0).order('id', { ascending: false });
    if (error) throw error; return (data ?? []) as unknown as ServerPlanRow[];
  },
  async create(name: string, data: ServerPlanData): Promise<ServerPlanRow> {
    const { data: row, error } = await supabase.from('plans').insert([{ name, data, archived: 0 }]).select('id,name,data,archived,predecessor_plan_id').single();
    if (error) throw error; return row as unknown as ServerPlanRow;
  },
  async update(id: string, name: string, data: ServerPlanData): Promise<ServerPlanRow> {
    const { data: row, error } = await supabase.from('plans').update({ name, data }).eq('id', id).select('id,name,data,archived,predecessor_plan_id').single();
    if (error) throw error; return row as unknown as ServerPlanRow;
  },
  async remove(id: string): Promise<{ ok: true }> { const { error } = await supabase.from('plans').delete().eq('id', id); if (error) throw error; return { ok: true }; },
  async archive(id: string): Promise<{ ok: true; id: string }> { const { error } = await supabase.from('plans').update({ archived: 1 }).eq('id', id); if (error) throw error; return { ok: true, id }; },
  async unarchive(id: string): Promise<{ ok: true; id: string }> { const { error } = await supabase.from('plans').update({ archived: 0 }).eq('id', id); if (error) throw error; return { ok: true, id }; },
  async listArchived(): Promise<ServerPlanRow[]> { const { data, error } = await supabase.from('plans').select('id,name,data,archived,predecessor_plan_id').eq('archived', 1).order('id', { ascending: false }); if (error) throw error; return (data ?? []) as unknown as ServerPlanRow[]; },
  async rollover(id: string): Promise<ServerPlanRow> {
    const { data: plan, error: e1 } = await supabase.from('plans').select('id,name,data').eq('id', id).single(); if (e1) throw e1;
    const currentName = String((plan as { name?: string } | null)?.name || 'Plan'); const match = currentName.match(/\(#(\d+)\)\s*$/); const nextN = match ? Number(match[1]) + 1 : 2; const base = match ? currentName.replace(/\(#\d+\)\s*$/, '').trim() : currentName.trim(); const newName = `${base} (#${nextN})`;
    const { error: e2 } = await supabase.from('plans').update({ archived: 1 }).eq('id', id); if (e2) throw e2;
    const { data: newRow, error: e3 } = await supabase.from('plans').insert([{ name: newName, data: (plan as { data?: ServerPlanData } | null)?.data ?? {}, archived: 0, predecessor_plan_id: id }]).select('id,name,data,archived,predecessor_plan_id').single(); if (e3) throw e3; return newRow as unknown as ServerPlanRow;
  },
};

// prefsApi removed; use src/api/userPrefs.ts instead

export const sessionApi = {
  async save(planServerId: number | string, planWeekId: string, planDayId: string, session: SessionPayload): Promise<{ ok: true }> {
    // Be defensive about plan_id type: numeric if possible, else string
    const pidNumeric =
      typeof planServerId === 'number'
        ? planServerId
        : /^\d+$/.test(planServerId)
          ? Number(planServerId)
          : undefined;
    const planIdForRow: number | string = pidNumeric !== undefined ? pidNumeric : String(planServerId);

    // Use upsert to handle insert-or-update in a single call (avoids PATCH 406 on first save)
    // Update first; if no row matched, insert. Avoids 406/400 noise.
    const upd = await supabase
      .from('sessions')
      .update({ data: session })
      .match({ plan_id: planIdForRow, week_id: planWeekId, day_id: planDayId })
      .select('plan_id');
    if (upd.error && (!('code' in upd.error) || (upd.error as any).code !== 'PGRST116')) throw upd.error;
    if (Array.isArray((upd as any).data) && (upd as any).data.length > 0) return { ok: true };

    const ins = await supabase
      .from('sessions')
      .insert([{ id: genUuid(), plan_id: planIdForRow, week_id: planWeekId, day_id: planDayId, data: session }])
      .select('plan_id')
      .single();
    if (ins.error) throw ins.error;
    return { ok: true };
  },
  async complete(planServerId: number | string, planWeekId: string, planDayId: string, completed?: boolean): Promise<{ ok: true }> {
    if (completed) {
      const upd = await supabase
        .from('completions')
        .update({ completed_at: new Date().toISOString() })
        .match({ plan_id: planServerId, week_id: planWeekId, day_id: planDayId })
        .select('plan_id');
      if (upd.error && (!('code' in upd.error) || (upd.error as any).code !== 'PGRST116')) throw upd.error;
      if (Array.isArray((upd as any).data) && (upd as any).data.length > 0) return { ok: true };

      const ins = await supabase
        .from('completions')
        .insert([{ id: genUuid(), plan_id: planServerId, week_id: planWeekId, day_id: planDayId, completed_at: new Date().toISOString() }])
        .select('plan_id')
        .single();
      if (ins.error) throw ins.error;
    } else {
      const { error } = await supabase
        .from('completions')
        .delete()
        .match({ plan_id: planServerId, week_id: planWeekId, day_id: planDayId });
      if (error) throw error;
    }
    return { ok: true };
  },
  async lastCompleted(planServerId: number | string): Promise<{ week_id: string; day_id: string } | null> {
    const { data } = await supabase.from('completions').select('week_id,day_id,completed_at').eq('plan_id', planServerId).order('completed_at', { ascending: false }).limit(1).maybeSingle(); return (data as { week_id: string; day_id: string } | null) ?? null;
  },
  async last(planServerId: number | string, planWeekId: string, planDayId: string): Promise<SessionPayload | null> {
    const { data } = await supabase.from('sessions').select('data').match({ plan_id: planServerId, week_id: planWeekId, day_id: planDayId }).maybeSingle(); return (data as { data?: SessionPayload } | null)?.data ?? null;
  },
  async status(planServerId: number | string, planWeekId: string, planDayId: string): Promise<{ completed: boolean }> {
    const { data } = await supabase.from('completions').select('plan_id').match({ plan_id: planServerId, week_id: planWeekId, day_id: planDayId }).maybeSingle(); return { completed: !!data };
  },
  async completedList(planServerId: number | string): Promise<Array<{ week_id: string; day_id: string }>> {
    const { data } = await supabase.from('completions').select('week_id,day_id').eq('plan_id', planServerId).order('completed_at', { ascending: true }); return (data ?? []) as Array<{ week_id: string; day_id: string }>;
  },
  async listAll(): Promise<SessionRow[]> {
    const { data, error } = await supabase
      .from('sessions')
      .select('plan_id,week_id,day_id,updated_at,data')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as SessionRow[];
  },
};

export type ServerTemplateRow = ServerPlanRow;
export const templateApi = {
  async list(): Promise<ServerTemplateRow[]> { const { data, error } = await supabase.from('templates').select('id,name,data').order('id', { ascending: false }); if (error) throw error; return (data ?? []) as unknown as ServerTemplateRow[]; },
  async create(name: string, data: ServerPlanData): Promise<ServerTemplateRow> { const { data: row, error } = await supabase.from('templates').insert([{ name, data }]).select('id,name,data').single(); if (error) throw error; return row as unknown as ServerTemplateRow; },
  async update(id: string, name: string, data: ServerPlanData): Promise<ServerTemplateRow> { const { data: row, error } = await supabase.from('templates').update({ name, data }).eq('id', id).select('id,name,data').single(); if (error) throw error; return row as unknown as ServerTemplateRow; },
  async remove(id: string): Promise<{ ok: true }> { const { error } = await supabase.from('templates').delete().eq('id', id); if (error) throw error; return { ok: true }; },
};
