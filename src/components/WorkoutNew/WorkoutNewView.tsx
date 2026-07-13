import { useEffect, useRef, useState } from 'react';
import type { CatalogExercise, GhostSet, Plan, PlanDay, PlanWeek, Session, SessionEntry, SessionSet } from '../../types';
import { normalizeExerciseName } from '../../lib/utils';

// ─── Types ─────────────────────────────────────────────────────────────────────

type RestTimer = {
  secondsLeft: number;
  total: number;
  entryId: string;
  done?: boolean;
  paused?: boolean;
};

export type WorkoutNewViewProps = {
  plan: Plan;
  day: PlanDay;
  currentWeek: PlanWeek | null;
  session: Session;
  loggedSets: number;
  totalSets: number;
  elapsedDisplay: string;
  catalogByNameMap: Map<string, CatalogExercise>;
  getGhost: (exerciseId: string | undefined, exerciseName: string, idx: number) => GhostSet;

  restTimer: RestTimer | null;
  restEnabled: boolean;
  onDismissRest: () => void;

  openNotes: Record<string, boolean>;
  notesDraft: Record<string, string>;
  onToggleNotes: (entryId: string) => void;
  onUpdateNotesDraft: (entryId: string, text: string) => void;
  onSaveNotes: (entryId: string) => void;

  openInstructions: Record<string, boolean>;
  instructionsDraft: Record<string, string>;
  onToggleInstructions: (entryId: string) => void;
  onUpdateInstructionsDraft: (entryId: string, text: string) => void;
  onSaveInstructions: (entryId: string) => void;

  onOpenKeypad: (entryId: string, setId: string, field: 'weight' | 'reps', ghostWeight: number | null, ghostReps: number | null) => void;
  onQuickLog: (entryId: string, setId: string, ghostWeight: number | null, ghostReps: number | null) => void;

  onOpenHistory: (entry: { exerciseId?: string; exerciseName: string }) => void;
  onEditSets: (entryId: string, sets: SessionSet[]) => void;
  onReplace: (entry: SessionEntry, index: number) => void;
  onMyoMatch: (entryId: string) => void;
};

// ─── Inline SVG icons ──────────────────────────────────────────────────────────

function WkCheck() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" style={{ display: 'block' }}>
      <path d="M1.5 5.5l2.4 2.4L8.5 2.5" fill="none" stroke="var(--wk-bg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WkDots() {
  return (
    <svg width="16" height="4" viewBox="0 0 16 4" style={{ display: 'block' }}>
      <circle cx="2" cy="2" r="1.5" fill="var(--wk-text-3)" />
      <circle cx="8" cy="2" r="1.5" fill="var(--wk-text-3)" />
      <circle cx="14" cy="2" r="1.5" fill="var(--wk-text-3)" />
    </svg>
  );
}

function WkChevron({ dir = 'right', size = 12 }: { dir?: 'left' | 'right' | 'up' | 'down'; size?: number }) {
  const rot: Record<string, number> = { right: 0, left: 180, down: 90, up: -90 };
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" style={{ display: 'block', transform: `rotate(${rot[dir]}deg)` }}>
      <path d="M4 1.5L8.5 6L4 10.5" fill="none" stroke="var(--wk-text-3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Tick circle ───────────────────────────────────────────────────────────────

function TickCircle({ logged, onClick }: { logged: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="wk-tap"
      style={{
        width: 18, height: 18, borderRadius: 9, boxSizing: 'border-box', flexShrink: 0,
        border: logged ? 'none' : '1.2px solid var(--wk-line-strong)',
        background: logged ? 'var(--wk-accent)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.2s, border 0.2s',
      }}
    >
      {logged && <WkCheck />}
    </div>
  );
}

// ─── Hairline progress ─────────────────────────────────────────────────────────

function HairlineProgress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? (done / total) * 100 : 0;
  return (
    <div style={{ height: 2, background: 'var(--wk-line)', borderRadius: 2, overflow: 'hidden', flex: 1 }}>
      <div style={{
        height: '100%', width: `${pct}%`, background: 'var(--wk-accent)', borderRadius: 2,
        transition: 'width 0.45s cubic-bezier(0.22,1,0.36,1)',
      }} />
    </div>
  );
}

// ─── Exercise kebab menu ───────────────────────────────────────────────────────

