import { useEffect, useRef } from 'react';

type Props = {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
};

export default function AddExerciseSearch({ value, onChange, autoFocus }: Props) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) {
      const t = setTimeout(() => ref.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [autoFocus]);

  return (
    <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {/* Search icon */}
        <svg
          viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
          style={{ position: 'absolute', left: 10, width: 16, height: 16, color: 'var(--text-muted)', pointerEvents: 'none' }}
        >
          <circle cx="6.5" cy="6.5" r="4" />
          <line x1="10" y1="10" x2="13.5" y2="13.5" />
        </svg>
        <input
          ref={ref}
          data-tutorial-id="sheet-search"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search exercises…"
          style={{
            width: '100%',
            height: 44,
            paddingLeft: 34,
            paddingRight: value ? 34 : 10,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 10,
            fontSize: 15,
            color: 'var(--text-primary)',
            boxShadow: 'none',
          }}
        />
        {value && (
          <button
            onClick={() => onChange('')}
            style={{ position: 'absolute', right: 8, background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
            aria-label="Clear search"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ width: 14, height: 14 }}>
              <line x1="3" y1="3" x2="13" y2="13" /><line x1="13" y1="3" x2="3" y2="13" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
