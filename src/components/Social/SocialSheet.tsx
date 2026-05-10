import { useCallback, useEffect, useRef, useState } from 'react';
import { Mascot } from '../mascot/Mascot';
import * as friendsApi from '../../api/friends';
import * as planSharesApi from '../../api/planShares';
import type { FriendWithProfile, Profile } from '../../api/friends';
import type { ViewingProfile } from '../Profile/ProfileModal';
import type { PlanShare } from '../../api/planShares';
import type { Plan } from '../../types';
import type { ServerPlanData } from '../../api';

type Tab = 'friends' | 'requests' | 'plans';

type Props = {
  open: boolean;
  onClose: () => void;
  currentUserId: string;
  userCode: string;
  plans: Plan[];
  onAcceptPlan: (planName: string, planData: ServerPlanData) => Promise<void>;
  onBadgeUpdate: (count: number) => void;
  onViewProfile: (profile: ViewingProfile) => void;
};

// ─── Small shared pieces ──────────────────────────────────────────────────────

function ProfileAvatar({ profile, size = 36 }: { profile: Profile; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'var(--bg-elevated)' }}>
      <Mascot expression={(profile.mascot_expression as Parameters<typeof Mascot>[0]['expression']) || 'happy'} size={size} idSuffix={`social-${profile.user_id.slice(0, 8)}`} />
    </div>
  );
}

function Username({ profile }: { profile: Profile }) {
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.2 }}>
        {profile.username || 'Lifter'}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em', marginTop: 1 }}>
        {profile.user_code}
      </div>
    </div>
  );
}

