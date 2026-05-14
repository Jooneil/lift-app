import { useEffect, useState } from 'react';
import { Mascot, type MascotExpression } from '../mascot/Mascot';

export type Improvement = {
  name: string;
  fromWeight: number;
  fromReps: number;
  toWeight: number;
  toReps: number;
};

export type PlanCompleteData = {
  planName: string;
  totalSessions: number;
  totalSets: number;
  totalLbs: number;
  improvements: Improvement[];
  mascotExpression: MascotExpression;
  shouldShowStreakReconfig: boolean;
};

type Props = {
  open: boolean;
  data: PlanCompleteData | null;
  onContinue: () => void;
  onStartFresh: () => void;
};

export default function PlanCompleteModal({ open, data, onContinue, onStartFresh }: Props) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open && data) {
      setVisible(true);
      setClosing(false);
    } else if (visible) {
      setClosing(true);
      const t = setTimeout(() => { setVisible(false); setClosing(false); }, 220);
      return () => clearTimeout(t);
    }
  }, [open, data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onContinue(); };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [visible, onContinue]);

  if (!visible || !data) return null;

  const { planName, totalSessions, totalSets, totalLbs, improvements, mascotExpression } = data;
  const lbsDisplay = totalLbs >= 1000 ? `${(totalLbs / 1000).toFixed(1)}k` : Math.round(totalLbs).toLocaleString();

  return (
    <>
      <style>{`
        .plan-complete-sheet {
          border-radius: 20px 20px 0 0;
          width: 100%;
          max-width: 100%;
        }
        @media (min-width: 600px) {
          .plan-complete-sheet {
            border-radius: 16px;
            max-width: 460px;
            width: 460px;
            height: 720px !important;
            max-height: 720px !important;
            margin: auto;
          }
          .plan-complete-overlay {
            align-items: center !important;
          }
        }
      `}</style>
      <div
        className="plan-complete-overlay"
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.82)',
          backdropFilter: 'blur(6px)',
          zIndex: 9999,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'flex-end',
          opacity: closing ? 0 : 1,
          transition: 'opacity 220ms ease',
        }}
        onClick={onContinue}
      >
        <div
          className="plan-complete-sheet"
          style={{
            background: 'var(--surface-elevated)',
            height: '92vh', maxHeight: '92vh',
            display: 'flex', flexDirection: 'column',
            transform: closing ? 'translateY(100%)' : 'translateY(0)',
            transition: 'transform 220ms ease-out',
            overflow: 'hidden',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{
            textAlign: 'center',
            padding: '28px 20px 20px',
            flexShrink: 0,
            borderBottom: '1px solid var(--border-subtle)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <Mascot expression={mascotExpression} size={88} idSuffix="plan-complete" />
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.15 }}>
              Plan Complete!
            </div>
            <div style={{
              fontSize: 14, color: 'var(--text-secondary)',
              marginTop: 6, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: '100%',
            }}>
              {planName}
            </div>
          </div>

          {/* Scrollable body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 8px', overscrollBehavior: 'contain' }}>
            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 24 }}>
              {[
                { label: 'Workouts', value: totalSessions },
                { label: 'Sets Logged', value: totalSets.toLocaleString() },
                { label: 'Lbs Lifted', value: lbsDisplay },
              ].map(stat => (
                <div key={stat.label} style={{
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 12,
                  padding: '14px 8px',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
                    {stat.value}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.3 }}>
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Improvements */}
            {improvements.length > 0 && (
              <div>
                <div style={{
                  fontSize: 12, fontWeight: 700,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  marginBottom: 10,
                }}>
                  Top Improvements
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {improvements.map(imp => (
                    <div key={imp.name} style={{
                      background: 'var(--surface-raised)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 10,
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}>
                      <div style={{
                        fontSize: 14, fontWeight: 600,
                        color: 'var(--text-primary)',
                        flex: 1, minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {imp.name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                          {imp.fromWeight}×{imp.fromReps}
                        </span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>→</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#4ade80' }}>
                          {imp.toWeight}×{imp.toReps}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {improvements.length === 0 && totalSessions > 0 && (
              <div style={{
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: 14,
                padding: '16px 0',
              }}>
                Keep pushing — improvements will show here next time!
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{
            padding: '12px 16px',
            paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
            borderTop: '1px solid var(--border-subtle)',
            flexShrink: 0,
            display: 'flex',
            gap: 10,
          }}>
            <button
              onClick={onStartFresh}
              style={{
                flex: 1,
                padding: '13px 0',
                borderRadius: 10,
                border: '1px solid var(--border-strong)',
                background: 'var(--surface-raised)',
                color: 'var(--text-primary)',
                fontSize: 15, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Start Fresh
            </button>
            <button
              onClick={onContinue}
              style={{
                flex: 1,
                padding: '13px 0',
                borderRadius: 10,
                border: 'none',
                background: '#60a5fa',
                color: '#fff',
                fontSize: 15, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Continue Plan
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
