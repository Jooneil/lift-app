import { useCallback } from 'react';

type ActiveField = 'weight' | 'reps';
type SideAction = '+small' | '-small' | '+large' | '=last';

type Props = {
  field: ActiveField;
  weightDraft: string;
  repsDraft: string;
  ghostWeight: number | null;
  ghostReps: number | null;
  onWeightChange: (v: string) => void;
  onRepsChange: (v: string) => void;
  onFieldSwitch: (field: ActiveField) => void;
  onDone: () => void;
  onPromote: () => void;
};

const DIGIT_ROWS = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
  ['.', '0', '⌫'],
];

const WEIGHT_SIDE: { label: string; action: SideAction }[] = [
  { label: '+2.5', action: '+small' },
  { label: '−2.5', action: '-small' },
  { label: '+5',   action: '+large' },
  { label: '= last', action: '=last' },
];

const REPS_SIDE: { label: string; action: SideAction }[] = [
  { label: '+1',   action: '+small' },
  { label: '−1',   action: '-small' },
  { label: '+5',   action: '+large' },
  { label: '= last', action: '=last' },
];

function fmt(v: number, isWeight: boolean): string {
  if (!isWeight) return String(Math.round(v));
  const rounded = Math.round(v * 100) / 100;
  return String(rounded);
}

export default function WorkoutKeypad({
  field,
  weightDraft,
  repsDraft,
  ghostWeight,
  ghostReps,
  onWeightChange,
  onRepsChange,
  onFieldSwitch,
  onDone,
  onPromote,
}: Props) {
  const isWeight = field === 'weight';
  const currentDraft = isWeight ? weightDraft : repsDraft;
  const setCurrentDraft = isWeight ? onWeightChange : onRepsChange;
  const sideKeys = isWeight ? WEIGHT_SIDE : REPS_SIDE;

  const repsNum = repsDraft === '' ? 0 : parseInt(repsDraft, 10);
  const showPromote = !isNaN(repsNum) && repsNum >= 15;

  const handleDigit = useCallback((d: string) => {
    if (d === '⌫') {
      setCurrentDraft(currentDraft.slice(0, -1));
      return;
    }
    if (d === '.') {
      if (!isWeight) return;
      if (currentDraft.includes('.')) return;
      setCurrentDraft(currentDraft === '' ? '0.' : currentDraft + '.');
      return;
    }
    if (currentDraft === '0') { setCurrentDraft(d); return; }
    setCurrentDraft(currentDraft + d);
  }, [currentDraft, setCurrentDraft, isWeight]);

  const handleSide = useCallback((action: SideAction) => {
    if (action === '=last') {
      if (isWeight && ghostWeight != null) onWeightChange(String(ghostWeight));
      else if (!isWeight && ghostReps != null) onRepsChange(String(ghostReps));
      return;
    }
    const parsed = isWeight
      ? (parseFloat(currentDraft) || 0)
      : (parseInt(currentDraft, 10) || 0);
    const smallStep = isWeight ? 2.5 : 1;
    const largeStep = 5;
    const clamp = (v: number) => Math.max(0, v);
    if (action === '+small') setCurrentDraft(fmt(clamp(parsed + smallStep), isWeight));
    if (action === '-small') setCurrentDraft(fmt(clamp(parsed - smallStep), isWeight));
    if (action === '+large') setCurrentDraft(fmt(clamp(parsed + largeStep), isWeight));
  }, [currentDraft, setCurrentDraft, isWeight, ghostWeight, ghostReps, onWeightChange, onRepsChange]);

  const btnBase: React.CSSProperties = {
    border: '1px solid var(--border-subtle)',
    borderRadius: 10,
    margin: 3,
    cursor: 'pointer',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    WebkitTapHighlightColor: 'transparent',
  };

  return (
    <div
      onPointerDown={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'var(--bg-elevated)',
        borderTop: '1.5px solid var(--border-subtle)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 8px)',
        zIndex: 1000,
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {/* Promote banner */}
      {showPromote && (
        <div style={{
          background: 'rgba(34, 197, 94, 0.1)',
          borderBottom: '1px solid rgba(34, 197, 94, 0.25)',
          padding: '9px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#22c55e' }}>High rep range</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>Consider adding weight</div>
          </div>
          <button
            onPointerDown={(e) => e.preventDefault()}
            onClick={onPromote}
            style={{
              background: '#22c55e',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '7px 12px',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            +5 lbs → 10 reps
          </button>
        </div>
      )}

      {/* Field switcher + Done */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, padding: '10px 12px 6px' }}>
        <div style={{ display: 'flex', flex: 1, gap: 6 }}>
          {(['weight', 'reps'] as const).map((f) => {
            const active = field === f;
            const val = f === 'weight' ? weightDraft : repsDraft;
            const ghost = f === 'weight' ? ghostWeight : ghostReps;
            return (
              <button
                key={f}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => onFieldSwitch(f)}
                style={{
                  flex: 1,
                  padding: '7px 8px',
                  borderRadius: 10,
                  border: `1.5px solid ${active ? 'var(--accent-blue)' : 'var(--border-subtle)'}`,
                  background: active ? 'rgba(96, 165, 250, 0.1)' : 'var(--bg-card)',
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'border-color 0.12s, background 0.12s',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <div style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: active ? 'var(--accent-blue)' : 'var(--text-muted)',
                  marginBottom: 3,
                }}>
                  {f}
                </div>
                <div style={{
                  fontSize: 22,
                  fontWeight: 700,
                  lineHeight: 1,
                  color: val ? 'var(--text-primary)' : 'var(--text-muted)',
                  letterSpacing: '-0.02em',
                }}>
                  {val || (ghost != null ? String(ghost) : '—')}
                </div>
              </button>
            );
          })}
        </div>
        <button
          onPointerDown={(e) => e.preventDefault()}
          onClick={onDone}
          style={{
            padding: '0 20px',
            borderRadius: 10,
            border: 'none',
            background: 'var(--accent-blue)',
            color: '#fff',
            fontSize: 16,
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: '-0.01em',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          Done
        </button>
      </div>

      {/* Number grid: 3 digit cols + 1 side-key col */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr 0.85fr',
        padding: '2px 9px 4px',
      }}>
        {DIGIT_ROWS.flatMap((row, ri) => {
          const sk = sideKeys[ri];
          const isLast = sk.action === '=last';
          return [
            ...row.map((d) => {
              const isBackspace = d === '⌫';
              const isDot = d === '.';
              const disabled = isDot && !isWeight;
              return (
                <button
                  key={`${ri}-${d}`}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => { if (!disabled) handleDigit(d); }}
                  style={{
                    ...btnBase,
                    background: isBackspace ? 'var(--bg-card)' : 'var(--bg-elevated)',
                    fontSize: isBackspace ? 18 : 22,
                    color: 'var(--text-primary)',
                    opacity: disabled ? 0.2 : 1,
                    cursor: disabled ? 'default' : 'pointer',
                  }}
                >
                  {d}
                </button>
              );
            }),
            <button
              key={`side-${ri}`}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => handleSide(sk.action)}
              style={{
                ...btnBase,
                background: 'var(--bg-card)',
                fontSize: isLast ? 11 : 14,
                fontWeight: isLast ? 600 : 700,
                color: isLast ? 'var(--accent-blue)' : 'var(--text-secondary)',
                letterSpacing: isLast ? '0.01em' : 0,
              }}
            >
              {sk.label}
            </button>,
          ];
        })}
      </div>
    </div>
  );
}
