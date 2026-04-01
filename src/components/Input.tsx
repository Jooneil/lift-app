import React from "react";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  error?: string;
  block?: boolean;
};

export type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  error?: string;
  block?: boolean;
};

const inputBase: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid var(--border-default)",
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  transition: "all var(--transition-fast)",
  boxShadow: "inset 0 1px 2px rgba(0, 0, 0, 0.2)",
  fontFamily: "inherit",
  fontSize: "inherit",
};

export function Input({ error, block, style, ...rest }: InputProps) {
  return (
    <>
      <input
        style={{
          ...inputBase,
          ...(block && { width: "100%", boxSizing: "border-box" as const }),
          ...(error && { borderColor: "var(--error)" }),
          ...style,
        }}
        {...rest}
      />
      {error && (
        <div
          style={{
            color: "var(--error)",
            fontSize: 13,
            marginTop: 4,
          }}
        >
          {error}
        </div>
      )}
    </>
  );
}

export function TextArea({ error, block, style, ...rest }: TextAreaProps) {
  return (
    <>
      <textarea
        style={{
          ...inputBase,
          ...(block && { width: "100%", boxSizing: "border-box" as const }),
          ...(error && { borderColor: "var(--error)" }),
          resize: "vertical" as const,
          ...style,
        }}
        {...rest}
      />
      {error && (
        <div
          style={{
            color: "var(--error)",
            fontSize: 13,
            marginTop: 4,
          }}
        >
          {error}
        </div>
      )}
    </>
  );
}
