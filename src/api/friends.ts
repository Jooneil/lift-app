import { supabase } from '../supabaseClient';
import { cachedFetch, invalidateCache } from '../cacheUtils';

const FRIENDS_CACHE_KEY = 'cache:friends';
const FRIENDS_TTL = 5 * 60 * 1000;

export type Profile = {
  user_id: string;
  username: string | null;
  user_code: string;
  mascot_expression: string;
};

export type Friendship = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
};

export type FriendWithProfile = Friendship & { profile: Profile };

function generateCode(): string {
  // No 0/O/1/I to avoid confusion when reading aloud
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function ensureProfile(
  userId: string,
  username?: string | null,
  mascotExpression?: string,
): Promise<Profile> {
  const { data: existing } = await supabase
    .from('profiles')
    .select('user_id,username,user_code,mascot_expression')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    const updates: Partial<Pick<Profile, 'username' | 'mascot_expression'>> & { updated_at?: string } = {};
    if (username !== undefined && username !== existing.username) updates.username = username;
    if (mascotExpression && mascotExpression !== existing.mascot_expression) updates.mascot_expression = mascotExpression;
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      await supabase.from('profiles').update(updates).eq('user_id', userId);
      return { ...(existing as Profile), ...updates } as Profile;
    }
    return existing as Profile;
  }

  // Create new profile, retry on rare user_code collision
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const { data, error } = await supabase
      .from('profiles')
      .insert([{
        user_id: userId,
        username: username || null,
        user_code: code,
        mascot_expression: mascotExpression || 'happy',
      }])
      .select()
      .single();
    if (!error && data) return data as Profile;
    if ((error as { code?: string }).code !== '23505') throw error;
  }
  throw new Error('Could not generate unique user code');
}

export async function searchUsers(query: string, currentUserId: string): Promise<Profile[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const upper = trimmed.toUpperCase();
  const map = new Map<string, Profile>();

  // Code search: 6 uppercase alphanumeric chars
  const isCodeSearch = /^[A-Z0-9]{3,6}$/.test(upper);
  if (isCodeSearch) {
    const { data } = await supabase
      .from('profiles')
      .select('user_id,username,user_code,mascot_expression')
      .eq('user_code', upper)
      .neq('user_id', currentUserId)
      .limit(5);
    for (const p of (data ?? []) as Profile[]) map.set(p.user_id, p);
  }

  // Name search
  const { data } = await supabase
    .from('profiles')
    .select('user_id,username,user_code,mascot_expression')
    .ilike('username', `%${trimmed}%`)
    .neq('user_id', currentUserId)
    .limit(10);
  for (const p of (data ?? []) as Profile[]) map.set(p.user_id, p);

  return Array.from(map.values()).slice(0, 10);
}

async function enrichWithProfiles(
  friendships: Friendship[],
  getOtherId: (f: Friendship) => string,
): Promise<FriendWithProfile[]> {
  if (!friendships.length) return [];
  const ids = [...new Set(friendships.map(getOtherId))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id,username,user_code,mascot_expression')
    .in('user_id', ids);
  const profileMap = new Map((profiles as Profile[]).map(p => [p.user_id, p]));
  return friendships
    .map(f => ({ ...f, profile: profileMap.get(getOtherId(f))! }))
    .filter(f => f.profile);
}

export async function getFriends(currentUserId: string): Promise<FriendWithProfile[]> {
  return cachedFetch(FRIENDS_CACHE_KEY, async () => {
    const { data, error } = await supabase
      .from('friendships')
      .select('id,requester_id,addressee_id,status,created_at')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${currentUserId},addressee_id.eq.${currentUserId}`);
    if (error) throw error;
    return enrichWithProfiles(
      (data ?? []) as Friendship[],
      f => f.requester_id === currentUserId ? f.addressee_id : f.requester_id,
    );
  }, FRIENDS_TTL);
}

export async function getIncomingRequests(currentUserId: string): Promise<FriendWithProfile[]> {
  const { data, error } = await supabase
    .from('friendships')
    .select('id,requester_id,addressee_id,status,created_at')
    .eq('addressee_id', currentUserId)
    .eq('status', 'pending');
  if (error) throw error;
  return enrichWithProfiles((data ?? []) as Friendship[], f => f.requester_id);
}

export async function getSentRequests(currentUserId: string): Promise<FriendWithProfile[]> {
  const { data, error } = await supabase
    .from('friendships')
    .select('id,requester_id,addressee_id,status,created_at')
    .eq('requester_id', currentUserId)
    .eq('status', 'pending');
  if (error) throw error;
  return enrichWithProfiles((data ?? []) as Friendship[], f => f.addressee_id);
}

export async function sendFriendRequest(currentUserId: string, targetUserId: string): Promise<void> {
  const { error } = await supabase
    .from('friendships')
    .insert([{ requester_id: currentUserId, addressee_id: targetUserId }]);
  if (error) throw error;
  invalidateCache(FRIENDS_CACHE_KEY);
}

export async function acceptFriendRequest(friendshipId: string): Promise<void> {
  const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId);
  if (error) throw error;
  invalidateCache(FRIENDS_CACHE_KEY);
}

export async function declineFriendRequest(friendshipId: string): Promise<void> {
  const { error } = await supabase.from('friendships').update({ status: 'declined' }).eq('id', friendshipId);
  if (error) throw error;
  invalidateCache(FRIENDS_CACHE_KEY);
}

export async function cancelFriendRequest(friendshipId: string): Promise<void> {
  const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
  if (error) throw error;
  invalidateCache(FRIENDS_CACHE_KEY);
}

export async function removeFriend(friendshipId: string): Promise<void> {
  const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
  if (error) throw error;
  invalidateCache(FRIENDS_CACHE_KEY);
}
