import { useEffect, useState, useCallback } from 'react';
import { COACH_STEPS, TOTAL_COACH_STEPS } from './steps';

type Rect = { left: number; top: number; width: number; height: number };

type Props = {
  targetId: string;
  placement: 'top' | 'bottom';
  title: string;
  body: string;
  stepId: string;
  awaitingTap: boolean;
  onNext: () => void;
  onSkip: () => void;
};

const TIP_W = 280;
const GAP = 14;
const PAD = 6;

function measureTarget(id: string): Rect | null {
  const el = document.querySelector(`[data-tutorial-id="${id}"]`) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(v, hi));
}

export default function Coachmark({ targetId, placement, title, body, stepId, awaitingTap, onNext, onSkip }: Props) {
  const [rect, setRect] = useState<Rect | null>(null);

  const measure = useCallback(() => {
    const r = measureTarget(targetId);
    if (r) setRect(r);
  }, [targetId]);

  useEffect(() => {
    measure();
    const t1 = setTimeout(measure, 60);
    const t2 = setTimeout(measure, 250);
    const t3 = setTimeout(measure, 550);
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      window.removeEventListener('resize', measure);
    };
  }, [measure, targetId]);

  // Scroll target into view if off-screen
  useEffect(() => {
    const el = document.querySelector(`[data-tutorial-id="${targetId}"]`) as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(measure, 280);
    }
  }, [targetId, measure]);

  const coachIdx = COACH_STEPS.findIndex((s) => s.id === stepId);
  const stepNum = coachIdx + 1;

  if (!rect) {
    // Target not found — show centered tooltip without spotlight
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9998, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ ...cardStyle, pointerEvents: 'all', position: 'relative' }}>
          <Header stepNum={stepNum} onSkip={onSkip} />
          <div style={titleStyle}>{title}</div>
          <div style={bodyStyle}>{body}</div>
          {!awaitingTap && <button onClick={onNext} style={nextBtnStyle}>Next →</button>}
        </div>
      </div>
    );
  }

  const isTop = placement === 'top';
  const rx = Math.min(rect.height / 2 + PAD, 14);

  // Spotlight rect
  const sx = rect.left - PAD;
  const sy = rect.top - PAD;
  const sw = rect.width + PAD * 2;
  const sh = rect.height + PAD * 2;

  // Tooltip position
  const tipTop = isTop ? rect.top - GAP : rect.top + rect.height + GAP;
  const idealLeft = rect.left + rect.width / 2 - TIP_W / 2;
  const tipLeft = clamp(idealLeft, 12, window.innerWidth - TIP_W - 12);

  // Arrow horizontal position (relative to card)
  const arrowLeft = clamp(rect.left + rect.width / 2 - tipLeft - 6, 20, TIP_W - 28);

  return (
    <>
      {/* SVG dim + spotlight ring — explicit pixel dimensions avoid 100vh≠innerHeight on iOS */}
      <svg
        style={{ position: 'fixed', left: 0, top: 0, pointerEvents: 'none', zIndex: 9998, overflow: 'visible' }}
        width={window.innerWidth}
        height={window.innerHeight}
      >
        <defs>
          <mask id={`tm-${stepId}`}>
            <rect x={0} y={0} width={window.innerWidth} height={window.innerHeight} fill="white" />
            <rect x={sx} y={sy} width={sw} height={sh} rx={rx} fill="black" />
          </mask>
        </defs>
        <rect x={0} y={0} width={window.innerWidth} height={window.innerHeight} fill="rgba(0,0,0,0.72)" mask={`url(#tm-${stepId})`} />
        <rect
          x={sx} y={sy} width={sw} height={sh} rx={rx}
          fill="none"
          stroke="rgba(129,140,248,0.9)"
          strokeWidth="2"
          style={{ filter: 'drop-shadow(0 0 8px rgba(129,140,248,0.6))' }}
        >
          <animate attributeName="stroke-opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" />
        </rect>
      </svg>

      {/* Tooltip card */}
      <div style={{
        position: 'fixed',
        top: tipTop,
        left: tipLeft,
        width: TIP_W,
        transform: isTop ? 'translateY(-100%)' : 'none',
        zIndex: 9999,
        pointerEvents: 'all',
        ...cardStyle,
      }}>
        {/* Arrow */}
        <div style={{
          position: 'absolute',
          left: arrowLeft,
          [isTop ? 'bottom' : 'top']: -7,
          width: 12,
          height: 12,
          background: '#1a1a20',
          borderRight: '1px solid rgba(129,140,248,0.4)',
          borderBottom: '1px solid rgba(129,140,248,0.4)',
          transform: isTop ? 'rotate(45deg)' : 'rotate(225deg)',
        }} />

        <Header stepNum={stepNum} total={TOTAL_COACH_STEPS} onSkip={onSkip} />
        <div style={titleStyle}>{title}</div>
        <div style={bodyStyle}>{body}</div>

        {awaitingTap ? (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--accent-blue)', display: 'inline-block', animation: 'tutorial-pulse 1s infinite' }} />
            Tap the highlighted area to continue
          </div>
        ) : (
          <button onClick={onNext} style={nextBtnStyle}>Next →</button>
        )}
      </div>

      <style>{`
        @keyframes tutorial-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </>
  );
}

function Header({ stepNum, total, onSkip }: { stepNum: number; total?: number; onSkip: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-blue)' }}>
        Step {stepNum}{total ? ` of ${total}` : ''}
      </span>
      <button onClick={onSkip} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 11, padding: 0, fontWeight: 500, cursor: 'pointer' }}>
        Skip tutorial
      </button>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#1a1a20',
  border: '1px solid rgba(129,140,248,0.4)',
  borderRadius: 14,
  padding: '14px 16px 12px',
  boxShadow: '0 16px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
};

const titleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: 'var(--text-primary)',
  letterSpacing: '-0.015em',
  marginBottom: 4,
};

const bodyStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text-secondary)',
  lineHeight: 1.5,
  marginBottom: 12,
};

const nextBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 10,
  border: 'none',
  background: 'var(--accent-blue)',
  color: '#0a0a0c',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};
