export type TutorialStep = {
  id: string;
  kind: 'modal' | 'coach';
  target?: string;
  placement?: 'top' | 'bottom';
  title: string;
  body: string;
  cta?: string;
  waitFor?: string;
};

export const STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    kind: 'modal',
    title: "You're in. Let's lift.",
    body: "Quick 90-second tour — we'll build a tiny plan together so you actually know what you're looking at. Cool?",
    cta: 'Show me around',
  },
  {
    id: 'create-plan',
    kind: 'coach',
    target: 'create-plan-btn',
    placement: 'top',
    title: 'Make your first plan',
    body: "Tap Create plan — we'll start blank and add one exercise together.",
    waitFor: 'create-plan-btn',
  },
  {
    id: 'builder-intro',
    kind: 'coach',
    target: 'builder-add-btn',
    placement: 'top',
    title: 'This is the builder',
    body: "Weeks → Days → Exercises. You're looking at Week 1, Day 1. Tap + Add exercise.",
    waitFor: 'builder-add-btn',
  },
  {
    id: 'exercise-sheet-intro',
    kind: 'coach',
    target: 'sheet-filters-btn',
    placement: 'bottom',
    title: 'Find your move',
    body: "Let's filter to exactly what you need. Tap Filters.",
    waitFor: 'sheet-filters-btn',
  },
  {
    id: 'exercise-filter-chest',
    kind: 'coach',
    target: 'sheet-chest-filter',
    placement: 'bottom',
    title: 'Filter by muscle',
    body: 'Select Chest to narrow the list.',
    waitFor: 'sheet-chest-filter',
  },
  {
    id: 'exercise-filter-equip',
    kind: 'coach',
    target: 'sheet-freeweight-filter',
    placement: 'bottom',
    title: 'Filter by equipment',
    body: 'Now tap Free weight.',
    waitFor: 'sheet-freeweight-filter',
  },
  {
    id: 'exercise-filter-close',
    kind: 'coach',
    target: 'sheet-filters-btn',
    placement: 'bottom',
    title: 'See your results',
    body: 'Tap Filters again to collapse and reveal the list.',
    waitFor: 'sheet-filters-btn',
  },
  {
    id: 'exercise-pick-bench',
    kind: 'coach',
    target: 'sheet-add-bench',
    placement: 'top',
    title: 'Tap to queue',
    body: "Bench Press is right there — tap it to add to your plan.",
    waitFor: 'sheet-add-bench',
  },
  {
    id: 'exercise-queued',
    kind: 'coach',
    target: 'sheet-add-cta',
    placement: 'top',
    title: 'Nice — one queued',
    body: 'You can keep adding (filters narrow things down) or commit. Tap Add to plan.',
    waitFor: 'sheet-add-cta',
  },
  {
    id: 'builder-add-week',
    kind: 'coach',
    target: 'builder-add-week-btn',
    placement: 'top',
    title: 'Stack on more weeks',
    body: 'One week, one exercise in. Tap + Add week to extend the plan.',
    waitFor: 'builder-add-week-btn',
  },
  {
    id: 'builder-week-copied',
    kind: 'coach',
    target: 'builder-week-2',
    placement: 'top',
    title: 'Week 2 mirrors Week 1',
    body: 'New weeks copy the previous one by default — same exercises, sets, reps. Tweak any week independently, or leave it so progressive overload does the talking.',
  },
  {
    id: 'builder-save',
    kind: 'coach',
    target: 'builder-save-btn',
    placement: 'bottom',
    title: 'Save your plan.',
    body: 'Hit Save and your plan is synced. You can come back to the builder any time to tweak.',
    waitFor: 'builder-save-btn',
  },
  {
    id: 'workout-day-chip',
    kind: 'coach',
    target: 'day-chip',
    placement: 'bottom',
    title: 'Slide into any day',
    body: 'W1 · D1 — tap that chip to jump weeks and days. Long press for the whole map.',
  },
  {
    id: 'workout-keypad',
    kind: 'coach',
    target: 'set-row-1',
    placement: 'top',
    title: 'Log a set',
    body: 'Tap any cell — our keypad pops up. No iOS keyboard, no zoom, no rage.',
  },
  {
    id: 'workout-ghost',
    kind: 'coach',
    target: 'ghost-row',
    placement: 'top',
    title: 'See the ghost?',
    body: "Faded numbers = your last session. Match it or beat it. That's the whole game.",
  },
  {
    id: 'workout-promote',
    kind: 'coach',
    target: 'promote-banner',
    placement: 'bottom',
    title: 'Hit 15? Time to grow.',
    body: "When you smash 15 reps, we suggest +5 lb next session. That's how progressive overload should feel — automatic.",
  },
  {
    id: 'replay',
    kind: 'coach',
    target: 'kebab-btn',
    placement: 'bottom',
    title: 'Replay anytime',
    body: "Up there. Settings → App preferences → Replay tutorial. Also where you silence first-time tips once you're a pro.",
  },
  {
    id: 'done',
    kind: 'modal',
    title: "You're set.",
    body: "Now go log a real set. We'll be here.",
    cta: "Let's lift",
  },
];

export const COACH_STEPS = STEPS.filter((s) => s.kind === 'coach');
export const TOTAL_COACH_STEPS = COACH_STEPS.length;
