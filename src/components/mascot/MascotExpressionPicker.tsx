/**
 * MascotExpressionPicker — grid of selectable expression tiles.
 *
 * Used in the profile "Edit avatar" flow:
 *   <MascotExpressionPicker
 *     value={user.mascotExpression}
 *     onChange={(next) => updateUser({ mascotExpression: next })}
 *   />
 */

import {
  Mascot,
  MASCOT_EXPRESSIONS,
  MASCOT_EXPRESSION_LABELS,
  type MascotExpression,
} from './Mascot';

interface Props {
  value: MascotExpression;
  onChange: (next: MascotExpression) => void;
  /** Tile size in px. Default 96. */
  tileSize?: number;
  /** Force a fixed column count instead of auto-fill. */
  columns?: number;
  className?: string;
}

export function MascotExpressionPicker({
  value,
  onChange,
  tileSize = 96,
  columns,
  className,
}: Props) {
  return (
    <div
      className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: columns
          ? `repeat(${columns}, 1fr)`
          : `repeat(auto-fill, minmax(${tileSize + 24}px, 1fr))`,
        gap: 12,
      }}
      role="radiogroup"
      aria-label="Choose mascot expression"
    >
      {MASCOT_EXPRESSIONS.map((key) => {
        const selected = key === value;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(key)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              padding: '12px 8px 10px',
              borderRadius: 12,
              background: selected ? 'rgba(71,120,255,0.14)' : 'transparent',
              border: `2px solid ${selected ? '#4778FF' : 'transparent'}`,
              transition: 'background 0.12s, border-color 0.12s',
            }}
          >
            <Mascot expression={key} size={tileSize} idSuffix={`pick-${key}`} />
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: selected ? '#4778FF' : 'currentColor',
                opacity: selected ? 1 : 0.72,
              }}
            >
              {MASCOT_EXPRESSION_LABELS[key]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default MascotExpressionPicker;
