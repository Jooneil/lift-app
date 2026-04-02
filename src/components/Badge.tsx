import React from "react";

export type BadgeVariant = "default" | "success" | "error" | "purple" | "muted";

export type BadgeProps = {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-accent-blue-muted text-accent-blue border-accent-blue",
  success: "bg-success-muted text-success border-success",
  error: "bg-error-muted text-error border-error",
  purple: "bg-accent-purple-muted text-accent-purple border-accent-purple",
  muted: "bg-elevated text-muted border-subtle",
};

export default function Badge({
  variant = "default",
  children,
  className,
  style,
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold tracking-[-0.005em] leading-[1.4] ${variantClasses[variant]} ${className ?? ""}`}
      style={style}
    >
      {children}
    </span>
  );
}
