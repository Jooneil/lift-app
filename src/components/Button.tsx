import React from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "pill";
export type ButtonSize = "xs" | "sm" | "md";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  active?: boolean; // for pill toggle state
};

const base: React.CSSProperties = {
  fontFamily: "inherit",
  cursor: "pointer",
  letterSpacing: "-0.01em",
  transition: "all var(--transition-fast)",
};

const variants: Record<ButtonVariant, React.CSSProperties> = {
  secondary: {
    border: "1px solid var(--border-default)",
    background: "var(--bg-card)",
    color: "var(--text-primary)",
    fontWeight: 500,
  },
  primary: {
    border: "1px solid rgba(255, 255, 255, 0.2)",
    background: "linear-gradient(180deg, #f0f0f2 0%, #d8d8e0 100%)",
    color: "#0a0a0c",
    fontWeight: 600,
    boxShadow:
      "0 1px 3px rgba(0,0,0,0.3), 0 4px 12px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.3)",
  },
  ghost: {
    border: "1px solid transparent",
    background: "transparent",
    color: "var(--text-secondary)",
    fontWeight: 500,
    boxShadow: "none",
  },
  danger: {
    border: "1px solid var(--border-subtle)",
    background: "var(--bg-elevated)",
    color: "var(--error)",
    fontWeight: 500,
  },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    border: "1px solid var(--border-subtle)",
    background: "var(--bg-elevated)",
    color: "var(--text-secondary)",
    fontWeight: 500,
    letterSpacing: "-0.005em",
    borderRadius: 999,
  },
};

const sizes: Record<ButtonSize, React.CSSProperties> = {
  md: { padding: "10px 14px", borderRadius: 12 },
  sm: {
    padding: "6px 10px",
    borderRadius: 8,
    fontSize: 13,
    letterSpacing: "-0.005em",
  },
  xs: {
    padding: "4px 8px",
    borderRadius: 8,
    fontSize: 13,
    letterSpacing: "-0.005em",
  },
};

const pillActive: React.CSSProperties = {
  background: "var(--accent-blue-muted)",
  borderColor: "var(--accent-blue)",
  color: "var(--accent-blue)",
};

export default function Button({
  variant = "secondary",
  size = "md",
  block = false,
  active = false,
  style,
  children,
  ...rest
}: ButtonProps) {
  const isPill = variant === "pill";
  const computed: React.CSSProperties = {
    ...base,
    ...sizes[isPill ? "sm" : size],
    ...variants[variant],
    ...(isPill && { padding: "8px 12px", borderRadius: 999 }),
    ...(isPill && active && pillActive),
    ...(block && { width: "100%" }),
    ...style,
  };

  return (
    <button style={computed} {...rest}>
      {children}
    </button>
  );
}