function ActionBtn({
  onClick, children, variant = 'ghost', disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  variant?: 'ghost' | 'primary' | 'danger' | 'muted';
  disabled?: boolean;
}) {
  const colors: Record<string, { bg: string; color: string; border: string }> = {
    ghost: { bg: 'transparent', color: 'var(--accent-blue)', border: '1.5px solid var(--accent-blue)' },
    primary: { bg: 'var(--accent-blue)', color: '#fff', border: '1.5px solid var(--accent-blue)' },
    danger: { bg: 'transparent', color: 'var(--danger, #ef4444)', border: '1.5px solid var(--danger, #ef4444)' },
    muted: { bg: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1.5px solid var(--border-subtle)' },
  };
  const c = colors[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
        background: c.bg, color: c.color, border: c.border,
        transition: 'opacity 0.12s',
      }}
    >
      {children}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SocialSheet({
  open, onClose, currentUserId, userCode, plans, onAcceptPlan, onBadgeUpdate, onViewProfile,
}: Props) {
  const [tab, setTab] = useState<Tab>('friends');
  const [friends, setFriends] = useState<FriendWithProfile[]>([]);
  const [incoming, setIncoming] = useState<FriendWithProfile[]>([]);
  const [sent, setSent] = useState<FriendWithProfile[]>([]);
  const [receivedPlans, setReceivedPlans] = useState<PlanShare[]>([]);
  const [loading, setLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef<number | null>(null);

  const [sendTarget, setSendTarget] = useState<FriendWithProfile | null>(null);
  const [sendingPlan, setSendingPlan] = useState(false);
  const [justSent, setJustSent] = useState(false);

  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());

  const [codeCopied, setCodeCopied] = useState(false);

  const sheetRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const dragOffset = useRef(0);
  const isDragging = useRef(false);

  // ─── Scroll lock ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const prevOverscroll = document.body.style.overscrollBehavior;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overscrollBehavior = 'none';
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overscrollBehavior = prevOverscroll;
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // ─── Load data ──────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!currentUserId) return;
    setLoading(true);
    try {
      const [f, inc, snt, rp] = await Promise.all([
        friendsApi.getFriends(currentUserId).catch(() => [] as FriendWithProfile[]),
        friendsApi.getIncomingRequests(currentUserId).catch(() => [] as FriendWithProfile[]),
        friendsApi.getSentRequests(currentUserId).catch(() => [] as FriendWithProfile[]),
        planSharesApi.getReceivedPlans(currentUserId).catch(() => [] as PlanShare[]),
      ]);
      setFriends(f);
      setIncoming(inc);
      setSent(snt);
      setReceivedPlans(rp);
      onBadgeUpdate(inc.length + rp.length);
    } finally {
      setLoading(false);
    }
  }, [currentUserId, onBadgeUpdate]);

  useEffect(() => {
    if (open && currentUserId) {
      loadData();
      setSearchQuery('');
      setSearchResults([]);
      setSendTarget(null);
      setJustSent(false);
    }
  }, [open, currentUserId, loadData]);

  // ─── Debounced search ───────────────────────────────────────────────────────
  useEffect(() => {
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    const q = searchQuery.trim();
    if (!q) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    searchTimerRef.current = window.setTimeout(async () => {
      try {
        const res = await friendsApi.searchUsers(q, currentUserId);
        setSearchResults(res);
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => { if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current); };
  }, [searchQuery, currentUserId]);

  // ─── Relationship map (for search result badges) ─────────────────────────
  const relMap = new Map<string, 'friend' | 'sent' | 'incoming'>();
  friends.forEach(f => {
    relMap.set(f.requester_id === currentUserId ? f.addressee_id : f.requester_id, 'friend');
  });
  sent.forEach(f => relMap.set(f.addressee_id, 'sent'));
  incoming.forEach(f => relMap.set(f.requester_id, 'incoming'));

  // ─── Drag to dismiss ─────────────────────────────────────────────────────
  const dismiss = useCallback(() => {
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'transform 0.28s ease';
      sheetRef.current.style.transform = 'translateY(100%)';
    }
    setTimeout(onClose, 270);
  }, [onClose]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    dragOffset.current = 0;
    isDragging.current = true;
    if (sheetRef.current) sheetRef.current.style.transition = 'none';
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const dy = Math.max(0, e.touches[0].clientY - touchStartY.current);
    dragOffset.current = dy;
    if (sheetRef.current) sheetRef.current.style.transform = `translateY(${dy}px)`;
  };
  const onTouchEnd = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (dragOffset.current > 110) {
      dismiss();
    } else {
      if (sheetRef.current) {
        sheetRef.current.style.transition = 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)';
        sheetRef.current.style.transform = 'translateY(0)';
      }
      dragOffset.current = 0;
    }
  };

  // ─── Actions ─────────────────────────────────────────────────────────────
  const withPending = (id: string, fn: () => Promise<void>) => {
    setPendingActions(p => new Set([...p, id]));
    fn().then(() => loadData()).catch(() => {}).finally(() => {
      setPendingActions(p => { const n = new Set(p); n.delete(id); return n; });
    });
  };

  const handleAdd = (targetId: string) =>
    withPending(`add-${targetId}`, () => friendsApi.sendFriendRequest(currentUserId, targetId));

  const handleAcceptRequest = (id: string) =>
    withPending(`accept-${id}`, () => friendsApi.acceptFriendRequest(id));

  const handleDeclineRequest = (id: string) =>
    withPending(`decline-${id}`, () => friendsApi.declineFriendRequest(id));

  const handleCancelRequest = (id: string) =>
    withPending(`cancel-${id}`, () => friendsApi.cancelFriendRequest(id));

  const handleSendPlan = async (plan: Plan) => {
    if (!sendTarget) return;
    setSendingPlan(true);
    try {
      await planSharesApi.sendPlan(
        currentUserId,
        sendTarget.profile.user_id,
        plan.name,
        { weeks: plan.weeks, ghostMode: plan.ghostMode } as unknown as ServerPlanData,
      );
      setJustSent(true);
      setTimeout(() => { setJustSent(false); setSendTarget(null); }, 1800);
    } catch { /* ignore */ }
    finally { setSendingPlan(false); }
  };

  const handleAcceptPlan = async (share: PlanShare) => {
    const id = `accept-plan-${share.id}`;
    setPendingActions(p => new Set([...p, id]));
    try {
      await planSharesApi.acceptPlan(share.id);
      await onAcceptPlan(share.plan_name, share.plan_snapshot);
      const next = receivedPlans.filter(s => s.id !== share.id);
      setReceivedPlans(next);
      onBadgeUpdate(incoming.length + next.length);
    } catch { /* ignore */ }
    finally { setPendingActions(p => { const n = new Set(p); n.delete(id); return n; }); }
  };

  const handleDismissPlan = async (shareId: string) => {
    await planSharesApi.dismissPlan(shareId).catch(() => {});
    const next = receivedPlans.filter(s => s.id !== shareId);
    setReceivedPlans(next);
    onBadgeUpdate(incoming.length + next.length);
  };

  const copyCode = () => {
    navigator.clipboard.writeText(userCode).catch(() => {});
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1800);
  };

  if (!open) return null;

  const requestBadge = incoming.length;
  const planBadge = receivedPlans.length;
  const activePlans = plans.filter(p => !('archived' in p && p.archived));

  // ─── Plan sender sub-view ────────────────────────────────────────────────
  const renderSendPlanView = () => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
        <button
          onClick={() => { setSendTarget(null); setJustSent(false); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 13, fontWeight: 600, padding: '4px 0', display: 'flex', alignItems: 'center', gap: 4 }}
        >
          ← Back
        </button>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Send plan to <strong style={{ color: 'var(--text-primary)' }}>{sendTarget?.profile.username || 'Lifter'}</strong>
        </span>
      </div>

      {justSent ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 32 }}>✓</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Plan sent!</div>
        </div>
      ) : activePlans.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
          No plans to share yet.
        </div>
      ) : (
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {activePlans.map(plan => (
            <div key={plan.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{plan.name}</span>
              <ActionBtn
                onClick={() => handleSendPlan(plan)}
                variant="primary"
                disabled={sendingPlan}
              >
                Send
              </ActionBtn>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ─── Friends tab ─────────────────────────────────────────────────────────
  const renderFriendsTab = () => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Search bar */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', position: 'relative' }}>
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search by name or code"
          style={{
            width: '100%', padding: '9px 32px 9px 12px', borderRadius: 10,
            border: '1.5px solid var(--border-subtle)', background: 'var(--bg-elevated)',
            color: 'var(--text-primary)', fontSize: 14, outline: 'none', boxSizing: 'border-box',
          }}
        />
        {searchQuery && (
          <button
            onClick={() => { setSearchQuery(''); setSearchResults([]); }}
            style={{
              position: 'absolute', right: 24, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 20, height: 20, borderRadius: '50%', padding: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="2" y1="2" x2="12" y2="12"/><line x1="12" y1="2" x2="2" y2="12"/></svg>
          </button>
        )}
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {/* Search results */}
        {searchQuery.trim() && (
          <>
            {searching ? (
              <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>Searching…</div>
            ) : searchResults.length === 0 ? (
              <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>No users found</div>
            ) : (
              searchResults.map(profile => {
                const rel = relMap.get(profile.user_id);
                const isPending = pendingActions.has(`add-${profile.user_id}`);
                return (
                  <div key={profile.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
                    <ProfileAvatar profile={profile} />
                    <div style={{ flex: 1, minWidth: 0 }}><Username profile={profile} /></div>
                    {rel === 'friend' ? (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>Friends</span>
                    ) : rel === 'sent' ? (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>Pending</span>
                    ) : rel === 'incoming' ? (
                      <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>Requested you</span>
                    ) : (
                      <ActionBtn onClick={() => handleAdd(profile.user_id)} variant="primary" disabled={isPending}>
                        {isPending ? '…' : 'Add'}
                      </ActionBtn>
                    )}
                  </div>
                );
              })
            )}
            <div style={{ padding: '6px 16px 2px', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Your Friends
            </div>
          </>
        )}

        {/* Friends list */}
        {loading && friends.length === 0 ? (
          <div style={{ padding: '20px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>Loading…</div>
        ) : friends.length === 0 && !searchQuery.trim() ? (
          <div style={{ padding: '32px 20px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', lineHeight: 1.5 }}>
            No friends yet.<br />Search by name or share your code: <strong style={{ color: 'var(--text-primary)' }}>{userCode}</strong>
          </div>
        ) : (
          friends.map(f => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
              <ProfileAvatar profile={f.profile} />
              <div style={{ flex: 1, minWidth: 0 }}><Username profile={f.profile} /></div>
              <ActionBtn onClick={() => onViewProfile(f.profile)} variant="ghost">
                View Profile
              </ActionBtn>
            </div>
          ))
        )}
      </div>
    </div>
  );

  // ─── Requests tab ────────────────────────────────────────────────────────
  const renderRequestsTab = () => (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {loading && incoming.length === 0 && sent.length === 0 ? (
        <div style={{ padding: '20px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>Loading…</div>
      ) : (
        <>
          {incoming.length > 0 && (
            <>
              <div style={{ padding: '10px 16px 4px', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Incoming
              </div>
              {incoming.map(f => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
                  <ProfileAvatar profile={f.profile} />
                  <div style={{ flex: 1, minWidth: 0 }}><Username profile={f.profile} /></div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <ActionBtn onClick={() => handleAcceptRequest(f.id)} variant="primary" disabled={pendingActions.has(`accept-${f.id}`)}>
                      Accept
                    </ActionBtn>
                    <ActionBtn onClick={() => handleDeclineRequest(f.id)} variant="muted" disabled={pendingActions.has(`decline-${f.id}`)}>
                      Decline
                    </ActionBtn>
                  </div>
                </div>
              ))}
            </>
          )}

          {sent.length > 0 && (
            <>
              <div style={{ padding: '10px 16px 4px', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Sent
              </div>
              {sent.map(f => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
                  <ProfileAvatar profile={f.profile} />
                  <div style={{ flex: 1, minWidth: 0 }}><Username profile={f.profile} /></div>
                  <ActionBtn onClick={() => handleCancelRequest(f.id)} variant="muted" disabled={pendingActions.has(`cancel-${f.id}`)}>
                    Cancel
                  </ActionBtn>
                </div>
              ))}
            </>
          )}

          {incoming.length === 0 && sent.length === 0 && (
            <div style={{ padding: '32px 20px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
              No pending requests
            </div>
          )}
        </>
      )}
    </div>
  );

  // ─── Plans tab ───────────────────────────────────────────────────────────
  const renderPlansTab = () => (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {loading && receivedPlans.length === 0 ? (
        <div style={{ padding: '20px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>Loading…</div>
      ) : receivedPlans.length === 0 ? (
        <div style={{ padding: '32px 20px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', lineHeight: 1.5 }}>
          No plans in your inbox yet.<br />Friends can send you their plans to try.
        </div>
      ) : (
        receivedPlans.map(share => {
          const acceptId = `accept-plan-${share.id}`;
          return (
            <div key={share.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                {share.from_profile && <ProfileAvatar profile={share.from_profile} size={28} />}
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{share.plan_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    from {share.from_profile?.username || 'Lifter'} · {share.from_profile?.user_code}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <ActionBtn onClick={() => handleAcceptPlan(share)} variant="primary" disabled={pendingActions.has(acceptId)}>
                  {pendingActions.has(acceptId) ? 'Adding…' : 'Add to my plans'}
                </ActionBtn>
                <ActionBtn onClick={() => handleDismissPlan(share.id)} variant="muted">
                  Dismiss
                </ActionBtn>
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <div data-no-ptr onClick={dismiss} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200 }} />
      <div
        ref={sheetRef}
        data-no-ptr
        className="social-sheet"
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: 'var(--bg-card)',
          borderRadius: '20px 20px 0 0',
          boxShadow: '0 -4px 32px rgba(0,0,0,0.35)',
          zIndex: 201,
          height: '92vh',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Handle */}
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{ padding: '12px 0 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'grab', userSelect: 'none', flexShrink: 0 }}
        >
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-strong)' }} />
        </div>

        {/* Header */}
        <div style={{ padding: '4px 16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>Social</div>
          {userCode && (
            <button
              onClick={copyCode}
              style={{
                background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                borderRadius: 8, padding: '5px 10px', cursor: 'pointer',
                fontSize: 11, fontWeight: 600, letterSpacing: '0.05em',
                color: codeCopied ? '#22c55e' : 'var(--text-muted)',
                display: 'flex', alignItems: 'center', gap: 6, transition: 'color 0.15s',
              }}
              title="Copy your code"
            >
              {codeCopied ? (
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="2 8 6 12 14 4" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="5" width="9" height="9" rx="1.5" />
                  <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" />
                </svg>
              )}
              {codeCopied ? 'Copied!' : userCode}
            </button>
          )}
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', padding: '8px 14px', gap: 6, flexShrink: 0 }}>
          {([['friends', 'Friends'], ['requests', 'Requests'], ['plans', 'Plans']] as [Tab, string][]).map(([key, label]) => {
            const badge = key === 'requests' ? requestBadge : key === 'plans' ? planBadge : 0;
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                style={{
                  padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                  border: 'none', cursor: 'pointer', position: 'relative',
                  background: active ? 'var(--accent-blue)' : 'var(--bg-elevated)',
                  color: active ? '#fff' : 'var(--text-primary)',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                {label}
                {badge > 0 && (
                  <span style={{
                    position: 'absolute', top: -3, right: -3,
                    background: '#ef4444', color: '#fff',
                    borderRadius: '50%', width: 16, height: 16,
                    fontSize: 10, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {sendTarget
            ? renderSendPlanView()
            : tab === 'friends'
              ? renderFriendsTab()
              : tab === 'requests'
                ? renderRequestsTab()
                : renderPlansTab()
          }
        </div>
      </div>

      <style>{`
        @media (min-width: 768px) {
          .social-sheet {
            top: 50% !important;
            left: 50% !important;
            right: auto !important;
            bottom: auto !important;
            transform: translate(-50%, -50%);
            width: 460px;
            height: 720px !important;
            max-height: 720px !important;
            border-radius: 20px !important;
          }
        }
      `}</style>
    </>
  );
}
