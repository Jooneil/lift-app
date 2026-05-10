import { useState, useEffect, useRef, useCallback } from 'react';
import { getProfileData, type ProfileStats, type PR } from '../../api/profile';
import { planApi, type ServerPlanRow } from '../../api';
import { Mascot, MASCOT_EXPRESSIONS, type MascotExpression } from '../mascot/Mascot';
import { MascotExpressionPicker } from '../mascot/MascotExpressionPicker';

export type ViewingProfile = {
  username: string | null;
  user_code: string;
  mascot_expression: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  email: string;
  displayName: string;
  onSaveDisplayName: (name: string) => Promise<void>;
  currentStreak: number;
  bestStreak: number;
  streakEnabled: boolean;
  pinnedPrs: string[];
  onSavePinnedPrs: (prs: string[]) => Promise<void>;
  plansPublic: boolean;
  onTogglePlansPublic: (val: boolean) => Promise<void>;
  isOwnProfile?: boolean;
  mascotExpression: MascotExpression;
  onSaveMascotExpression: (expr: MascotExpression) => Promise<void>;
  viewingProfile?: ViewingProfile | null;
};

export function getInitials(displayName: string, email: string): string {
  const name = displayName.trim();
  if (name) {
    const parts = name.split(/\s+/);
    if (parts.length >= 2 && parts[1]) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  const local = email.split('@')[0];
  const parts = local.split(/[._-]/);
  if (parts.length >= 2 && parts[1]) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

function formatMemberSince(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function deriveLabel(displayName: string, email: string): string {
  if (displayName.trim()) return displayName.trim();
  return email.split('@')[0]
    .replace(/[._-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatVolume(lbs: number): string {
  if (lbs >= 1_000_000) return `${(lbs / 1_000_000).toFixed(1)}M`;
  if (lbs >= 10_000) return `${Math.round(lbs / 1_000)}K`;
  if (lbs >= 1_000) return `${(lbs / 1_000).toFixed(1)}K`;
  return String(Math.round(lbs));
}

const norm = (s: string) => s.trim().toLowerCase();

export default function ProfileModal({
  open, onClose, email, displayName, onSaveDisplayName,
  currentStreak, bestStreak, streakEnabled,
  pinnedPrs: initialPinnedPrs, onSavePinnedPrs,
  plansPublic, onTogglePlansPublic, isOwnProfile = true,
  mascotExpression, onSaveMascotExpression,
  viewingProfile = null,
}: Props) {
  const isViewing = !!viewingProfile;
  const effectiveIsOwn = isViewing ? false : isOwnProfile;
  const effectiveName = isViewing
    ? (viewingProfile!.username || 'Lifter')
    : null; // null = use normal nameLabel derivation below
  const effectiveMascot: MascotExpression = isViewing
    ? ((MASCOT_EXPRESSIONS as readonly string[]).includes(viewingProfile!.mascot_expression)
        ? viewingProfile!.mascot_expression as MascotExpression
        : 'happy')
    : mascotExpression;
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [prs, setPrs] = useState<PR[]>([]);
  const [plans, setPlans] = useState<ServerPlanRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(displayName);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'plans' | 'prs'>('plans');
  const [pinned, setPinned] = useState<string[]>(initialPinnedPrs);
  const [prSearch, setPrSearch] = useState('');
  const [editingExpression, setEditingExpression] = useState(false);
  const [expressionDraft, setExpressionDraft] = useState<MascotExpression>(mascotExpression);

  useEffect(() => { setExpressionDraft(mascotExpression); }, [mascotExpression]);

  const handleSaveExpression = async () => {
    setEditingExpression(false);
    await onSaveMascotExpression(expressionDraft).catch(() => {});
  };

  // Drag-to-dismiss
  const sheetRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const isDragging = useRef(false);
  const dragOffset = useRef(0);

  useEffect(() => { setPinned(initialPinnedPrs); }, [initialPinnedPrs]);

  // Reset expression editor when modal closes
  useEffect(() => {
    if (!open) { setEditingExpression(false); setExpressionDraft(mascotExpression); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Escape inside expression picker → go back to profile (capture before App.tsx handler)
  useEffect(() => {
    if (!editingExpression) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setEditingExpression(false);
      setExpressionDraft(mascotExpression);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [editingExpression, mascotExpression]);

  // Lock body scroll and prevent pull-to-refresh while modal is open
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

  useEffect(() => {
    if (!open || isViewing) return;
    setLoading(true);
    Promise.all([getProfileData(), planApi.list()])
      .then(([{ stats: s, prs: p }, pl]) => { setStats(s); setPrs(p); setPlans(pl); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, isViewing]);

  useEffect(() => { setNameDraft(displayName); }, [displayName]);

  const handleSaveName = async () => {
    const trimmed = nameDraft.trim();
    setEditingName(false);
    if (trimmed === displayName) return;
    setSaving(true);
    await onSaveDisplayName(trimmed).catch(() => {});
    setSaving(false);
  };

  const onDragTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    isDragging.current = true;
    dragOffset.current = 0;
  }, []);

  const onDragTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const dy = Math.max(0, e.touches[0].clientY - touchStartY.current);
    dragOffset.current = dy;
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${dy}px)`;
      sheetRef.current.style.transition = 'none';
    }
  }, []);

  const dismiss = useCallback(() => {
    if (sheetRef.current) {
      sheetRef.current.style.transform = 'translateY(100%)';
      sheetRef.current.style.transition = 'transform 0.28s ease';
    }
    setTimeout(onClose, 270);
  }, [onClose]);

  const onDragTouchEnd = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (dragOffset.current > 110) {
      dismiss();
    } else {
      if (sheetRef.current) {
        sheetRef.current.style.transform = 'translateY(0)';
        sheetRef.current.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
      }
      dragOffset.current = 0;
    }
  }, [dismiss]);

  const togglePin = (exerciseName: string) => {
    const key = norm(exerciseName);
    const alreadyPinned = pinned.includes(key);
    const next = alreadyPinned
      ? pinned.filter(p => p !== key)
      : pinned.length >= 4 ? pinned : [...pinned, key];
    setPinned(next);
    onSavePinnedPrs(next).catch(() => {});
  };

  if (!open) return null;

  const nameLabel = effectiveName ?? deriveLabel(displayName, email);
  const pinnedPrData = pinned
    .map(key => prs.find(pr => norm(pr.exerciseName) === key))
    .filter(Boolean) as PR[];

  const searchTerm = norm(prSearch);
  const filteredPrs = searchTerm
    ? prs
        .filter(pr => norm(pr.exerciseName).includes(searchTerm))
        .sort((a, b) => {
          const an = norm(a.exerciseName), bn = norm(b.exerciseName);
          const aStarts = an.startsWith(searchTerm), bStarts = bn.startsWith(searchTerm);
          if (aStarts !== bStarts) return aStarts ? -1 : 1;
          return b.weight - a.weight;
        })
    : prs;

  return (
    <>
      <div data-no-ptr onClick={dismiss} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200 }} />

      <div
        ref={sheetRef}
        data-no-ptr
        className="profile-sheet"
        style={{
          position: 'fixed',
          bottom: 0, left: 0, right: 0,
          maxHeight: '92vh',
          borderRadius: '20px 20px 0 0',
          background: 'var(--bg-elevated)',
          zIndex: 201,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.5)',
        }}
      >
        {/* Drag handle — touch here to swipe-dismiss */}
        <div
          onTouchStart={onDragTouchStart}
          onTouchMove={onDragTouchMove}
          onTouchEnd={onDragTouchEnd}
          style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 2px', flexShrink: 0, touchAction: 'none' }}
        >
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-subtle)' }} />
        </div>

        {/* Title row — also draggable */}
        <div
          onTouchStart={onDragTouchStart}
          onTouchMove={onDragTouchMove}
          onTouchEnd={onDragTouchEnd}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 18px 0', flexShrink: 0, touchAction: 'none' }}
        >
          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.015em' }}>
            {isViewing ? `${nameLabel}'s Profile` : 'Profile'}
          </span>
          <button
            onClick={dismiss}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex', alignItems: 'center', borderRadius: 6 }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="4" x2="14" y2="14" /><line x1="14" y1="4" x2="4" y2="14" />
            </svg>
          </button>
        </div>

        {/* Expression picker sub-panel — own flex column, replaces entire body */}
        {editingExpression ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, boxShadow: '0 0 0 2px var(--border-subtle)' }}>
                <Mascot expression={expressionDraft} size={48} idSuffix="edit-preview" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>Choose expression</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{MASCOT_EXPRESSIONS.length} available</div>
              </div>
              <button
                onClick={() => { setEditingExpression(false); setExpressionDraft(mascotExpression); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-blue)', fontSize: 14, fontWeight: 600, padding: '6px 0 6px 8px', flexShrink: 0 }}
              >
                ← Back
              </button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '12px 16px', overscrollBehavior: 'contain' }}>
              <MascotExpressionPicker value={expressionDraft} onChange={setExpressionDraft} tileSize={120} columns={2} />
            </div>
            <div style={{ padding: '12px 16px', paddingBottom: 'max(20px, env(safe-area-inset-bottom))', borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
              <button
                onClick={handleSaveExpression}
                style={{ width: '100%', padding: '12px 0', borderRadius: 10, border: 'none', background: '#60a5fa', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >
                Save
              </button>
            </div>
          </>
        ) : (
          /* Normal scrollable body */
          <div style={{ overflowY: 'auto', flex: 1, paddingBottom: 'max(28px, env(safe-area-inset-bottom))', overscrollBehavior: 'contain' }}>


          <div style={{ display: 'flex', padding: '20px 16px 16px', gap: 16, alignItems: 'flex-start' }}>

            {/* Left: avatar + name + email */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0, width: 120 }}>
              {/* Mascot avatar — entire circle is clickable when own profile */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                {effectiveIsOwn ? (
                  <button
                    onClick={() => { setExpressionDraft(mascotExpression); setEditingExpression(true); }}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', borderRadius: '50%', display: 'block' }}
                    title="Change expression"
                  >
                    <div style={{ width: 72, height: 72, borderRadius: '50%', overflow: 'hidden', boxShadow: '0 0 0 3px var(--bg-elevated), 0 0 0 5px rgba(96,165,250,0.25), 0 6px 20px rgba(0,0,0,0.3)' }}>
                      <Mascot expression={effectiveMascot} size={72} idSuffix="profile-main" />
                    </div>
                    <div style={{ position: 'absolute', bottom: -2, right: 0, background: 'var(--bg-elevated)', border: '1.5px solid var(--border-subtle)', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11.5 2.5a2.121 2.121 0 013 3L5 15H1v-4L11.5 2.5z" />
                      </svg>
                    </div>
                  </button>
                ) : (
                  <div style={{ width: 72, height: 72, borderRadius: '50%', overflow: 'hidden', boxShadow: '0 0 0 3px var(--bg-elevated), 0 0 0 5px rgba(96,165,250,0.25), 0 6px 20px rgba(0,0,0,0.3)' }}>
                    <Mascot expression={effectiveMascot} size={72} idSuffix="profile-main" />
                  </div>
                )}
              </div>

              {editingName ? (
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={handleSaveName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveName();
                    if (e.key === 'Escape') { setEditingName(false); setNameDraft(displayName); }
                  }}
                  style={{
                    fontSize: 14, fontWeight: 700, textAlign: 'center', width: '100%',
                    background: 'var(--bg-card)', border: '1.5px solid var(--accent-blue)',
                    borderRadius: 8, padding: '4px 8px', color: 'var(--text-primary)',
                    outline: 'none',
                  }}
                />
              ) : effectiveIsOwn ? (
                <button
                  onClick={() => { setNameDraft(nameLabel); setEditingName(true); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: '1px 2px' }}
                >
                  <span style={{
                    fontSize: 14, fontWeight: 700,
                    color: saving ? 'var(--text-muted)' : 'var(--text-primary)',
                    letterSpacing: '-0.02em', textAlign: 'center',
                    maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {nameLabel}
                  </span>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11.5 2.5a2.121 2.121 0 013 3L5 15H1v-4L11.5 2.5z" />
                  </svg>
                </button>
              ) : (
                <span style={{
                  fontSize: 14, fontWeight: 700, color: 'var(--text-primary)',
                  letterSpacing: '-0.02em', textAlign: 'center',
                  maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {nameLabel}
                </span>
              )}

              {stats?.memberSince && (
                <span style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', letterSpacing: '0.02em', lineHeight: 1.3 }}>
                  Since {formatMemberSince(stats.memberSince)}
                </span>
              )}
            </div>

            {/* Right: pinned PRs */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 10 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="var(--text-muted)" xmlns="http://www.w3.org/2000/svg">
                  <path d="M16 3a1 1 0 011 1v1l1.293 1.293A1 1 0 0118 7h-1v5l2 2v1H13v5l-1 1-1-1v-5H5v-1l2-2V7H6a1 1 0 01-.293-.707L7 5V4a1 1 0 011-1h8z" />
                </svg>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>
                  Pinned
                </span>
              </div>

              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[1, 2].map(i => (
                    <div key={i} style={{ height: 32, borderRadius: 8, background: 'var(--bg-card)', opacity: 0.4 + i * 0.1 }} />
                  ))}
                </div>
              ) : pinnedPrData.length === 0 ? (
                <div style={{
                  borderRadius: 10, border: '1.5px dashed var(--border-subtle)',
                  padding: '12px 10px', textAlign: 'center',
                }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    {isViewing ? 'No pinned lifts' : 'Pin your best lifts from the PRs tab below'}
                  </span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {pinnedPrData.map(pr => (
                    <div key={pr.exerciseName} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      background: 'var(--bg-card)', borderRadius: 8,
                      padding: '7px 10px', gap: 6,
                      border: '1px solid var(--border-subtle)',
                    }}>
                      <span style={{
                        fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                      }}>
                        {pr.exerciseName}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 2, flexShrink: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{pr.weight}</span>
                        <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)' }}>lbs</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 1 }}>× {pr.reps}</span>
                      </span>
                    </div>
                  ))}
                  {pinned.length < 4 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', paddingTop: 2 }}>
                      {4 - pinned.length} more slot{4 - pinned.length !== 1 ? 's' : ''} — pin from PRs tab
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '0 16px 16px' }}>
            {([
              { label: 'Sessions', value: loading ? '—' : String(stats?.totalSessions ?? '—') },
              { label: 'Sets logged', value: loading ? '—' : String(stats?.totalSets ?? '—') },
              { label: 'Lbs lifted', value: loading ? '—' : (stats ? formatVolume(stats.totalVolume) : '—') },
            ] as const).map(({ label, value }) => (
              <div key={label} style={{
                background: 'var(--bg-card)', borderRadius: 12, padding: '13px 10px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                border: '1px solid var(--border-subtle)',
              }}>
                <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
                  {value}
                </span>
                <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', textAlign: 'center' }}>
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* Streak card */}
          {!isViewing && streakEnabled && (
            <div style={{
              margin: '0 16px 20px',
              background: currentStreak > 0 ? 'rgba(249,115,22,0.08)' : 'var(--bg-card)',
              border: `1px solid ${currentStreak > 0 ? 'rgba(249,115,22,0.25)' : 'var(--border-subtle)'}`,
              borderRadius: 12, padding: '13px 16px',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{
                width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
                background: currentStreak > 0 ? 'rgba(249,115,22,0.15)' : 'var(--bg-elevated)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg">
                  <path d="M13 2C9 7 7 9 7 12a5 5 0 0010 0c0-1.4-.5-2.7-1.2-3.8C15.2 10.1 13.5 11.5 12 11.5c0 0 2.5-4.5-1-9.5z" fill={currentStreak > 0 ? '#f97316' : 'var(--text-muted)'} />
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                  {currentStreak > 0 ? `${currentStreak} day streak` : 'No active streak'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  Best: {bestStreak} {bestStreak === 1 ? 'day' : 'days'}
                </div>
              </div>
              {currentStreak > 0 && (
                <span style={{ fontSize: 28 }}>🔥</span>
              )}
            </div>
          )}

          {/* Divider */}
          <div style={{ height: 1, background: 'var(--border-subtle)', margin: '0 16px 16px' }} />

          {/* Tab bar */}
          <div style={{ position: 'relative', display: 'flex', background: 'var(--bg-card)', borderRadius: 10, padding: 3, margin: '0 16px 16px', border: '1px solid var(--border-subtle)' }}>
            {/* Sliding pill */}
            <div style={{
              position: 'absolute', top: 3, bottom: 3, borderRadius: 7,
              background: 'var(--bg-elevated)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
              width: 'calc(50% - 3px)',
              left: activeTab === 'plans' ? 3 : 'calc(50%)',
              transition: 'left 0.18s ease',
              pointerEvents: 'none',
            }} />
            {(['plans', 'prs'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1, position: 'relative', zIndex: 1,
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '8px 0', fontSize: 13, fontWeight: 600,
                  color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
                  letterSpacing: '-0.01em', transition: 'color 0.15s ease',
                  borderRadius: 7,
                }}
              >
                {tab === 'plans' ? 'Plans' : 'PRs'}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ padding: '0 16px' }}>
            {activeTab === 'plans' ? (
              <>
                {/* Privacy toggle row (own profile only) */}
                {!isViewing && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                      {plansPublic ? (
                        <>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
                          </svg>
                          Plans are public
                        </>
                      ) : (
                        <>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
                          </svg>
                          Plans are private
                        </>
                      )}
                    </span>
                    {isOwnProfile && (
                      <div
                        role="switch"
                        aria-checked={plansPublic}
                        tabIndex={0}
                        onClick={() => onTogglePlansPublic(!plansPublic)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onTogglePlansPublic(!plansPublic); }}
                        style={{
                          width: 44, height: 26, borderRadius: 999, cursor: 'pointer',
                          background: plansPublic ? '#60a5fa' : 'var(--border-subtle)',
                          position: 'relative', transition: 'background 0.2s ease', flexShrink: 0,
                        }}
                      >
                        <div style={{
                          position: 'absolute', top: 3, width: 20, height: 20, borderRadius: '50%',
                          background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                          left: plansPublic ? 21 : 3,
                          transition: 'left 0.18s ease',
                        }} />
                      </div>
                    )}
                  </div>
                )}

                {isViewing ? (
                  <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    padding: '32px 20px', gap: 10,
                    borderRadius: 12, border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-card)', opacity: 0.6,
                  }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
                    </svg>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)' }}>Plans are private</span>
                  </div>
                ) : !plansPublic ? (
                  <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    padding: '32px 20px', gap: 10,
                    borderRadius: 12, border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-card)', opacity: 0.6,
                  }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
                    </svg>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)' }}>These plans are private</span>
                    {isOwnProfile && (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.4 }}>
                        Toggle the switch above to share your plans with others
                      </span>
                    )}
                  </div>
                ) : loading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {[1, 2, 3].map(i => (
                      <div key={i} style={{ height: 52, borderRadius: 10, background: 'var(--bg-card)', opacity: 0.4 + i * 0.1 }} />
                    ))}
                  </div>
                ) : plans.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-muted)', fontSize: 14 }}>
                    No active plans
                  </div>
                ) : (
                  <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
                    {plans.map((plan, i) => {
                      const weeks = plan.data?.weeks?.length ?? 0;
                      const daysPerWeek = plan.data?.weeks?.[0]?.days?.length ?? 0;
                      return (
                        <div
                          key={plan.id}
                          style={{
                            display: 'flex', alignItems: 'center', padding: '13px 14px',
                            background: 'var(--bg-card)',
                            borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none',
                            gap: 10,
                          }}
                        >
                          <div style={{
                            width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                            background: 'rgba(96,165,250,0.12)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                            </svg>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {plan.name || 'Unnamed Plan'}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                              {weeks > 0 ? `${weeks} week${weeks !== 1 ? 's' : ''}` : ''}
                              {weeks > 0 && daysPerWeek > 0 ? ' · ' : ''}
                              {daysPerWeek > 0 ? `${daysPerWeek} day${daysPerWeek !== 1 ? 's' : ''}/week` : ''}
                              {weeks === 0 && daysPerWeek === 0 ? 'No schedule set' : ''}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              /* PRs tab */
              loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} style={{ height: 46, borderRadius: 10, background: 'var(--bg-card)', opacity: 0.4 + i * 0.1 }} />
                  ))}
                </div>
              ) : prs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-muted)', fontSize: 14 }}>
                  {isViewing ? 'PRs are private' : 'Log some sets to see your PRs here'}
                </div>
              ) : (
                <>
                  {/* Search + pin count row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <div style={{
                      flex: 1, display: 'flex', alignItems: 'center', gap: 7,
                      background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                      borderRadius: 9, padding: '7px 10px',
                    }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                      <input
                        value={prSearch}
                        onChange={e => setPrSearch(e.target.value)}
                        placeholder="Search exercises…"
                        style={{
                          flex: 1, background: 'none', border: 'none', outline: 'none',
                          fontSize: 13, color: 'var(--text-primary)',
                        }}
                      />
                      {prSearch && (
                        <button onClick={() => setPrSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', flexShrink: 0 }}>
                          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="4" y1="4" x2="14" y2="14" /><line x1="14" y1="4" x2="4" y2="14" />
                          </svg>
                        </button>
                      )}
                    </div>
                    {isOwnProfile && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                        {pinned.length}/4 pinned
                      </span>
                    )}
                  </div>

                  {filteredPrs.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                      No results for "{prSearch}"
                    </div>
                  ) : (
                    <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
                      {filteredPrs.map((pr, i) => {
                        const key = norm(pr.exerciseName);
                        const isPinned = pinned.includes(key);
                        const canPin = isPinned || pinned.length < 4;
                        return (
                          <div
                            key={pr.exerciseName}
                            style={{
                              display: 'flex', alignItems: 'center', padding: '11px 14px',
                              background: 'var(--bg-card)',
                              borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none',
                              gap: 10,
                            }}
                          >
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', minWidth: 18, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                              {i + 1}
                            </span>
                            <span style={{ flex: 1, fontSize: 14, color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {pr.exerciseName}
                            </span>
                            <span style={{ display: 'flex', alignItems: 'baseline', gap: 3, flexShrink: 0 }}>
                              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                                {pr.weight}
                              </span>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>lbs</span>
                              <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 1 }}>× {pr.reps}</span>
                            </span>
                            {isOwnProfile && (
                              <button
                                onClick={() => togglePin(pr.exerciseName)}
                                title={isPinned ? 'Unpin' : canPin ? 'Pin to profile' : 'Max 4 pinned'}
                                style={{
                                  background: 'none', border: 'none', cursor: canPin ? 'pointer' : 'default',
                                  padding: '2px 4px', display: 'flex', alignItems: 'center',
                                  opacity: canPin ? 1 : 0.3, flexShrink: 0,
                                }}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                  {isPinned ? (
                                    <path d="M16 3a1 1 0 011 1v1l1.293 1.293A1 1 0 0118 7h-1v5l2 2v1H13v5l-1 1-1-1v-5H5v-1l2-2V7H6a1 1 0 01-.293-.707L7 5V4a1 1 0 011-1h8z" fill="#60a5fa" />
                                  ) : (
                                    <path d="M16 3a1 1 0 011 1v1l1.293 1.293A1 1 0 0118 7h-1v5l2 2v1H13v5l-1 1-1-1v-5H5v-1l2-2V7H6a1 1 0 01-.293-.707L7 5V4a1 1 0 011-1h8z" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" />
                                  )}
                                </svg>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )
            )}
          </div>

          <div style={{ height: 16 }} />
          </div>
        )}
      </div>

      <style>{`
        @media (min-width: 768px) {
          .profile-sheet {
            top: 50% !important;
            left: 50% !important;
            right: auto !important;
            bottom: auto !important;
            transform: translate(-50%, -50%);
            width: 460px;
            max-height: 720px !important;
            border-radius: 20px !important;
          }
        }
      `}</style>
    </>
  );
}
