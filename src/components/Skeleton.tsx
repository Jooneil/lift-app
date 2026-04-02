import React from "react";

export type SkeletonProps = {
  lines?: number;
  height?: number;
  width?: string;
  className?: string;
  style?: React.CSSProperties;
};

export default function Skeleton({
  lines = 3,
  height = 16,
  width = "100%",
  className,
  style,
}: SkeletonProps) {
  return (
    <div className={`flex flex-col gap-3 p-6 ${className ?? ""}`} style={style}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="skeleton-shimmer rounded-sm bg-[linear-gradient(90deg,var(--color-card)_25%,var(--color-card-hover)_50%,var(--color-card)_75%)] bg-[length:200%_100%]"
          style={{
            height,
            width: i === lines - 1 ? "60%" : width,
          }}
        />
      ))}
    </div>
  );
}
