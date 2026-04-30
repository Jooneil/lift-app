import { useState, useEffect, useRef } from 'react';

const TRIGGER = 110;
const MAX_PULL = 180;

export type PullState = {
  pull: number;
  progress: number;
  refreshing: boolean;
  springing: boolean;
};

export function usePullToRefresh(onRefresh: () => void): PullState {
  const [state, setState] = useState<PullState>({
    pull: 0,
    progress: 0,
    refreshing: false,
    springing: false,
  });
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    let startY = 0;
    let startX = 0;
    let active = false;
    let decided = false;
    let triggered = false;
    let currentRaw = 0;
    let wasReady = false;
    const rootEl = document.getElementById('root');

    const atTop = () => (window.scrollY ?? window.pageYOffset ?? 0) <= 0;

    const onStart = (e: TouchEvent) => {
      if (triggered) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      active = false;
      decided = false;
      currentRaw = 0;
      wasReady = false;
    };

    const onMove = (e: TouchEvent) => {
      if (triggered) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;

      if (!active) {
        if (decided) return;
        if (Math.abs(dy) < 15 && Math.abs(dx) < 15) return;
        const isVertical = Math.abs(dy) > Math.abs(dx) * 1.5;
        if (dy > 0 && isVertical && atTop()) {
          const target = e.target as HTMLElement | null;
          if (target?.closest?.('[data-no-ptr]')) { decided = true; return; }
          active = true;
        } else {
          decided = true;
          return;
        }
      }

      e.preventDefault();

      currentRaw = Math.max(0, dy);
      const pull = currentRaw <= TRIGGER
        ? currentRaw
        : TRIGGER + (currentRaw - TRIGGER) * 0.25;
      const clamped = Math.min(pull, MAX_PULL);
      const progress = Math.min(clamped / TRIGGER, 1);
      const ready = progress >= 1;

      if (rootEl) {
        const nudge = Math.min(clamped * 0.35, 60);
        rootEl.style.transition = 'none';
        rootEl.style.transform = `translateY(${nudge}px)`;
      }

      if (ready && !wasReady && navigator.vibrate) navigator.vibrate(8);
      wasReady = ready;

      setState({ pull: clamped, progress, refreshing: false, springing: false });
    };

    const onEnd = () => {
      if (triggered || !active) { active = false; return; }
      active = false;

      const pull = currentRaw <= TRIGGER
        ? currentRaw
        : TRIGGER + (currentRaw - TRIGGER) * 0.4;
      const clamped = Math.min(pull, MAX_PULL);

      if (clamped >= TRIGGER) {
        triggered = true;
        setState(s => ({ ...s, refreshing: true, springing: true }));

        if (rootEl) {
          rootEl.style.transition = 'transform 0.35s ease-out';
          rootEl.style.transform = '';
        }

        setTimeout(() => { onRefreshRef.current(); }, 600);
      } else {
        if (rootEl) {
          rootEl.style.transition = 'transform 0.25s ease-out';
          rootEl.style.transform = '';
        }
        setState({ pull: 0, progress: 0, refreshing: false, springing: false });
      }
      currentRaw = 0;
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      if (rootEl) rootEl.style.transform = '';
    };
  }, []);

  return state;
}
