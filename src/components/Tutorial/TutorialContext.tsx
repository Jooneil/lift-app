import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { STEPS, type TutorialStep } from './steps';
import { upsertUserPrefs, getUserPrefs } from '../../api/userPrefs';

type TutorialState = {
  stepIndex: number;
  isActive: boolean;
  showSkipConfirm: boolean;
};

export type TutorialContextValue = {
  isActive: boolean;
  stepIndex: number;
  step: TutorialStep | null;
  showSkipConfirm: boolean;
  advance: () => void;
  dismiss: () => void;
  replay: () => void;
  confirmSkip: () => void;
  cancelSkip: () => void;
};

const TutorialContext = createContext<TutorialContextValue | null>(null);

const STORAGE_KEY = 'lift.tutorial.v1';

type StoredState = { stepIndex?: number; dismissed?: boolean; completedAt?: string };

function readStorage(): StoredState {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'); } catch { return {}; }
}

function writeStorage(patch: StoredState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readStorage(), ...patch }));
}

export function TutorialProvider({ children, plansLoaded, hasPlans }: {
  children: ReactNode;
  plansLoaded: boolean;
  hasPlans: boolean;
}) {
  const [state, setState] = useState<TutorialState>({ stepIndex: 0, isActive: false, showSkipConfirm: false });

  useEffect(() => {
    if (!plansLoaded) return;
    if (hasPlans) return;
    const stored = readStorage();
    if (stored.dismissed || stored.completedAt) return;
    // Check Supabase prefs for cross-device state
    getUserPrefs().then((prefs) => {
      const tp = prefs?.prefs?.tutorial_prefs;
      if (tp?.dismissed || tp?.completedAt) {
        writeStorage({ dismissed: true });
        return;
      }
      setState({ stepIndex: stored.stepIndex ?? 0, isActive: true, showSkipConfirm: false });
    }).catch(() => {
      setState({ stepIndex: stored.stepIndex ?? 0, isActive: true, showSkipConfirm: false });
    });
  }, [plansLoaded, hasPlans]);

  const advance = useCallback(() => {
    setState((prev) => {
      const next = prev.stepIndex + 1;
      if (next >= STEPS.length) {
        const now = new Date().toISOString();
        writeStorage({ completedAt: now });
        upsertUserPrefs({ tutorial_prefs: { dismissed: false, completedAt: now } }).catch(() => {});
        return { stepIndex: 0, isActive: false, showSkipConfirm: false };
      }
      writeStorage({ stepIndex: next });
      return { ...prev, stepIndex: next };
    });
  }, []);

  const dismiss = useCallback(() => {
    setState((prev) => ({ ...prev, showSkipConfirm: true }));
  }, []);

  const confirmSkip = useCallback(() => {
    writeStorage({ dismissed: true });
    upsertUserPrefs({ tutorial_prefs: { dismissed: true } }).catch(() => {});
    setState({ stepIndex: 0, isActive: false, showSkipConfirm: false });
  }, []);

  const cancelSkip = useCallback(() => {
    setState((prev) => ({ ...prev, showSkipConfirm: false }));
  }, []);

  const replay = useCallback(() => {
    writeStorage({ stepIndex: 0, dismissed: false, completedAt: undefined });
    upsertUserPrefs({ tutorial_prefs: { dismissed: false, completedAt: null } }).catch(() => {});
    setState({ stepIndex: 0, isActive: true, showSkipConfirm: false });
  }, []);

  const step = state.isActive ? (STEPS[state.stepIndex] ?? null) : null;

  return (
    <TutorialContext.Provider value={{
      isActive: state.isActive,
      stepIndex: state.stepIndex,
      step,
      showSkipConfirm: state.showSkipConfirm,
      advance,
      dismiss,
      replay,
      confirmSkip,
      cancelSkip,
    }}>
      {children}
    </TutorialContext.Provider>
  );
}

export function useTutorial() {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error('useTutorial must be used within TutorialProvider');
  return ctx;
}
