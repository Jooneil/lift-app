import { useState, useCallback, useEffect, useMemo } from 'react';
import type { CatalogExercise } from '../../types';
import type { FilterState } from './useExerciseFilters';
import { useExerciseFilters, EMPTY_FILTERS, filterCount } from './useExerciseFilters';
import AddExerciseContextBar from './AddExerciseContextBar';
import AddExerciseSearch from './AddExerciseSearch';
import AddExerciseFilters from './AddExerciseFilters';
import AddExerciseResultRow from './AddExerciseResultRow';
import AddExerciseQueueView, { type QueueItem } from './AddExerciseQueueView';
import { MUSCLE_GROUPS } from '../../types';

type CreateCustomInput = {
  name: string;
  primaryMuscle: string;
  equipment: 'machine' | 'free_weight' | 'cable' | 'body_weight';
  isCompound: boolean;
  secondaryMuscles?: string[];
};

type ReplaceScope = 'today' | 'remaining';

export type AddExerciseSheetProps = {
  open: boolean;
  onClose: () => void;
  mode: 'add' | 'replace';
  dayName: string;
  dayItems: Array<{ exerciseName: string; exerciseId?: string }>;
  replaceTarget?: { exerciseName: string; primaryMuscle?: string };
  catalogExercises: CatalogExercise[];
  onConfirmAdd: (names: string[]) => Promise<void>;
  onConfirmReplace?: (firstName: string, scope: ReplaceScope, extras: string[]) => Promise<void>;
  onCreateCustom: (input: CreateCustomInput) => Promise<CatalogExercise>;
  onDeleteCustom?: (id: string) => Promise<void>;
  defaultView?: 'results' | 'queue';
};

const norm = (s: string) => s.toLowerCase().trim();

function uid() {
  return Math.random().toString(36).slice(2);
}

