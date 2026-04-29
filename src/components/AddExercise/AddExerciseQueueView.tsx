import type { CatalogExercise } from '../../types';
import EquipmentIcon, { EQUIP_LABEL, getEquipmentType } from './EquipmentIcon';
import { XIcon } from '../Icons';

export type QueueItem = { id: string; name: string; exercise: CatalogExercise };

type Props = {
  queue: QueueItem[];
  dayName: string;
  onMove: (index: number, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onBack: () => void;
};

function ChevronUp({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 10 8 6 12 10" />
    </svg>
  );
}

function ChevronDown({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 6 8 10 12 6" />
    </svg>
  );
}

export default function AddExerciseQueueView({ queue, dayName, onMove, onRemove, onBack }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px 8px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', color: 'var(--accent-blue)', fontSize: 13, fontWeight: 500 }}
        >
          ← Back to list
        </button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{queue.length} queued</span>
      </div>

      {/* Queue items */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {queue.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            Queue is empty — tap + on an exercise to add
          </div>
        ) : (
          queue.map((item, i) => {
            const equipType = getEquipmentType(item.exercise);
            return (
              <div
                key={item.id}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)' }}
              >
                {/* Order number */}
                <div style={{ width: 26, height: 26, borderRadius: 9999, border: '1.5px solid var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0 }}>
                  {i + 1}
                </div>

                {/* Name + meta */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                  {equipType && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      <EquipmentIcon type={equipType} size={12} />
                      {EQUIP_LABEL[equipType]}
                    </div>
                  )}
                </div>

                {/* Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                  <button
                    onClick={() => onMove(i, -1)}
                    disabled={i === 0}
                    style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 6, cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? 'var(--text-muted)' : 'var(--text-secondary)', opacity: i === 0 ? 0.4 : 1 }}
                    aria-label="Move up"
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    onClick={() => onMove(i, 1)}
                    disabled={i === queue.length - 1}
                    style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 6, cursor: i === queue.length - 1 ? 'default' : 'pointer', color: i === queue.length - 1 ? 'var(--text-muted)' : 'var(--text-secondary)', opacity: i === queue.length - 1 ? 0.4 : 1 }}
                    aria-label="Move down"
                  >
                    <ChevronDown size={13} />
                  </button>
                  <button
                    onClick={() => onRemove(item.id)}
                    style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--color-error, #f87171)', borderRadius: 6, cursor: 'pointer', color: 'var(--color-error, #f87171)' }}
                    aria-label="Remove"
                  >
                    <XIcon size={12} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footnote */}
      {queue.length > 0 && (
        <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          They'll be appended to {dayName} in this order.
        </div>
      )}
    </div>
  );
}
