import React from "react";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  error?: string;
  block?: boolean;
  className?: string;
};

export type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  error?: string;
  block?: boolean;
  className?: string;
};

export function Input({ error, block, className, style, ...rest }: InputProps) {
  return (
    <>
      <input
        className={`${block ? "w-full" : ""} ${error ? "!border-error" : ""} ${className ?? ""}`}
        style={style}
        {...rest}
      />
      {error && <div className="text-error text-[13px] mt-1">{error}</div>}
    </>
  );
}

export function TextArea({ error, block, className, style, ...rest }: TextAreaProps) {
  return (
    <>
      <textarea
        className={`${block ? "w-full" : ""} ${error ? "!border-error" : ""} ${className ?? ""}`}
        style={style}
        {...rest}
      />
      {error && <div className="text-error text-[13px] mt-1">{error}</div>}
    </>
  );
}
