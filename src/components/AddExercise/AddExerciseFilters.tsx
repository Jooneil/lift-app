import type { FilterState, EquipFilter } from './useExerciseFilters';
import type { SearchSource } from '../../types';
import EquipmentIcon, { EQUIP_LABEL } from './EquipmentIcon';

const MUSCLE_PPL: { group: string; muscles: string[] }[] = [
  { group: 'Push',  muscles: ['Chest', 'Front Delt', 'Side Delt', 'Tricep'] },
  { group: 'Pull',  muscles: ['Bicep', 'Forearm', 'Lats', 'Rear Delt', 'Traps', 'Upper Back'] },
  { group: 'Legs',  muscles: ['Calves', 'Glutes', 'Hamstrings', 'Quads'] },
  { group: 'Core',  muscles: ['Abs', 'Lower Back'] },
];

const EQUIP_OPTIONS: EquipFilter[] = ['free_weight', 'machine', 'cable', 'body_weight'];

type Props = {
  filters: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
  onClear: () => void;
  filterCount: number;
};

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '4px 11px', borderRadius: 9999, fontSize: 12, fontWeight: 500, cursor: 'pointer',
        background: active ? 'var(--accent-muted)' : 'var(--bg-card)',
        border: `1px solid ${active ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        transition: 'all 0.12s ease',
      }}
    >
      {children}
    </button>
  );
}

export default function AddExerciseFilters({ filters, onChange, onClear, filterCount }: Props) {
  const toggleEquip = (eq: EquipFilter) => {
    const next = filters.equipment.includes(eq)
      ? filters.equipment.filter((e) => e !== eq)
      : [...filters.equipment, eq];
    onChange({ equipment: next });
  };

  return (
    <div style={{ padding: '10px 14px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>

      {/* Muscle rows — grouped by PPL + Core */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Muscle</div>
          <Chip active={filters.muscle === 'All'} onClick={() => onChange({ muscle: 'All' })}>All</Chip>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {MUSCLE_PPL.map(({ group, muscles }) => (
            <div key={group} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', minWidth: 32 }}>{group}</span>
              {muscles.map((m) => (
                <Chip key={m} active={filters.muscle === m} onClick={() => onChange({ muscle: m })}>{m}</Chip>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Equipment row */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>Equipment</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {EQUIP_OPTIONS.map((eq) => (
            <Chip key={eq} active={filters.equipment.includes(eq)} onClick={() => toggleEquip(eq)}>
              <EquipmentIcon type={eq} size={12} />
              {EQUIP_LABEL[eq]}
            </Chip>
          ))}
        </div>
      </div>

      {/* Bottom row: Compound + Source + Clear */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          <Chip active={filters.compoundOnly} onClick={() => onChange({ compoundOnly: !filters.compoundOnly })}>
            Compound only
          </Chip>
          {(['all', 'defaults', 'home_made'] as SearchSource[]).map((s) => (
            <Chip key={s} active={filters.source === s} onClick={() => onChange({ source: s })}>
              {s === 'all' ? 'All sources' : s === 'defaults' ? 'Defaults' : 'Custom'}
            </Chip>
          ))}
        </div>
        {filterCount > 0 && (
          <button
            onClick={onClear}
            style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 2 }}
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
