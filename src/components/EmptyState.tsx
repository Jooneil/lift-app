import React from "react";

export type EmptyStateProps = {
  icon?: string;
  message: string;
  action?: React.ReactNode;
  style?: React.CSSProperties;
};

export default function EmptyState({
  icon,
  message,
  action,
  style,
}: EmptyStateProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 24,
        color: "var(--text-muted)",
        textAlign: "center",
        ...style,
      }}
    >
      {icon && <div style={{ fontSize: 32, lineHeight: 1 }}>{icon}</div>}
      <div style={{ fontSize: 15 }}>{message}</div>
      {action}
    </div>
  );
}
