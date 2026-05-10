import { supabase } from '../supabaseClient';
import type { Profile } from './friends';
import type { ServerPlanData } from '../api';

export type PlanShare = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  plan_name: string;
  plan_snapshot: ServerPlanData;
  status: 'pending' | 'accepted' | 'dismissed';
  created_at: string;
  from_profile?: Profile;
};

export async function sendPlan(
  fromUserId: string,
  toUserId: string,
  planName: string,
  planData: ServerPlanData,
): Promise<void> {
  const { error } = await supabase.from('plan_shares').insert([{
    from_user_id: fromUserId,
    to_user_id: toUserId,
    plan_name: planName,
    plan_snapshot: planData,
  }]);
  if (error) throw error;
}

export async function getReceivedPlans(currentUserId: string): Promise<PlanShare[]> {
  const { data, error } = await supabase
    .from('plan_shares')
    .select('id,from_user_id,to_user_id,plan_name,plan_snapshot,status,created_at')
    .eq('to_user_id', currentUserId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const shares = (data ?? []) as PlanShare[];
  if (!shares.length) return [];

  const fromIds = [...new Set(shares.map(s => s.from_user_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id,username,user_code,mascot_expression')
    .in('user_id', fromIds);
  const profileMap = new Map((profiles as Profile[]).map(p => [p.user_id, p]));
  return shares.map(s => ({ ...s, from_profile: profileMap.get(s.from_user_id) }));
}

export async function acceptPlan(shareId: string): Promise<void> {
  const { error } = await supabase.from('plan_shares').update({ status: 'accepted' }).eq('id', shareId);
  if (error) throw error;
}

export async function dismissPlan(shareId: string): Promise<void> {
  const { error } = await supabase.from('plan_shares').update({ status: 'dismissed' }).eq('id', shareId);
  if (error) throw error;
}
