type Props = { children: React.ReactNode; minWidth?: number };

export default function MenuShell({ children, minWidth = 260 }: Props) {
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border-default)',
      borderRadius: 12,
      boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
      overflow: 'hidden',
      minWidth,
    }}>
      {children}
    </div>
  );
}
