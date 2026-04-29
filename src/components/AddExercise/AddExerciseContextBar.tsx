import { useState } from 'react';
import { XIcon } from '../Icons';

type Props = {
  mode: 'add' | 'replace';
  dayName: string;
  dayItemCount: number;
  replaceTargetName?: string;
  replaceTargetMuscle?: string;
  onClose: () => void;
};

export default function AddExerciseContextBar({
  mode,
  dayName,
  dayItemCount,
  replaceTargetName,
  replaceTargetMuscle,
  onClose,
}: Props) {
  const [peekOpen, setPeekOpen] = useState(false);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '12px 14px',
      borderBottom: '1px solid var(--border-subtle)',
      flexShrink: 0,
    }}>
      {/* Close */}
      <button
        onClick={onClose}
        style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', flexShrink: 0, borderRadius: 6 }}
        aria-label="Close"
      >
        <XIcon size={18} />
      </button>

      {/* Center label */}
      <div style={{ flex: 1, textAlign: 'center', fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>
        {mode === 'replace' ? (
          <>
            <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Replace </span>
            <span style={{ color: 'var(--text-primary)' }}>{replaceTargetName}</span>
          </>
        ) : (
          <>
            <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Add to </span>
            <span style={{ color: 'var(--text-primary)' }}>{dayName}</span>
          </>
        )}
      </div>

      {/* Right: "N already" pill (add mode) or muscle chip (replace mode) */}
      {mode === 'replace' && replaceTargetMuscle ? (
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 9999, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {replaceTargetMuscle}
        </span>
      ) : mode === 'add' ? (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setPeekOpen(v => !v)}
            style={{ fontSize: 12, padding: '3px 10px', borderRadius: 9999, background: peekOpen ? 'var(--accent-muted)' : 'var(--bg-card)', border: `1px solid ${peekOpen ? 'var(--border-strong)' : 'var(--border-subtle)'}`, color: 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {dayItemCount} already
          </button>
          {peekOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 10,
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
              borderRadius: 10, padding: '8px 12px', minWidth: 180, maxWidth: 280,
              boxShadow: 'var(--shadow-lg)', fontSize: 13,
            }}>
              {dayItemCount === 0 ? (
                <div style={{ color: 'var(--text-muted)' }}>No exercises yet</div>
              ) : null}
            </div>
          )}
        </div>
      ) : (
        <div style={{ width: 60 }} />
      )}
    </div>
  );
}
