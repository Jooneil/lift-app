type Props = {
  icon?: React.ReactNode;
  label: string;
  sub?: string;
  onClick?: () => void;
  danger?: boolean;
  bordered?: boolean;
};

export default function MenuRow({ icon, label, sub, onClick, danger, bordered }: Props) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 14px',
        background: 'transparent',
        border: 'none',
        borderTop: bordered ? '1px solid var(--border-subtle)' : 'none',
        cursor: onClick ? 'pointer' : 'default',
        fontSize: 13,
        color: danger ? 'var(--error)' : 'var(--text-primary)',
        textAlign: 'left',
      }}
    >
      {icon && (
        <span style={{ width: 16, height: 16, color: danger ? 'var(--error)' : 'var(--text-secondary)', display: 'flex', flexShrink: 0 }}>
          {icon}
        </span>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 500 }}>{label}</span>
        {sub && <span style={{ fontSize: 11, color: danger ? 'var(--error)' : 'var(--text-muted)' }}>{sub}</span>}
      </div>
    </button>
  );
}
