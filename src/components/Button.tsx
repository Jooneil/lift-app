import React from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "pill";
export type ButtonSize = "xs" | "sm" | "md";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  active?: boolean;
  className?: string;
};

const variantClasses: Record<ButtonVariant, string> = {
  secondary: "",
  primary:
    "border-white/20 font-semibold bg-linear-to-b from-primary to-[#d8d8e0] text-[#0a0a0c] shadow-primary-btn",
  ghost: "border-transparent bg-transparent text-secondary shadow-none",
  danger: "border-subtle bg-elevated text-error",
  pill: "inline-flex items-center gap-2 border-subtle bg-elevated text-secondary tracking-[-0.005em] !rounded-full px-3 py-2 text-[13px]",
};

const sizeClasses: Record<ButtonSize, string> = {
  md: "px-3.5 py-2.5 rounded-md",
  sm: "px-2.5 py-1.5 rounded-sm text-[13px] tracking-[-0.005em]",
  xs: "px-2 py-1 rounded-sm text-[13px] tracking-[-0.005em]",
};

export default function Button({
  variant = "secondary",
  size = "md",
  block = false,
  active = false,
  className,
  style,
  children,
  ...rest
}: ButtonProps) {
  const isPill = variant === "pill";

  const classes = [
    !isPill && sizeClasses[size],
    variantClasses[variant],
    isPill && active && "bg-accent-blue-muted border-accent-blue text-accent-blue",
    block && "w-full",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={classes} style={style} {...rest}>
      {children}
    </button>
  );
}
