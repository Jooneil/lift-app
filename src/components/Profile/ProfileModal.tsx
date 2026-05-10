import { useState, useEffect } from 'react';
import { getProfileStats, getPersonalRecords, type ProfileStats, type PR } from '../../api/profile';

type Props = {
  open: boolean;
  onClose: () => void;
  email: string;
  displayName: string;
  onSaveDisplayName: (name: string) => Promise<void>;
  currentStreak: number;
  bestStreak: number;
  streakEnabled: boolean;
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

export default function ProfileModal({
  open, onClose, email, displayName, onSaveDisplayName,
  currentStreak, bestStreak, streakEnabled,
}: Props) {
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [prs, setPrs] = useState<PR[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(displayName);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([getProfileStats(), getPersonalRecords()])
      .then(([s, p]) => { setStats(s); setPrs(p); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => { setNameDraft(displayName); }, [displayName]);

  const handleSaveName = async () => {
    const trimmed = nameDraft.trim();
    setEditingName(false);
    if (trimmed === displayName) return;
    setSaving(true);
    await onSaveDisplayName(trimmed).catch(() => {});
    setSaving(false);
  };

  if (!open) return null;

  const initials = getInitials(displayName, email);
  const nameLabel = deriveLabel(displayName, email);

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200 }} />

      <div
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
        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 2px', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-subtle)' }} />
        </div>

        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 18px 0', flexShrink: 0 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.015em' }}>Profile</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex', alignItems: 'center', borderRadius: 6 }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="4" x2="14" y2="14" /><line x1="14" y1="4" x2="4" y2="14" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', flex: 1, paddingBottom: 'max(28px, env(safe-area-inset-bottom))' }}>

          {/* Avatar + name */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '22px 20px 20px', gap: 14 }}>
            <div style={{
              width: 80, height: 80, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, #60a5fa 0%, #818cf8 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 26, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em',
              boxShadow: '0 0 0 3px var(--bg-elevated), 0 0 0 5px rgba(96,165,250,0.25), 0 8px 24px rgba(0,0,0,0.3)',
            }}>
              {initials}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
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
                    fontSize: 19, fontWeight: 700, textAlign: 'center', width: 220,
                    background: 'var(--bg-card)', border: '1.5px solid var(--accent-blue)',
                    borderRadius: 8, padding: '5px 12px', color: 'var(--text-primary)',
                    outline: 'none',
                  }}
                />
              ) : (
                <button
                  onClick={() => setEditingName(true)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px' }}
                >
                  <span style={{ fontSize: 19, fontWeight: 700, color: saving ? 'var(--text-muted)' : 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                    {saving ? 'Saving…' : nameLabel}
                  </span>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11.5 2.5a2.121 2.121 0 013 3L5 15H1v-4L11.5 2.5z" />
                  </svg>
                </button>
              )}
              <span style={{ fontSize: 13, color: 'var(--text-muted)', letterSpacing: '0.01em' }}>{email}</span>
              {stats?.memberSince && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.03em', textTransform: 'uppercase', fontWeight: 500 }}>
                  Member since {formatMemberSince(stats.memberSince)}
                </span>
              )}
            </div>
          </div>

          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '0 16px 16px' }}>
            {([
              { label: 'Sessions', value: loading ? '—' : String(stats?.totalSessions ?? '—') },
              { label: 'Sets logged', value: loading ? '—' : String(stats?.totalSets ?? '—') },
              { label: streakEnabled ? 'Best streak' : 'Exercises PR\'d', value: loading ? '—' : streakEnabled ? String(bestStreak) : String(prs.length) },
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
          {streakEnabled && (
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
          <div style={{ height: 1, background: 'var(--border-subtle)', margin: '0 16px 20px' }} />

          {/* PRs */}
          <div style={{ padding: '0 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 12 }}>
              Personal Records
            </div>

            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} style={{ height: 46, borderRadius: 10, background: 'var(--bg-card)', opacity: 0.5 + i * 0.1 }} />
                ))}
              </div>
            ) : prs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-muted)', fontSize: 14 }}>
                Log some sets to see your PRs here
              </div>
            ) : (
              <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
                {prs.map((pr, i) => (
                  <div
                    key={pr.exerciseName}
                    style={{
                      display: 'flex', alignItems: 'center', padding: '12px 14px',
                      background: 'var(--bg-card)',
                      borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none',
                      gap: 10,
                    }}
                  >
                    {/* Rank */}
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', minWidth: 18, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                      {i + 1}
                    </span>
                    {/* Name */}
                    <span style={{ flex: 1, fontSize: 14, color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {pr.exerciseName}
                    </span>
                    {/* Weight × reps */}
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 4, flexShrink: 0 }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                        {pr.weight}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>lbs</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 2 }}>× {pr.reps}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
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
