import { useEffect } from 'react';
import { useTutorial } from './TutorialContext';
import Coachmark from './Coachmark';

export default function TutorialOverlay() {
  const { isActive, step, stepIndex, showSkipConfirm, advance, dismiss, confirmSkip, cancelSkip } = useTutorial();

  // Wait-for-tap: capture-phase listener advances when the target element is tapped
  useEffect(() => {
    if (!isActive || !step || !step.waitFor) return;
    const targetId = step.waitFor;

    const handler = (e: MouseEvent) => {
      const target = document.querySelector(`[data-tutorial-id="${targetId}"]`);
      if (!target) return;
      if (target === e.target || target.contains(e.target as Node)) {
        advance();
      }
    };

    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [isActive, step, stepIndex, advance]);

  if (!isActive || !step) return null;

  return (
    <>
      {/* Skip confirm dialog */}
      {showSkipConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 24 }}>
          <div style={{ width: '100%', maxWidth: 300, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 16, padding: '20px 20px 16px', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Skip the tour?</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 16 }}>
              No worries. You can replay it anytime from the <strong style={{ color: 'var(--text-primary)' }}>kebab menu → App preferences</strong>.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={cancelSkip} style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid var(--border-default)', background: 'transparent', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Keep going
              </button>
              <button onClick={confirmSkip} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: 'var(--text-primary)', color: 'var(--bg-base)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Skip
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal step (welcome or done) */}
      {step.kind === 'modal' && !showSkipConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 24 }}>
          <div style={{ width: '100%', maxWidth: 320, background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 20, padding: '28px 24px 20px', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
            {/* Brand mark */}
            <div style={{ width: 64, height: 64, margin: '0 auto 18px', borderRadius: 18, background: 'linear-gradient(135deg, rgba(129,140,248,0.25), rgba(129,140,248,0.05))', border: '1px solid rgba(129,140,248,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg viewBox="0 0 48 48" fill="none" stroke="var(--accent-blue)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" width={32} height={32}>
                <rect x="2" y="14" width="7" height="20" rx="2" />
                <rect x="9" y="20" width="4" height="8" rx="1.2" />
                <rect x="35" y="20" width="4" height="8" rx="1.2" />
                <rect x="39" y="14" width="7" height="20" rx="2" />
                <line x1="13" y1="24" x2="35" y2="24" />
              </svg>
            </div>

            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 8 }}>{step.title}</div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: 22 }}>{step.body}</div>

            <button
              onClick={advance}
              style={{ width: '100%', padding: '13px 16px', borderRadius: 12, border: 'none', background: 'var(--accent-blue)', color: '#0a0a0c', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginBottom: step.id === 'welcome' ? 8 : 0 }}
            >
              {step.cta ?? 'Continue'} →
            </button>

            {step.id === 'welcome' && (
              <button onClick={dismiss} style={{ width: '100%', padding: '10px', background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                Skip tutorial
              </button>
            )}
          </div>
        </div>
      )}

      {/* Coachmark step */}
      {step.kind === 'coach' && step.target && !showSkipConfirm && (
        <Coachmark
          key={step.id}
          targetId={step.target}
          placement={step.placement ?? 'bottom'}
          title={step.title}
          body={step.body}
          stepId={step.id}
          awaitingTap={!!step.waitFor}
          onNext={advance}
          onSkip={dismiss}
        />
      )}
    </>
  );
}
