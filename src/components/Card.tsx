import React from "react";

export type CardProps = {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
};

export default function Card({ children, style, className }: CardProps) {
  return (
    <div
      className={`bg-card border border-subtle rounded-md p-4 shadow-card ${className ?? ""}`}
      style={style}
    >
      {children}
    </div>
  );
}
