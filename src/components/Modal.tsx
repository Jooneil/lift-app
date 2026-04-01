import React, { useEffect, useRef } from "react";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  maxWidth?: number | string;
  maxHeight?: string;
  zIndex?: number;
  children: React.ReactNode;
};

export default function Modal({
  open,
  onClose,
  title,
  maxWidth = 600,
  maxHeight = "85vh",
  zIndex = 30,
  children,
}: ModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.80)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: 16,
        zIndex,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-no-ptr
    >
      <div
        ref={contentRef}
        className="modal-content"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 16,
          padding: 24,
          boxShadow:
            "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)",
          maxHeight,
          maxWidth,
          width: "100%",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              {title}
            </h3>
            <button
              onClick={onClose}
              style={{
                padding: "4px 8px",
                borderRadius: 8,
                border: "1px solid var(--border-subtle)",
                background: "var(--bg-elevated)",
                color: "var(--text-secondary)",
                fontSize: 13,
                cursor: "pointer",
                transition: "all var(--transition-fast)",
              }}
            >
              Close
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
