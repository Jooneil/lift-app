import { useState } from 'react';
import MenuShell from './MenuShell';
import MenuRow from './MenuRow';

type GhostMode = 'default' | 'full-body';

type Props = {
  planCount: number;
  ghostMode: GhostMode;
  onGhostModeChange: (mode: GhostMode) => void;
  onNewPlan: () => void;
  onAIBuilder: () => void;
  onSwitchPlan: () => void;
  onEditPlan: () => void;
  onClose: () => void;
};

const plus = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>;
const sparkle = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v2M8 12v2M2 8h2M12 8h2M4.1 4.1l1.4 1.4M10.5 10.5l1.4 1.4M4.1 11.9l1.4-1.4M10.5 5.5l1.4-1.4"/><circle cx="8" cy="8" r="2"/></svg>;
const swap = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h9l-2-2M13 11H4l2 2" /></svg>;
const edit = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 2.5l2.5 2.5L5 13.5H2.5V11L11 2.5z" /></svg>;
const ghost = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 13V7a5 5 0 0 1 10 0v6l-2-1.5-2 1.5-2-1.5-2 1.5z" /><circle cx="6.5" cy="7.5" r="0.5" fill="currentColor" /><circle cx="9.5" cy="7.5" r="0.5" fill="currentColor" /></svg>;
const back = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3l-5 5 5 5" /></svg>;
const check = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3 3 7-7" /></svg>;

const GHOST_OPTS: { id: GhostMode; label: string; desc: string }[] = [
  { id: 'default', label: 'Default', desc: 'Ghost shows your most recent performance regardless of day.' },
  { id: 'full-body', label: 'Full body', desc: 'Ghost only shows performance from the same day (e.g., Tuesday vs Tuesday).' },
];

export default function GearMenu({ planCount, ghostMode, onGhostModeChange, onNewPlan, onAIBuilder, onSwitchPlan, onEditPlan, onClose }: Props) {
  const [view, setView] = useState<'main' | 'ghosting'>('main');

  if (view === 'ghosting') {
    return (
      <MenuShell minWidth={300}>
        <button
          onClick={() => setView('main')}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px 8px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
        >
          <span style={{ width: 14, height: 14, color: 'var(--text-muted)', display: 'flex' }}>{back}</span>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Ghosting</span>
        </button>
        {GHOST_OPTS.map(o => {
          const selected = ghostMode === o.id;
          return (
            <button
              key={o.id}
              onClick={() => onGhostModeChange(o.id)}
              style={{ width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', background: 'transparent', border: 'none', borderTop: '1px solid var(--border-subtle)', cursor: 'pointer', textAlign: 'left' }}
            >
              <span style={{ width: 16, height: 16, color: selected ? 'var(--accent-blue)' : 'transparent', display: 'flex', flexShrink: 0, marginTop: 2 }}>{check}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: selected ? 600 : 500, color: 'var(--text-primary)' }}>{o.label}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{o.desc}</span>
              </div>
            </button>
          );
        })}
      </MenuShell>
    );
  }

  return (
    <MenuShell minWidth={260}>
      <div style={{ padding: '10px 14px 6px', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Plan</div>
      <MenuRow icon={plus} label="New plan" sub="Start a blank plan" onClick={() => { onNewPlan(); onClose(); }} />
      <MenuRow icon={sparkle} label="AI Builder" sub="Generate a plan with AI" onClick={() => { onAIBuilder(); onClose(); }} bordered />
      <MenuRow icon={swap} label="Switch plan" sub={`${planCount} plan${planCount !== 1 ? 's' : ''} saved`} onClick={() => { onSwitchPlan(); onClose(); }} bordered />
      <div style={{ borderTop: '4px solid var(--bg-card)' }}>
        <MenuRow icon={edit} label="Edit plan" sub="Rename, manage weeks & days" onClick={() => { onEditPlan(); onClose(); }} />
        <MenuRow
          icon={ghost}
          label="Ghosting"
          sub={ghostMode === 'full-body' ? 'Full body · Same day' : 'Default · Most recent'}
          onClick={() => setView('ghosting')}
          bordered
        />
      </div>
    </MenuShell>
  );
}
