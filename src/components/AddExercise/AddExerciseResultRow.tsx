import type { CatalogExercise } from '../../types';
import EquipmentIcon, { EQUIP_LABEL, getEquipmentType } from './EquipmentIcon';

type Props = {
  exercise: CatalogExercise;
  queued: boolean;
  inDay: boolean;
  onToggleQueue: () => void;
  onDelete?: () => void;
};

export default function AddExerciseResultRow({ exercise, queued, inDay, onToggleQueue, onDelete }: Props) {
  const equipType = getEquipmentType(exercise);

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', cursor: inDay ? 'default' : 'pointer',
        borderBottom: '1px solid var(--border-subtle)',
        background: queued ? 'var(--accent-muted)' : 'transparent',
        transition: 'background 0.12s ease',
      }}
      onClick={inDay ? undefined : onToggleQueue}
    >
      {/* Name + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {exercise.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, flexWrap: 'wrap' }}>
          {equipType && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
              <EquipmentIcon type={equipType} size={12} />
              {EQUIP_LABEL[equipType]}
            </span>
          )}
          {exercise.isCompound && (
            <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 9999, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
              Compound
            </span>
          )}
          {exercise.isCustom && (
            <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 9999, background: 'var(--accent-purple-muted)', border: '1px solid var(--accent-purple)', color: 'var(--accent-purple)' }}>
              Custom
            </span>
          )}
        </div>
      </div>

      {/* Right: controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            style={{ width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--color-error, #f87171)', color: 'var(--color-error, #f87171)', cursor: 'pointer', fontSize: 13 }}
            aria-label="Delete custom exercise"
          >
            ×
          </button>
        )}
        {inDay ? (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>In day</span>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleQueue(); }}
            style={{
              width: 28, height: 28, borderRadius: 9999,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: queued ? 'var(--accent-blue)' : 'var(--bg-card)',
              border: `1px solid ${queued ? 'var(--accent-blue)' : 'var(--border-subtle)'}`,
              color: queued ? '#fff' : 'var(--text-secondary)',
              cursor: 'pointer', fontSize: 18, lineHeight: 1,
              transition: 'all 0.12s ease',
            }}
            aria-label={queued ? 'Remove from queue' : 'Add to queue'}
          >
            {queued ? '−' : '+'}
          </button>
        )}
      </div>
    </div>
  );
}
