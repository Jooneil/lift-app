import { useState } from 'react';
import type { Plan } from '../../types';
import MenuShell from './MenuShell';

type Props = {
  plan: Plan;
  selectedWeekId: string;
  selectedDayId: string;
  onSelectDay: (weekId: string, dayId: string) => void;
  onClose: () => void;
};

export default function DayPickerDropdown({ plan, selectedWeekId, selectedDayId, onSelectDay, onClose }: Props) {
  const [showWeeks, setShowWeeks] = useState(false);
  const currentWeek = plan.weeks.find(w => w.id === selectedWeekId);

  const handleSelectDay = (weekId: string, dayId: string) => {
    onSelectDay(weekId, dayId);
    onClose();
  };

  return (
    <MenuShell minWidth={240}>
      <div style={{ padding: '10px 14px 6px', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        {currentWeek?.name ?? 'This week'}
      </div>

      {currentWeek?.days.map((day, i) => {
        const isActive = day.id === selectedDayId;
        return (
          <button
            key={day.id}
            onClick={() => handleSelectDay(selectedWeekId, day.id)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '11px 14px',
              background: isActive ? 'var(--accent-blue-muted)' : 'transparent',
              border: 'none',
              borderTop: i ? '1px solid var(--border-subtle)' : 'none',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            <span style={{ fontWeight: isActive ? 600 : 500, color: isActive ? 'var(--accent-blue)' : 'var(--text-primary)' }}>
              {day.name}
            </span>
            {isActive && (
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent-blue)', flexShrink: 0 }} />
            )}
          </button>
        );
      })}

      <button
        onClick={() => setShowWeeks(v => !v)}
        style={{ width: '100%', padding: '10px 14px', background: 'var(--bg-card)', border: 'none', borderTop: '1px solid var(--border-subtle)', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500, textAlign: 'left' }}
      >
        {showWeeks ? '↑ Hide weeks' : '→ Other weeks'}
      </button>

      {showWeeks && (
        <div style={{ padding: '8px 14px 12px', display: 'flex', flexWrap: 'wrap', gap: 6, borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
          {plan.weeks.map(week => {
            const isActiveWeek = week.id === selectedWeekId;
            return (
              <button
                key={week.id}
                onClick={() => {
                  const firstDay = week.days[0];
                  if (firstDay) handleSelectDay(week.id, firstDay.id);
                }}
                style={{
                  padding: '4px 10px',
                  borderRadius: 9999,
                  border: `1px solid ${isActiveWeek ? 'var(--accent-blue)' : 'var(--border-subtle)'}`,
                  background: isActiveWeek ? 'var(--accent-blue-muted)' : 'var(--bg-elevated)',
                  color: isActiveWeek ? 'var(--accent-blue)' : 'var(--text-secondary)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {week.name}
              </button>
            );
          })}
        </div>
      )}
    </MenuShell>
  );
}