function ExerciseMenu({
  open, myo, onClose, onEditSets, onReplace, onHistory, onMyoMatch,
}: {
  open: boolean; myo: boolean;
  onClose: () => void; onEditSets: () => void; onReplace: () => void;
  onHistory: () => void; onMyoMatch: () => void;
}) {
  if (!open) return null;
  const items: { label: string; accent?: boolean; onClick: () => void }[] = [
    { label: 'Edit sets', onClick: onEditSets },
    { label: 'Replace', onClick: onReplace },
    { label: 'History', onClick: onHistory },
    { label: myo ? 'Myo-rep match ✓' : 'Myo-rep match', accent: myo, onClick: onMyoMatch },
  ];
  return (
    <div
      style={{
        position: 'absolute', top: 26, right: 0, zIndex: 40,
        background: 'var(--wk-surface-2)', border: '1px solid var(--wk-line-strong)',
        borderRadius: 12, padding: 6, minWidth: 172,
        boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
      }}
      onClick={e => e.stopPropagation()}
    >
      {items.map((item, i) => (
        <div
          key={item.label}
          className="wk-tap"
          onClick={() => { item.onClick(); onClose(); }}
          style={{
            padding: '9px 12px', borderRadius: 7, fontSize: 13.5,
            fontFamily: "'Geist', system-ui, sans-serif",
            color: item.accent ? 'var(--wk-accent)' : 'var(--wk-text)',
            borderTop: i === 0 ? 'none' : '1px solid var(--wk-line)',
          }}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}

// ─── Quick action pills ────────────────────────────────────────────────────────

function QuickPills({
  align = 'left',
  notesOpen, instructionsOpen,
  onNotes, onInstructions, onHistory,
}: {
  align?: 'left' | 'center';
  notesOpen: boolean; instructionsOpen: boolean;
  onNotes: () => void; onInstructions: () => void; onHistory: () => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: align === 'center' ? 'center' : 'flex-start' }}>
      <button className={`wk-pill${notesOpen ? ' active' : ''}`} onClick={onNotes}>Notes</button>
      <button className={`wk-pill${instructionsOpen ? ' active' : ''}`} onClick={onInstructions}>Instructions</button>
      <button className="wk-pill" onClick={onHistory}>History</button>
    </div>
  );
}

// ─── Inline notes / instructions panel ────────────────────────────────────────

function InlineTextPanel({
  label, value, open,
  onUpdate, onSave,
}: {
  label: string; value: string; open: boolean;
  onUpdate: (text: string) => void;
  onSave: () => void;
}) {
  if (!open) return null;
  return (
    <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--wk-surface)', borderRadius: 10, border: '1px solid var(--wk-line-strong)' }}>
      <div className="wk-micro" style={{ marginBottom: 6, color: 'var(--wk-text-2)' }}>{label}</div>
      <textarea
        value={value}
        onChange={e => onUpdate(e.target.value)}
        rows={3}
        placeholder={`Add ${label.toLowerCase()}...`}
        style={{
          width: '100%', background: 'transparent', border: 'none', outline: 'none', resize: 'none',
          fontFamily: "'Geist', system-ui, sans-serif", fontSize: 13, color: 'var(--wk-text)',
          lineHeight: 1.5, boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button
          onClick={onSave}
          style={{
            padding: '5px 14px', borderRadius: 8, border: 'none',
            background: 'var(--wk-surface-2)', color: 'var(--wk-text)', fontSize: 12,
            fontFamily: "'Geist', system-ui, sans-serif", fontWeight: 600, cursor: 'pointer',
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ─── Rest chip (floating, list mode) ──────────────────────────────────────────

function RestChip({ restTimer, onDismiss }: { restTimer: RestTimer; onDismiss: () => void }) {
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return (
    <div style={{
      position: 'absolute', left: 22, right: 22, bottom: 16,
      background: 'var(--wk-surface-2)', border: '1px solid var(--wk-line-strong)',
      borderRadius: 14, padding: '12px 16px',
      display: 'flex', alignItems: 'center', gap: 14,
      boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
      animation: 'wkSlideUp 0.35s cubic-bezier(0.22,1,0.36,1)',
      zIndex: 10,
    }}>
      <span className="wk-micro" style={{ color: 'var(--wk-text-2)' }}>Rest</span>
      <span className="wk-mono" style={{ fontSize: 17, color: 'var(--wk-text)', minWidth: 44 }}>
        {restTimer.done ? 'Done!' : fmtTime(restTimer.secondsLeft)}
      </span>
      <HairlineProgress done={restTimer.secondsLeft} total={restTimer.total} />
      <span
        className="wk-tap wk-mono"
        onClick={onDismiss}
        style={{ fontSize: 12, color: 'var(--wk-text-3)', padding: '4px 2px' }}
      >
        Skip
      </span>
    </div>
  );
}

// ─── List body ─────────────────────────────────────────────────────────────────

function ListBody({
  entries, menuFor, setMenuFor, expandedOverrides, setExpandedOverrides,
  getGhost, catalogByNameMap,
  openNotes, notesDraft, onToggleNotes, onUpdateNotesDraft, onSaveNotes,
  openInstructions, instructionsDraft, onToggleInstructions, onUpdateInstructionsDraft, onSaveInstructions,
  onOpenKeypad, onQuickLog, onOpenHistory, onEditSets, onReplace, onMyoMatch,
}: {
  entries: SessionEntry[];
  menuFor: string | null;
  setMenuFor: (id: string | null) => void;
  expandedOverrides: Record<string, boolean>;
  setExpandedOverrides: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  getGhost: (exerciseId: string | undefined, exerciseName: string, idx: number) => GhostSet;
  catalogByNameMap: Map<string, CatalogExercise>;
  openNotes: Record<string, boolean>;
  notesDraft: Record<string, string>;
  onToggleNotes: (entryId: string) => void;
  onUpdateNotesDraft: (entryId: string, text: string) => void;
  onSaveNotes: (entryId: string) => void;
  openInstructions: Record<string, boolean>;
  instructionsDraft: Record<string, string>;
  onToggleInstructions: (entryId: string) => void;
  onUpdateInstructionsDraft: (entryId: string, text: string) => void;
  onSaveInstructions: (entryId: string) => void;
  onOpenKeypad: WorkoutNewViewProps['onOpenKeypad'];
  onQuickLog: WorkoutNewViewProps['onQuickLog'];
  onOpenHistory: WorkoutNewViewProps['onOpenHistory'];
  onEditSets: WorkoutNewViewProps['onEditSets'];
  onReplace: WorkoutNewViewProps['onReplace'];
  onMyoMatch: WorkoutNewViewProps['onMyoMatch'];
}) {
  const colGrid = '18px 1fr 64px 48px 28px';

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Global column header */}
      <div style={{ display: 'grid', gridTemplateColumns: colGrid, gap: 10, margin: '20px 0 0', paddingBottom: 8, borderBottom: '1px solid var(--wk-line)' }}>
        <span className="wk-micro">#</span>
        <span className="wk-micro">Last</span>
        <span className="wk-micro" style={{ textAlign: 'right' }}>Kg</span>
        <span className="wk-micro" style={{ textAlign: 'right' }}>Reps</span>
        <span />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 80 }}>
        {entries.map((entry, entryIndex) => {
          const loggedCount = entry.sets.filter(s => s.weight != null && s.reps != null).length;
          const complete = loggedCount === entry.sets.length && entry.sets.length > 0;
          const isOpen = expandedOverrides[entry.id] != null ? expandedOverrides[entry.id] : !complete;
          const cat = catalogByNameMap.get(normalizeExerciseName(entry.exerciseName || '').toLowerCase());
          const muscleLabel = cat?.primaryMuscle
            ? (cat.secondaryMuscles?.length ? `${cat.primaryMuscle} · ${cat.secondaryMuscles[0]}` : cat.primaryMuscle)
            : null;

          return (
            <div key={entry.id} style={{ marginTop: entryIndex === 0 ? 14 : isOpen ? 22 : 10 }}>
              {/* Exercise header row */}
              <div
                className="wk-tap"
                onClick={() => setExpandedOverrides(p => ({ ...p, [entry.id]: !isOpen }))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, position: 'relative',
                  marginBottom: isOpen ? 4 : 0,
                  paddingBottom: isOpen ? 0 : 10,
                  borderBottom: isOpen ? 'none' : '1px solid var(--wk-line)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontFamily: "'Geist', system-ui, sans-serif",
                      fontSize: 15.5, fontWeight: 550, letterSpacing: '-0.01em',
                      color: complete && !isOpen ? 'var(--wk-text-2)' : 'var(--wk-text)',
                    }}>
                      {entry.exerciseName}
                    </span>
                    {entry.myoRepMatch && (
                      <span className="wk-micro" style={{ color: 'var(--wk-accent)', fontSize: 9 }}>Myo</span>
                    )}
                  </div>
                  {!isOpen && (
                    <div className="wk-mono" style={{ fontSize: 12, color: 'var(--wk-text-3)', marginTop: 3 }}>
                      {entry.sets.map(s => {
                        const w = s.weight; const r = s.reps;
                        return (w != null && r != null) ? `${w}×${r}` : '—';
                      }).join('  ·  ')}
                    </div>
                  )}
                </div>
                {complete && !isOpen && (
                  <div style={{ width: 18, height: 18, borderRadius: 9, background: 'var(--wk-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <WkCheck />
                  </div>
                )}
                {isOpen && (
                  <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    {complete && (
                      <div
                        className="wk-tap"
                        onClick={e => { e.stopPropagation(); setExpandedOverrides(p => ({ ...p, [entry.id]: false })); }}
                        style={{ padding: '8px 8px 8px 4px', opacity: 0.5 }}
                        title="Collapse"
                      >
                        <WkChevron dir="up" size={12} />
                      </div>
                    )}
                    <div
                      className="wk-tap"
                      style={{ padding: '8px 2px 8px 8px', position: 'relative' }}
                      onClick={e => { e.stopPropagation(); setMenuFor(menuFor === entry.id ? null : entry.id); }}
                    >
                      <WkDots />
                      <ExerciseMenu
                        open={menuFor === entry.id}
                        myo={!!entry.myoRepMatch}
                        onClose={() => setMenuFor(null)}
                        onEditSets={() => onEditSets(entry.id, entry.sets)}
                        onReplace={() => onReplace(entry, entryIndex)}
                        onHistory={() => onOpenHistory({ exerciseId: entry.exerciseId, exerciseName: entry.exerciseName })}
                        onMyoMatch={() => onMyoMatch(entry.id)}
                      />
                    </div>
                  </div>
                )}
              </div>

              {isOpen && (
                <>
                  {/* Muscle + quick actions */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                    <span className="wk-micro">{muscleLabel ?? ''}</span>
                    <QuickPills
                      notesOpen={!!openNotes[entry.id]}
                      instructionsOpen={!!openInstructions[entry.id]}
                      onNotes={() => onToggleNotes(entry.id)}
                      onInstructions={() => onToggleInstructions(entry.id)}
                      onHistory={() => onOpenHistory({ exerciseId: entry.exerciseId, exerciseName: entry.exerciseName })}
                    />
                  </div>

                  {/* Set rows */}
                  {entry.sets.map((set, setIdx) => {
                    const ghost = getGhost(entry.exerciseId, entry.exerciseName, setIdx);
                    const isLogged = set.weight != null && set.reps != null;
                    const displayW = set.weight != null ? set.weight : ghost.weight;
                    const displayR = set.reps != null ? set.reps : ghost.reps;
                    const lastLabel = (ghost.weight != null && ghost.reps != null) ? `${ghost.weight}×${ghost.reps}` : '';

                    return (
                      <div
                        key={set.id}
                        className="wk-row"
                        style={{ display: 'grid', gridTemplateColumns: colGrid, gap: 10, alignItems: 'center', height: 44, borderBottom: '1px solid var(--wk-line)' }}
                      >
                        <span className="wk-mono" style={{ fontSize: 12, color: 'var(--wk-text-3)' }}>{setIdx + 1}</span>
                        <span className="wk-mono" style={{ fontSize: 12.5, color: 'var(--wk-text-3)' }}>{lastLabel}</span>
                        <span
                          className="wk-tap wk-mono"
                          onClick={() => onOpenKeypad(entry.id, set.id, 'weight', ghost.weight, ghost.reps)}
                          style={{ fontSize: 15, textAlign: 'right', color: isLogged ? 'var(--wk-text)' : 'var(--wk-text-3)', transition: 'color 0.2s' }}
                        >
                          {displayW != null ? displayW : '—'}
                        </span>
                        <span
                          className="wk-tap wk-mono"
                          onClick={() => onOpenKeypad(entry.id, set.id, 'reps', ghost.weight, ghost.reps)}
                          style={{ fontSize: 15, textAlign: 'right', color: isLogged ? 'var(--wk-text)' : 'var(--wk-text-3)', transition: 'color 0.2s' }}
                        >
                          {displayR != null ? displayR : '—'}
                        </span>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <TickCircle
                            logged={isLogged}
                            onClick={() => onQuickLog(entry.id, set.id, ghost.weight, ghost.reps)}
                          />
                        </div>
                      </div>
                    );
                  })}

                  {/* Inline notes / instructions */}
                  <InlineTextPanel
                    label="Notes"
                    value={notesDraft[entry.id] ?? ''}
                    open={!!openNotes[entry.id]}
                    onUpdate={text => onUpdateNotesDraft(entry.id, text)}
                    onSave={() => onSaveNotes(entry.id)}
                  />
                  <InlineTextPanel
                    label="Instructions"
                    value={instructionsDraft[entry.id] ?? ''}
                    open={!!openInstructions[entry.id]}
                    onUpdate={text => onUpdateInstructionsDraft(entry.id, text)}
                    onSave={() => onSaveInstructions(entry.id)}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Focus body ────────────────────────────────────────────────────────────────

function FocusBody({
  entries, focusExIdx, setFocusExIdx, menuFor, setMenuFor,
  getGhost, catalogByNameMap,
  restTimer, restEnabled, onDismissRest,
  openNotes, notesDraft, onToggleNotes, onUpdateNotesDraft, onSaveNotes,
  openInstructions, instructionsDraft, onToggleInstructions, onUpdateInstructionsDraft, onSaveInstructions,
  onOpenKeypad, onQuickLog, onOpenHistory, onEditSets, onReplace, onMyoMatch,
}: {
  entries: SessionEntry[];
  focusExIdx: number;
  setFocusExIdx: (i: number) => void;
  menuFor: string | null;
  setMenuFor: (id: string | null) => void;
  getGhost: WorkoutNewViewProps['getGhost'];
  catalogByNameMap: Map<string, CatalogExercise>;
  restTimer: RestTimer | null;
  restEnabled: boolean;
  onDismissRest: () => void;
  openNotes: Record<string, boolean>;
  notesDraft: Record<string, string>;
  onToggleNotes: (entryId: string) => void;
  onUpdateNotesDraft: (entryId: string, text: string) => void;
  onSaveNotes: (entryId: string) => void;
  openInstructions: Record<string, boolean>;
  instructionsDraft: Record<string, string>;
  onToggleInstructions: (entryId: string) => void;
  onUpdateInstructionsDraft: (entryId: string, text: string) => void;
  onSaveInstructions: (entryId: string) => void;
  onOpenKeypad: WorkoutNewViewProps['onOpenKeypad'];
  onQuickLog: WorkoutNewViewProps['onQuickLog'];
  onOpenHistory: WorkoutNewViewProps['onOpenHistory'];
  onEditSets: WorkoutNewViewProps['onEditSets'];
  onReplace: WorkoutNewViewProps['onReplace'];
  onMyoMatch: WorkoutNewViewProps['onMyoMatch'];
}) {
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const idx = Math.min(focusExIdx, entries.length - 1);
  const entry = entries[idx];
  const cat = catalogByNameMap.get(normalizeExerciseName(entry?.exerciseName || '').toLowerCase());
  const muscleLabel = cat?.primaryMuscle
    ? (cat.secondaryMuscles?.length ? `${cat.primaryMuscle} · ${cat.secondaryMuscles[0]}` : cat.primaryMuscle)
    : null;

  const currentSetIdx = entry.sets.findIndex(s => s.weight == null || s.reps == null);
  const allDone = currentSetIdx === -1;
  const currentSet = allDone ? entry.sets[entry.sets.length - 1] : entry.sets[currentSetIdx];
  const ghost = currentSet ? getGhost(entry.exerciseId, entry.exerciseName, allDone ? entry.sets.length - 1 : currentSetIdx) : null;

  const displayW = currentSet ? (currentSet.weight ?? ghost?.weight) : null;
  const displayR = currentSet ? (currentSet.reps ?? ghost?.reps) : null;

  const nextEntry = entries[idx + 1] ?? null;
  const isLast = idx === entries.length - 1;

  const nav = (dir: number) => {
    const n = idx + dir;
    if (n >= 0 && n < entries.length) { setFocusExIdx(n); setMenuFor(null); }
  };

  const handleLogButton = () => {
    if (allDone) {
      if (!isLast) nav(1);
      return;
    }
    if (currentSet) onOpenKeypad(entry.id, currentSet.id, 'weight', ghost?.weight ?? null, ghost?.reps ?? null);
  };

  const logButtonLabel = () => {
    if (allDone) return isLast ? 'Finish workout' : 'Next exercise';
    const w = displayW != null ? displayW : '—';
    const r = displayR != null ? displayR : '—';
    return `Log set — ${w} × ${r}`;
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Exercise navigator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 24 }}>
        <div className="wk-tap" onClick={() => nav(-1)} style={{ padding: 10, margin: -10, opacity: idx === 0 ? 0.25 : 1 }}>
          <WkChevron dir="left" size={14} />
        </div>
        <div style={{ flex: 1, textAlign: 'center', position: 'relative' }}>
          <h2 style={{
            margin: 0, fontSize: 21, fontWeight: 600, letterSpacing: '-0.02em',
            color: 'var(--wk-text)', lineHeight: 1.2,
            fontFamily: "'Geist', system-ui, sans-serif",
          }}>
            {entry.exerciseName}
          </h2>
          <div className="wk-micro" style={{ marginTop: 5, color: 'var(--wk-text-3)' }}>
            {[muscleLabel, entry.myoRepMatch ? 'Myo' : null, `${idx + 1} of ${entries.length}`]
              .filter(Boolean).join(' · ')}
            <span
              className="wk-tap"
              onClick={() => setMenuFor(menuFor === 'focus' ? null : 'focus')}
              style={{ display: 'inline-block', padding: '6px 0 6px 14px', verticalAlign: 'middle' }}
            >
              <WkDots />
            </span>
          </div>
          <div style={{ position: 'absolute', right: 40, top: 30, zIndex: 30 }}>
            <ExerciseMenu
              open={menuFor === 'focus'}
              myo={!!entry.myoRepMatch}
              onClose={() => setMenuFor(null)}
              onEditSets={() => onEditSets(entry.id, entry.sets)}
              onReplace={() => onReplace(entry, idx)}
              onHistory={() => onOpenHistory({ exerciseId: entry.exerciseId, exerciseName: entry.exerciseName })}
              onMyoMatch={() => onMyoMatch(entry.id)}
            />
          </div>
        </div>
        <div className="wk-tap" onClick={() => nav(1)} style={{ padding: 10, margin: -10, opacity: isLast ? 0.25 : 1 }}>
          <WkChevron dir="right" size={14} />
        </div>
      </div>

      {/* Quick pills */}
      <QuickPills
        align="center"
        notesOpen={!!openNotes[entry.id]}
        instructionsOpen={!!openInstructions[entry.id]}
        onNotes={() => onToggleNotes(entry.id)}
        onInstructions={() => onToggleInstructions(entry.id)}
        onHistory={() => onOpenHistory({ exerciseId: entry.exerciseId, exerciseName: entry.exerciseName })}
      />

      {/* Instrument numerals + all sets */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 0, overflowY: 'auto' }}>
        <span className="wk-micro" style={{ marginBottom: 14 }}>
          {allDone ? 'Exercise complete' : `Set ${currentSetIdx + 1} of ${entry.sets.length}`}
        </span>
        <div
          className="wk-tap"
          onClick={handleLogButton}
          style={{ display: 'flex', alignItems: 'baseline', gap: 12, opacity: allDone ? 0.35 : 1, transition: 'opacity 0.3s' }}
        >
          <span className="wk-mono" style={{ fontSize: 54, fontWeight: 300, letterSpacing: '-0.03em', color: 'var(--wk-text)', lineHeight: 1 }}>
            {displayW != null ? displayW : '—'}
          </span>
          <span className="wk-mono" style={{ fontSize: 19, color: 'var(--wk-text-3)', fontWeight: 300 }}>×</span>
          <span className="wk-mono" style={{ fontSize: 54, fontWeight: 300, letterSpacing: '-0.03em', color: 'var(--wk-text)', lineHeight: 1 }}>
            {displayR != null ? displayR : '—'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 24, marginTop: 10 }}>
          <span className="wk-mono" style={{ fontSize: 12, color: 'var(--wk-text-3)' }}>kg</span>
          <span className="wk-mono" style={{ fontSize: 12, color: 'var(--wk-text-3)' }}>reps</span>
        </div>

        {/* All sets mini-list */}
        <div style={{ width: '100%', marginTop: 22 }}>
          {entry.sets.map((s, i) => {
            const g = getGhost(entry.exerciseId, entry.exerciseName, i);
            const isDone = s.weight != null && s.reps != null;
            const isCurrent = i === currentSetIdx;
            const lastLabel = (g.weight != null && g.reps != null) ? `last ${g.weight} × ${g.reps}` : '';
            const targetW = s.weight ?? g.weight;
            const targetR = s.reps ?? g.reps;
            return (
              <div
                key={s.id}
                className="wk-tap wk-row"
                onClick={() => onOpenKeypad(entry.id, s.id, 'weight', g.weight, g.reps)}
                style={{
                  display: 'grid', gridTemplateColumns: '18px 1fr 80px 22px', gap: 10, alignItems: 'center',
                  height: 40,
                  borderTop: i === 0 ? '1px solid var(--wk-line)' : 'none',
                  borderBottom: '1px solid var(--wk-line)',
                  opacity: isDone || isCurrent ? 1 : 0.55, transition: 'opacity 0.25s',
                }}
              >
                <span className="wk-mono" style={{ fontSize: 12, color: isCurrent ? 'var(--wk-text)' : 'var(--wk-text-3)' }}>{i + 1}</span>
                <span className="wk-mono" style={{ fontSize: 12.5, color: 'var(--wk-text-3)' }}>{lastLabel}</span>
                <span className="wk-mono" style={{ fontSize: 14.5, textAlign: 'right', color: isDone ? 'var(--wk-text)' : isCurrent ? 'var(--wk-text-2)' : 'var(--wk-text-3)' }}>
                  {targetW != null ? targetW : '—'}
                  <span style={{ color: 'var(--wk-text-3)', fontSize: 11.5 }}> × </span>
                  {targetR != null ? targetR : '—'}
                </span>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <TickCircle
                    logged={isDone}
                    onClick={() => onQuickLog(entry.id, s.id, g.weight, g.reps)}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Inline notes / instructions */}
        <div style={{ width: '100%' }}>
          <InlineTextPanel
            label="Notes"
            value={notesDraft[entry.id] ?? ''}
            open={!!openNotes[entry.id]}
            onUpdate={text => onUpdateNotesDraft(entry.id, text)}
            onSave={() => onSaveNotes(entry.id)}
          />
          <InlineTextPanel
            label="Instructions"
            value={instructionsDraft[entry.id] ?? ''}
            open={!!openInstructions[entry.id]}
            onUpdate={text => onUpdateInstructionsDraft(entry.id, text)}
            onSave={() => onSaveInstructions(entry.id)}
          />
        </div>
      </div>

      {/* Action zone */}
      <div style={{ marginTop: 'auto', paddingTop: 12, flexShrink: 0 }}>
        {restEnabled && restTimer && !restTimer.done && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, animation: 'wkSlideUp 0.3s cubic-bezier(0.22,1,0.36,1)' }}>
            <span className="wk-micro">Rest</span>
            <span className="wk-mono" style={{ fontSize: 15, color: 'var(--wk-text)', minWidth: 40 }}>
              {fmtTime(restTimer.secondsLeft)}
            </span>
            <HairlineProgress done={restTimer.secondsLeft} total={restTimer.total} />
            <span className="wk-tap wk-mono" onClick={onDismissRest} style={{ fontSize: 11.5, color: 'var(--wk-text-3)', padding: '4px 0 4px 8px' }}>
              Skip
            </span>
          </div>
        )}
        <div
          className="wk-tap"
          onClick={handleLogButton}
          style={{
            height: 56, borderRadius: 16,
            background: allDone ? 'transparent' : 'var(--wk-text)',
            border: allDone ? '1px solid var(--wk-line-strong)' : 'none',
            color: allDone ? 'var(--wk-text)' : 'var(--wk-bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Geist', system-ui, sans-serif",
            fontSize: 15.5, fontWeight: 550, letterSpacing: '-0.01em',
            transition: 'all 0.25s',
            cursor: 'pointer',
          }}
        >
          {logButtonLabel()}
        </div>
        {nextEntry && (
          <div
            className="wk-tap"
            onClick={() => nav(1)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, paddingBottom: 2 }}
          >
            <span className="wk-micro">Up next</span>
            <span style={{
              fontFamily: "'Geist', system-ui, sans-serif",
              fontSize: 13, color: 'var(--wk-text-2)', flex: 1,
            }}>
              {nextEntry.exerciseName} · {nextEntry.sets.length} sets
            </span>
            <WkChevron size={11} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Mode toggle pill ──────────────────────────────────────────────────────────

function ModeToggle({ mode, onChange }: { mode: 'list' | 'focus'; onChange: (m: 'list' | 'focus') => void }) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid var(--wk-line-strong)', borderRadius: 999, padding: 2 }}>
      {(['list', 'focus'] as const).map(val => {
        const active = mode === val;
        return (
          <div
            key={val}
            className="wk-tap"
            onClick={() => onChange(val)}
            style={{
              fontFamily: "'Geist Mono', ui-monospace, monospace",
              fontSize: 9.5, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase',
              padding: '5px 12px', borderRadius: 999, lineHeight: 1,
              color: active ? 'var(--wk-text)' : 'var(--wk-text-3)',
              background: active ? 'var(--wk-surface-2)' : 'transparent',
              transition: 'background 0.2s, color 0.2s',
              userSelect: 'none',
            }}
          >
            {val}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

const LS_VIEW_MODE = 'wk:viewMode';

export default function WorkoutNewView(props: WorkoutNewViewProps) {
  const {
    plan, day, currentWeek, session,
    loggedSets, totalSets, elapsedDisplay,
    catalogByNameMap, getGhost,
    restTimer, restEnabled, onDismissRest,
    openNotes, notesDraft, onToggleNotes, onUpdateNotesDraft, onSaveNotes,
    openInstructions, instructionsDraft, onToggleInstructions, onUpdateInstructionsDraft, onSaveInstructions,
    onOpenKeypad, onQuickLog, onOpenHistory, onEditSets, onReplace, onMyoMatch,
  } = props;

  const [viewMode, setViewMode] = useState<'list' | 'focus'>(() => {
    const saved = localStorage.getItem(LS_VIEW_MODE);
    return saved === 'focus' ? 'focus' : 'list';
  });
  const [expandedOverrides, setExpandedOverrides] = useState<Record<string, boolean>>({});
  const [focusExIdx, setFocusExIdx] = useState(0);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  // Close menu on outside tap
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuFor) return;
    const close = (e: Event) => {
      if (!(e.target as Element).closest('.wk-menu-anchor')) setMenuFor(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close, { passive: true });
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [menuFor]);

  const switchMode = (m: 'list' | 'focus') => {
    if (m === 'focus') {
      const firstUnfinished = session.entries.findIndex(e => e.sets.some(s => s.weight == null || s.reps == null));
      setFocusExIdx(firstUnfinished === -1 ? session.entries.length - 1 : firstUnfinished);
    }
    setMenuFor(null);
    setViewMode(m);
    localStorage.setItem(LS_VIEW_MODE, m);
  };

  const weekNum = currentWeek ? (plan.weeks.indexOf(currentWeek) + 1) : 1;
  const dayNum = currentWeek ? (currentWeek.days.findIndex(d => d.id === day.id) + 1) : 1;
  const metaLabel = `Week ${weekNum} · Day ${dayNum}`;

  const entries = session.entries;

  return (
    <div
      ref={containerRef}
      style={{
        background: 'var(--wk-bg)',
        borderRadius: 16,
        padding: '20px 22px',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '70vh',
        overflow: 'hidden',
      }}
    >
      {/* Meta row */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span className="wk-micro">{metaLabel}</span>
        {elapsedDisplay && (
          <span className="wk-mono" style={{ fontSize: 12, color: 'var(--wk-text-2)' }}>{elapsedDisplay}</span>
        )}
      </div>

      {/* Title + toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
        <h1 style={{
          margin: 0, fontSize: 27, fontWeight: 600, letterSpacing: '-0.02em',
          color: 'var(--wk-text)',
          fontFamily: "'Geist', system-ui, sans-serif",
        }}>
          {day.name}
        </h1>
        <ModeToggle mode={viewMode} onChange={switchMode} />
      </div>

      {/* Progress block */}
      <div style={{ margin: '16px 0 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
          <span className="wk-micro">Sets</span>
          <span className="wk-mono" style={{ fontSize: 11, color: 'var(--wk-text-2)' }}>{loggedSets} / {totalSets}</span>
        </div>
        <HairlineProgress done={loggedSets} total={totalSets} />
      </div>

      {/* Body */}
      {viewMode === 'list' ? (
        <ListBody
          entries={entries}
          menuFor={menuFor}
          setMenuFor={setMenuFor}
          expandedOverrides={expandedOverrides}
          setExpandedOverrides={setExpandedOverrides}
          getGhost={getGhost}
          catalogByNameMap={catalogByNameMap}
          openNotes={openNotes}
          notesDraft={notesDraft}
          onToggleNotes={onToggleNotes}
          onUpdateNotesDraft={onUpdateNotesDraft}
          onSaveNotes={onSaveNotes}
          openInstructions={openInstructions}
          instructionsDraft={instructionsDraft}
          onToggleInstructions={onToggleInstructions}
          onUpdateInstructionsDraft={onUpdateInstructionsDraft}
          onSaveInstructions={onSaveInstructions}
          onOpenKeypad={onOpenKeypad}
          onQuickLog={onQuickLog}
          onOpenHistory={onOpenHistory}
          onEditSets={onEditSets}
          onReplace={onReplace}
          onMyoMatch={onMyoMatch}
        />
      ) : (
        <FocusBody
          entries={entries}
          focusExIdx={focusExIdx}
          setFocusExIdx={setFocusExIdx}
          menuFor={menuFor}
          setMenuFor={setMenuFor}
          getGhost={getGhost}
          catalogByNameMap={catalogByNameMap}
          restTimer={restTimer}
          restEnabled={restEnabled}
          onDismissRest={onDismissRest}
          openNotes={openNotes}
          notesDraft={notesDraft}
          onToggleNotes={onToggleNotes}
          onUpdateNotesDraft={onUpdateNotesDraft}
          onSaveNotes={onSaveNotes}
          openInstructions={openInstructions}
          instructionsDraft={instructionsDraft}
          onToggleInstructions={onToggleInstructions}
          onUpdateInstructionsDraft={onUpdateInstructionsDraft}
          onSaveInstructions={onSaveInstructions}
          onOpenKeypad={onOpenKeypad}
          onQuickLog={onQuickLog}
          onOpenHistory={onOpenHistory}
          onEditSets={onEditSets}
          onReplace={onReplace}
          onMyoMatch={onMyoMatch}
        />
      )}

      {/* Floating rest chip — list mode only */}
      {viewMode === 'list' && restEnabled && restTimer && !restTimer.done && (
        <RestChip restTimer={restTimer} onDismiss={onDismissRest} />
      )}
    </div>
  );
}
