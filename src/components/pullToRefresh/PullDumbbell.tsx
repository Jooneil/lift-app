import { useEffect, useRef } from 'react';
import type { PullState } from './usePullToRefresh';

const SPRING_BEZIER = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

type Props = { state: PullState };

export default function PullDumbbell({ state }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { pull, progress, springing } = state;

  useEffect(() => {
    if (!springing || !ref.current) return;
    const el = ref.current;
    el.getBoundingClientRect(); // force reflow so browser sees old transform before transition
    el.style.transition = `transform ${SPRING_BEZIER} 0.5s, opacity 0.25s ease`;
    el.style.transform = `translateX(-50%) translateY(-120px) rotate(180deg)`;
    el.style.opacity = '0';
  }, [springing]);

  if (pull === 0 && !springing) return null;

  const TRIGGER = 80;
  const y = Math.min(pull, TRIGGER) - 50; // locks at trigger position, doesn't slide into content
  const rotation = Math.min(progress, 1) * 180;
  const opacity = Math.min(progress * 1.2, 1);
  const color = progress >= 1 ? 'var(--accent-blue)' : 'var(--text-secondary)';

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: 0,
        left: '50%',
        transform: `translateX(-50%) translateY(${y}px) rotate(${rotation}deg)`,
        opacity,
        color,
        zIndex: 9999,
        pointerEvents: 'none',
        width: 36,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        width={36}
        height={36}
      >
        <rect x="0.75" y="4.25" width="2.5" height="7.5" rx="0.7" />
        <rect x="3.25" y="6" width="1.25" height="4" rx="0.4" />
        <rect x="11.5" y="6" width="1.25" height="4" rx="0.4" />
        <rect x="12.75" y="4.25" width="2.5" height="7.5" rx="0.7" />
        <line x1="4.5" y1="8" x2="11.5" y2="8" />
      </svg>
    </div>
  );
}
