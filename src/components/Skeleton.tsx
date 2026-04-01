import React from "react";

export type SkeletonProps = {
  lines?: number;
  height?: number;
  width?: string;
  style?: React.CSSProperties;
};

export default function Skeleton({
  lines = 3,
  height = 16,
  width = "100%",
  style,
}: SkeletonProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 24,
        ...style,
      }}
    >
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="skeleton-shimmer"
          style={{
            height,
            width: i === lines - 1 ? "60%" : width,
            borderRadius: 8,
            background:
              "linear-gradient(90deg, var(--bg-card) 25%, var(--bg-card-hover) 50%, var(--bg-card) 75%)",
            backgroundSize: "200% 100%",
          }}
        />
      ))}
    </div>
  );
}
