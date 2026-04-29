import MenuShell from './MenuShell';
import MenuRow from './MenuRow';

const APP_VERSION = (import.meta.env as Record<string, string>).VITE_APP_VERSION ?? '1.0.0';

const userIcon = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="6" r="2.5" /><path d="M3 14c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5" /></svg>;
const slidersIcon = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 4h8M12 4h2M2 8h2M6 8h8M2 12h8M12 12h2" /><circle cx="11" cy="4" r="1.5" /><circle cx="5" cy="8" r="1.5" /><circle cx="11" cy="12" r="1.5" /></svg>;
const archiveIcon = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="12" height="3" rx="1" /><path d="M3 6v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6M6 9h4" /></svg>;

type Props = {
  userEmail: string;
  onPreferences: () => void;
  onArchive: () => void;
  onLogout: () => void;
};

export default function AppMenu({ userEmail, onPreferences, onArchive, onLogout }: Props) {
  return (
    <MenuShell minWidth={260}>
      <div style={{ padding: '10px 14px 6px', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Settings</div>
      <MenuRow icon={userIcon} label="Account" sub={userEmail} />
      <MenuRow icon={slidersIcon} label="App preferences" sub="Timer, ghost, theme" onClick={onPreferences} bordered />
      <MenuRow icon={archiveIcon} label="Archive" sub="Past plans & sessions" onClick={onArchive} bordered />
      <div style={{ borderTop: '4px solid var(--bg-card)' }}>
        <MenuRow label="Log out" onClick={onLogout} danger />
      </div>
      <div style={{ padding: '8px 14px', background: 'var(--bg-card)', borderTop: '1px solid var(--border-subtle)', fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', letterSpacing: '0.04em' }}>
        Lift v{APP_VERSION}
      </div>
    </MenuShell>
  );
}