export default function AddExerciseSheet({
  open,
  onClose,
  mode,
  dayName,
  dayItems,
  replaceTarget,
  catalogExercises,
  onConfirmAdd,
  onConfirmReplace,
  onCreateCustom,
  onDeleteCustom,
  defaultView = 'results',
}: AddExerciseSheetProps) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<'results' | 'queue'>(defaultView);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [replaceScope, setReplaceScope] = useState<ReplaceScope | null>(null);

  // Create custom exercise form
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createPrimary, setCreatePrimary] = useState('');
  const [createEquipment, setCreateEquipment] = useState<'' | 'machine' | 'free_weight' | 'cable' | 'body_weight'>('');
  const [createCompound, setCreateCompound] = useState(false);
  const [createSecondary, setCreateSecondary] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSaving, setCreateSaving] = useState(false);

  // Reset on open/close
  useEffect(() => {
    if (open) {
      setSearch('');
      setFilters(EMPTY_FILTERS);
      setFiltersOpen(false);
      setView(defaultView);
      setQueue([]);
      setConfirming(false);
      setReplaceScope(null);
      setCreateOpen(false);
      resetCreate();
    }
  }, [open, defaultView]);

  const resetCreate = () => {
    setCreateName('');
    setCreatePrimary('');
    setCreateEquipment('');
    setCreateCompound(false);
    setCreateSecondary('');
    setCreateError(null);
  };

  // Filtered results
  const filtersWithSearch: FilterState = useMemo(() => ({ ...filters, search }), [filters, search]);
  const { filtered, grouped } = useExerciseFilters(catalogExercises, filtersWithSearch);
  const activeFilterCount = filterCount(filters);

  // Day item name set (for "In day" labels)
  const dayItemNames = useMemo(() => new Set(dayItems.map((d) => norm(d.exerciseName))), [dayItems]);

  // Queue helpers
  const queueNames = useMemo(() => new Set(queue.map((q) => norm(q.name))), [queue]);

  const toggleQueue = useCallback((ex: CatalogExercise) => {
    setQueue((prev) => {
      const key = norm(ex.name);
      if (prev.some((q) => norm(q.name) === key)) {
        return prev.filter((q) => norm(q.name) !== key);
      }
      return [...prev, { id: uid(), name: ex.name, exercise: ex }];
    });
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setQueue((prev) => prev.filter((q) => q.id !== id));
  }, []);

  const moveInQueue = useCallback((index: number, dir: -1 | 1) => {
    setQueue((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  // Confirm
  const handleConfirm = async () => {
    if (queue.length === 0) return;
    setConfirming(true);
    try {
      if (mode === 'replace' && onConfirmReplace) {
        // Replace mode needs scope selection — show scope picker if not yet chosen
        if (!replaceScope) {
          setReplaceScope('today'); // opens scope UI — handled below in JSX
          setConfirming(false);
          return;
        }
        const [first, ...extras] = queue.map((q) => q.name);
        await onConfirmReplace(first, replaceScope, extras);
      } else {
        await onConfirmAdd(queue.map((q) => q.name));
      }
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setConfirming(false);
    }
  };

  const handleCreateCustom = async () => {
    const name = createName.trim();
    if (!name) { setCreateError('Enter a name.'); return; }
    if (!createPrimary) { setCreateError('Select a primary muscle.'); return; }
    if (!createEquipment) { setCreateError('Select equipment type.'); return; }
    setCreateSaving(true);
    setCreateError(null);
    try {
      const created = await onCreateCustom({
        name,
        primaryMuscle: createPrimary,
        equipment: createEquipment,
        isCompound: createCompound,
        secondaryMuscles: createCompound && createSecondary ? [createSecondary] : [],
      });
      // Auto-queue the new exercise
      setQueue((prev) => [...prev, { id: uid(), name: created.name, exercise: created }]);
      setCreateOpen(false);
      resetCreate();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreateSaving(false);
    }
  };

  const handleDeleteCustom = async (ex: CatalogExercise) => {
    if (!ex.isCustom || !onDeleteCustom) return;
    if (!window.confirm(`Delete "${ex.name}"?`)) return;
    try {
      await onDeleteCustom(ex.id);
      setQueue((prev) => prev.filter((q) => norm(q.name) !== norm(ex.name)));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  if (!open) return null;

  const canConfirm = queue.length > 0;
  const ctaLabel = queue.length === 0
    ? (mode === 'replace' ? 'Tap an exercise to select' : 'Tap an exercise to add')
    : mode === 'replace'
      ? `Replace with ${queue.length === 1 ? queue[0].name : `${queue.length} exercises`}`
      : `Add ${queue.length} to ${dayName}`;

  // Whether results are grouped (search is active = flat list sorted by relevance)
  const isSearching = search.trim().length > 0;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200 }}
      />

      {/* Sheet */}
      <div style={{
        position: 'fixed',
        // Mobile: bottom sheet
        bottom: 0, left: 0, right: 0, top: '5vh',
        borderRadius: '20px 20px 0 0',
        // Desktop override via inline style — Tailwind responsive not available here
        zIndex: 201,
        background: 'var(--bg-elevated)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.5)',
      }}
        className="add-exercise-sheet"
      >
        {/* Context bar */}
        <AddExerciseContextBar
          mode={mode}
          dayName={dayName}
          dayItemCount={dayItems.length}
          replaceTargetName={replaceTarget?.exerciseName}
          replaceTargetMuscle={replaceTarget?.primaryMuscle}
          onClose={onClose}
        />

        {/* Search */}
        <AddExerciseSearch value={search} onChange={setSearch} autoFocus={open} />

        {/* Toggle bar: Filters + Queue pills */}
        <div style={{ display: 'flex', gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 13px', borderRadius: 9999, fontSize: 13, fontWeight: 500, cursor: 'pointer',
              background: filtersOpen || activeFilterCount > 0 ? 'var(--accent-muted)' : 'var(--bg-card)',
              border: `1px solid ${filtersOpen || activeFilterCount > 0 ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
              color: filtersOpen || activeFilterCount > 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
          >
            Filters
            {activeFilterCount > 0 && (
              <span style={{ minWidth: 18, height: 18, borderRadius: 9999, background: 'var(--accent-blue)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                {activeFilterCount}
              </span>
            )}
            <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              {filtersOpen ? <polyline points="2 7 5 3 8 7" /> : <polyline points="2 3 5 7 8 3" />}
            </svg>
          </button>

          <button
            onClick={() => setView('queue')}
            disabled={queue.length === 0 && view !== 'queue'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 13px', borderRadius: 9999, fontSize: 13, fontWeight: 500, cursor: queue.length === 0 && view !== 'queue' ? 'default' : 'pointer',
              background: view === 'queue' ? 'var(--accent-muted)' : 'var(--bg-card)',
              border: `1px solid ${view === 'queue' ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
              color: queue.length === 0 && view !== 'queue' ? 'var(--text-muted)' : view === 'queue' ? 'var(--text-primary)' : 'var(--text-secondary)',
              opacity: queue.length === 0 && view !== 'queue' ? 0.5 : 1,
            }}
          >
            Queue
            {queue.length > 0 && (
              <span style={{ minWidth: 18, height: 18, borderRadius: 9999, background: 'var(--accent-blue)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                {queue.length}
              </span>
            )}
          </button>

          <button
            onClick={() => { setCreateOpen((v) => !v); setView('results'); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 13px', borderRadius: 9999, fontSize: 13, fontWeight: 500, cursor: 'pointer',
              background: createOpen ? 'var(--accent-muted)' : 'var(--bg-card)',
              border: `1px solid ${createOpen ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
              color: createOpen ? 'var(--text-primary)' : 'var(--text-secondary)',
              marginLeft: 'auto',
            }}
          >
            + Custom
          </button>
        </div>

        {/* Filter block (collapsible) */}
        {filtersOpen && (
          <AddExerciseFilters
            filters={filters}
            onChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
            onClear={() => setFilters(EMPTY_FILTERS)}
            filterCount={activeFilterCount}
          />
        )}

        {/* Main scrollable area: results or queue */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {view === 'queue' ? (
            <AddExerciseQueueView
              queue={queue}
              dayName={dayName}
              onMove={moveInQueue}
              onRemove={removeFromQueue}
              onBack={() => setView('results')}
            />
          ) : (
            <>
              {/* Replace scope picker — shown when user taps confirm in replace mode */}
              {replaceScope !== null && mode === 'replace' && (
                <div style={{ padding: '12px 14px', background: 'var(--accent-muted)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>Apply to:</span>
                  <button
                    onClick={() => { setReplaceScope('today'); }}
                    style={{ padding: '5px 14px', borderRadius: 9999, fontSize: 13, fontWeight: 500, cursor: 'pointer', background: replaceScope === 'today' ? 'var(--accent-blue)' : 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: replaceScope === 'today' ? '#fff' : 'var(--text-secondary)' }}
                  >
                    Today only
                  </button>
                  <button
                    onClick={() => { setReplaceScope('remaining'); }}
                    style={{ padding: '5px 14px', borderRadius: 9999, fontSize: 13, fontWeight: 500, cursor: 'pointer', background: replaceScope === 'remaining' ? 'var(--accent-blue)' : 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: replaceScope === 'remaining' ? '#fff' : 'var(--text-secondary)' }}
                  >
                    Rest of meso
                  </button>
                  <button
                    onClick={async () => {
                      setConfirming(true);
                      try {
                        const [first, ...extras] = queue.map((q) => q.name);
                        await onConfirmReplace!(first, replaceScope!, extras);
                        onClose();
                      } catch (e) { console.error(e); }
                      finally { setConfirming(false); }
                    }}
                    disabled={confirming}
                    style={{ marginLeft: 'auto', padding: '5px 16px', borderRadius: 9999, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'var(--accent-blue)', border: 'none', color: '#fff', opacity: confirming ? 0.6 : 1 }}
                  >
                    {confirming ? '…' : 'Confirm'}
                  </button>
                </div>
              )}

              {/* Create custom form — shown at top of results */}
              {createOpen && (
                <div style={{ margin: '12px 14px', padding: 14, border: '1px solid var(--border-subtle)', borderRadius: 12, background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>Create movement</div>
                  <input
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="Movement name"
                    style={{ fontSize: 14 }}
                  />
                  <select value={createPrimary} onChange={(e) => setCreatePrimary(e.target.value)}>
                    <option value="">Primary muscle</option>
                    {MUSCLE_GROUPS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {(['machine', 'free_weight', 'cable', 'body_weight'] as const).map((eq) => (
                      <label key={eq} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                        <input type="radio" name="create-equip" checked={createEquipment === eq} onChange={() => setCreateEquipment(eq)} />
                        {eq === 'free_weight' ? 'Free weight' : eq === 'body_weight' ? 'Bodyweight' : eq.charAt(0).toUpperCase() + eq.slice(1)}
                      </label>
                    ))}
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={createCompound} onChange={(e) => { setCreateCompound(e.target.checked); if (!e.target.checked) setCreateSecondary(''); }} />
                    Compound
                  </label>
                  {createCompound && (
                    <select value={createSecondary} onChange={(e) => setCreateSecondary(e.target.value)}>
                      <option value="">Secondary muscle (optional)</option>
                      {MUSCLE_GROUPS.filter((m) => m !== createPrimary).map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  )}
                  {createError && <div style={{ color: 'var(--color-error, #f87171)', fontSize: 13 }}>{createError}</div>}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button onClick={() => { setCreateOpen(false); resetCreate(); }} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'none', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                    <button onClick={handleCreateCustom} disabled={createSaving} style={{ padding: '6px 16px', borderRadius: 8, border: 'none', background: 'var(--accent-blue)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: createSaving ? 0.6 : 1 }}>
                      {createSaving ? 'Saving…' : 'Create & add'}
                    </button>
                  </div>
                </div>
              )}

              {/* Empty search state */}
              {isSearching && filtered.length === 0 ? (
                <div style={{ padding: '24px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>No matches for "{search}"</div>
                  <button
                    onClick={() => { setCreateOpen(true); setCreateName(search); }}
                    style={{ padding: '8px 20px', borderRadius: 9999, border: '1px solid var(--border-default)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
                  >
                    Create "{search}"
                  </button>
                </div>
              ) : (
                /* Grouped results */
                grouped.map(({ muscle, exercises }) => (
                  <div key={muscle}>
                    {!isSearching && (
                      <div style={{ padding: '8px 14px 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', background: 'var(--bg-card)', position: 'sticky', top: 0, zIndex: 2 }}>
                        {muscle}
                      </div>
                    )}
                    {exercises.map((ex) => (
                      <AddExerciseResultRow
                        key={`${ex.isCustom ? 'c' : 'd'}:${ex.id}`}
                        exercise={ex}
                        queued={queueNames.has(norm(ex.name))}
                        inDay={dayItemNames.has(norm(ex.name))}
                        onToggleQueue={() => toggleQueue(ex)}
                        onDelete={ex.isCustom ? () => handleDeleteCustom(ex) : undefined}
                      />
                    ))}
                  </div>
                ))
              )}

            </>
          )}
        </div>

        {/* Sticky CTA bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
          borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', flexShrink: 0,
          paddingBottom: 'max(10px, env(safe-area-inset-bottom, 10px))',
        }}>
          <button
            onClick={() => { setQueue([]); setReplaceScope(null); }}
            disabled={queue.length === 0}
            style={{ padding: '10px 18px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'none', color: 'var(--text-secondary)', fontSize: 14, fontWeight: 500, cursor: queue.length === 0 ? 'default' : 'pointer', opacity: queue.length === 0 ? 0.4 : 1 }}
          >
            Clear
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm || confirming}
            style={{
              flex: 1, padding: '10px 18px', borderRadius: 10,
              background: canConfirm ? 'var(--accent-blue)' : 'var(--bg-card)',
              border: canConfirm ? 'none' : '1px solid var(--border-subtle)',
              color: canConfirm ? '#fff' : 'var(--text-muted)',
              fontSize: 14, fontWeight: 600, cursor: canConfirm ? 'pointer' : 'default',
              transition: 'all 0.15s ease', opacity: confirming ? 0.6 : 1,
            }}
          >
            {confirming ? 'Adding…' : ctaLabel}
          </button>
        </div>
      </div>

      {/* Desktop centering override */}
      <style>{`
        @media (min-width: 768px) {
          .add-exercise-sheet {
            top: 50% !important;
            left: 50% !important;
            right: auto !important;
            bottom: auto !important;
            transform: translate(-50%, -50%);
            width: 540px;
            height: 700px;
            border-radius: 20px !important;
            box-shadow: 0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05) !important;
          }
        }
      `}</style>
    </>
  );
}
