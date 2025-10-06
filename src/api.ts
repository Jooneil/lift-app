// api.ts – Supabase-backed API used by the app
import { supabase } from './supabaseClient'

export type ServerPlanItem = { id?: string; exerciseName?: string; targetSets?: number; targetReps?: string };
export type ServerPlanDay = { id?: string; name?: string; items?: ServerPlanItem[] };
export type ServerPlanWeek = { id?: string; name?: string; days?: ServerPlanDay[] };
export type ServerPlanData = { weeks?: ServerPlanWeek[]; days?: ServerPlanDay[] };
export type ServerPlanRow = { id: number; name?: string; data?: ServerPlanData; archived?: 0 | 1 | boolean; predecessor_plan_id?: number | null };
export type SessionSetPayload = { id: string; setIndex: number; weight: number | null; reps: number | null };
export type SessionEntryPayload = { id: string; exerciseName: string; sets: SessionSetPayload[] };
export type SessionPayload = { id: string; planId: string; planWeekId: string; planDayId: string; date: string; entries: SessionEntryPayload[]; completed?: boolean; ghostSeed?: boolean };
type SupabaseResp<T> = { data?: T | null; error?: { code?: string; message?: string } | null };

export const api = {
  async me(): Promise<{ id: number; username: string } | null> {
    const { data } = await supabase.auth.getUser();
    const email = data?.user?.email || null;
    return email ? { id: 0, username: email } : null;
  },
  async logout(): Promise<{ ok: true }> { await supabase.auth.signOut(); return { ok: true }; },
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
  async update(id: number, name: string, data: ServerPlanData): Promise<ServerPlanRow> {
    const { data: row, error } = await supabase.from('plans').update({ name, data }).eq('id', id).select('id,name,data,archived,predecessor_plan_id').single();
    if (error) throw error; return row as unknown as ServerPlanRow;
  },
  async remove(id: number): Promise<{ ok: true }> { const { error } = await supabase.from('plans').delete().eq('id', id); if (error) throw error; return { ok: true }; },
  async archive(id: number): Promise<{ ok: true; id: number }> { const { error } = await supabase.from('plans').update({ archived: 1 }).eq('id', id); if (error) throw error; return { ok: true, id }; },
  async unarchive(id: number): Promise<{ ok: true; id: number }> { const { error } = await supabase.from('plans').update({ archived: 0 }).eq('id', id); if (error) throw error; return { ok: true, id }; },
  async listArchived(): Promise<ServerPlanRow[]> { const { data, error } = await supabase.from('plans').select('id,name,data,archived,predecessor_plan_id').eq('archived', 1).order('id', { ascending: false }); if (error) throw error; return (data ?? []) as unknown as ServerPlanRow[]; },
  async rollover(id: number): Promise<ServerPlanRow> {
    const { data: plan, error: e1 } = await supabase.from('plans').select('id,name,data').eq('id', id).single(); if (e1) throw e1;
    const currentName = String((plan as { name?: string } | null)?.name || 'Plan'); const match = currentName.match(/\(#(\d+)\)\s*$/); const nextN = match ? Number(match[1]) + 1 : 2; const base = match ? currentName.replace(/\(#\d+\)\s*$/, '').trim() : currentName.trim(); const newName = `${base} (#${nextN})`;
    const { error: e2 } = await supabase.from('plans').update({ archived: 1 }).eq('id', id); if (e2) throw e2;
    const { data: newRow, error: e3 } = await supabase.from('plans').insert([{ name: newName, data: (plan as { data?: ServerPlanData } | null)?.data ?? {}, archived: 0, predecessor_plan_id: id }]).select('id,name,data,archived,predecessor_plan_id').single(); if (e3) throw e3; return newRow as unknown as ServerPlanRow;
  },
};

// prefsApi removed; use src/api/userPrefs.ts instead

export const sessionApi = {
  async save(planServerId: number | string, planWeekId: string, planDayId: string, session: SessionPayload): Promise<{ ok: true }> {
    const pid = String(planServerId);
    // 1) Try update existing row first
    const upd: SupabaseResp<{ plan_id: string }> = await supabase
      .from('sessions')
      .update({ data: session })
      .match({ plan_id: pid, week_id: planWeekId, day_id: planDayId })
      .select('plan_id')
      .maybeSingle();
    if (upd.data) return { ok: true };
    if (upd.error && upd.error.code && upd.error.code !== 'PGRST116') throw upd.error;

    // 2) No row updated, insert a new one
    const ins: SupabaseResp<{ plan_id: string }> = await supabase
      .from('sessions')
      .insert([{ plan_id: pid, week_id: planWeekId, day_id: planDayId, data: session }])
      .select('plan_id')
      .single();
    if (ins.error) throw ins.error;
    return { ok: true };
  },
  async complete(planServerId: number, planWeekId: string, planDayId: string, completed?: boolean): Promise<{ ok: true }> {
    if (completed) {
      // Update-first, then insert if missing (no unique constraint required)
      const upd: SupabaseResp<{ plan_id: string }> = await supabase
        .from('completions')
        .update({ completed_at: new Date().toISOString() })
        .match({ plan_id: planServerId, week_id: planWeekId, day_id: planDayId })
        .select('plan_id')
        .maybeSingle();
      if (!upd.data) {
        const ins: SupabaseResp<{ plan_id: string }> = await supabase
          .from('completions')
          .insert([{ plan_id: planServerId, week_id: planWeekId, day_id: planDayId }])
          .select('plan_id')
          .single();
        if (ins.error) throw ins.error;
      } else if (upd.error) { throw upd.error; }
    } else {
      const { error } = await supabase
        .from('completions')
        .delete()
        .match({ plan_id: planServerId, week_id: planWeekId, day_id: planDayId });
      if (error) throw error;
    }
    return { ok: true };
  },
  async lastCompleted(planServerId: number): Promise<{ week_id: string; day_id: string } | null> {
    const { data } = await supabase.from('completions').select('week_id,day_id,completed_at').eq('plan_id', planServerId).order('completed_at', { ascending: false }).limit(1).maybeSingle(); return (data as { week_id: string; day_id: string } | null) ?? null;
  },
  async last(planServerId: number, planWeekId: string, planDayId: string): Promise<SessionPayload | null> {
    const { data } = await supabase.from('sessions').select('data').match({ plan_id: planServerId, week_id: planWeekId, day_id: planDayId }).maybeSingle(); return (data as { data?: SessionPayload } | null)?.data ?? null;
  },
  async status(planServerId: number, planWeekId: string, planDayId: string): Promise<{ completed: boolean }> {
    const { data } = await supabase.from('completions').select('plan_id').match({ plan_id: planServerId, week_id: planWeekId, day_id: planDayId }).maybeSingle(); return { completed: !!data };
  },
  async completedList(planServerId: number): Promise<Array<{ week_id: string; day_id: string }>> {
    const { data } = await supabase.from('completions').select('week_id,day_id').eq('plan_id', planServerId).order('completed_at', { ascending: true }); return (data ?? []) as Array<{ week_id: string; day_id: string }>;
  },
};

export type ServerTemplateRow = ServerPlanRow;
export const templateApi = {
  async list(): Promise<ServerTemplateRow[]> { const { data, error } = await supabase.from('templates').select('id,name,data').order('id', { ascending: false }); if (error) throw error; return (data ?? []) as unknown as ServerTemplateRow[]; },
  async create(name: string, data: ServerPlanData): Promise<ServerTemplateRow> { const { data: row, error } = await supabase.from('templates').insert([{ name, data }]).select('id,name,data').single(); if (error) throw error; return row as unknown as ServerTemplateRow; },
  async update(id: number, name: string, data: ServerPlanData): Promise<ServerTemplateRow> { const { data: row, error } = await supabase.from('templates').update({ name, data }).eq('id', id).select('id,name,data').single(); if (error) throw error; return row as unknown as ServerTemplateRow; },
  async remove(id: number): Promise<{ ok: true }> { const { error } = await supabase.from('templates').delete().eq('id', id); if (error) throw error; return { ok: true }; },
};
