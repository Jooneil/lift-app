import React from "react";

export type EmptyStateProps = {
  icon?: string;
  message: string;
  action?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

export default function EmptyState({
  icon,
  message,
  action,
  className,
  style,
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 p-6 text-muted text-center ${className ?? ""}`}
      style={style}
    >
      {icon && <div className="text-[32px] leading-none">{icon}</div>}
      <div className="text-[15px]">{message}</div>
      {action}
    </div>
  );
}
