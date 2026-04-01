import React from "react";

export type BadgeVariant = "default" | "success" | "error" | "purple" | "muted";

export type BadgeProps = {
  variant?: BadgeVariant;
  children: React.ReactNode;
  style?: React.CSSProperties;
};

const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
  default: {
    background: "var(--accent-blue-muted)",
    color: "var(--accent-blue)",
    borderColor: "var(--accent-blue)",
  },
  success: {
    background: "var(--success-muted)",
    color: "var(--success)",
    borderColor: "var(--success)",
  },
  error: {
    background: "var(--error-muted)",
    color: "var(--error)",
    borderColor: "var(--error)",
  },
  purple: {
    background: "var(--accent-purple-muted)",
    color: "var(--accent-purple)",
    borderColor: "var(--accent-purple)",
  },
  muted: {
    background: "var(--bg-elevated)",
    color: "var(--text-muted)",
    borderColor: "var(--border-subtle)",
  },
};

export default function Badge({
  variant = "default",
  children,
  style,
}: BadgeProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 999,
        border: "1px solid",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "-0.005em",
        lineHeight: 1.4,
        ...variantStyles[variant],
        ...style,
      }}
    >
      {children}
    </span>
  );
}
