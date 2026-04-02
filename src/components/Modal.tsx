import React, { useEffect, useRef, useState, useCallback } from "react";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  maxWidth?: number | string;
  maxHeight?: string;
  zIndex?: number;
  children: React.ReactNode;
};

const EXIT_DURATION = 180; // matches CSS modal-overlay-out duration

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
  const [visible, setVisible] = useState(open);
  const [closing, setClosing] = useState(false);

  // Sync open→visible, and run exit animation on close
  useEffect(() => {
    if (open) {
      setVisible(true);
      setClosing(false);
    } else if (visible) {
      // Start exit animation
      setClosing(true);
      const timer = setTimeout(() => {
        setVisible(false);
        setClosing(false);
      }, EXIT_DURATION);
      return () => clearTimeout(timer);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on Escape
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [visible, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [visible]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  if (!visible) return null;

  return (
    <div
      className={`modal-overlay fixed inset-0 bg-black/80 backdrop-blur flex justify-center items-center p-4${closing ? " closing" : ""}`}
      style={{ zIndex }}
      onClick={handleOverlayClick}
      data-no-ptr
    >
      <div
        ref={contentRef}
        className="modal-content bg-elevated border border-subtle rounded-lg p-6 shadow-modal w-full overflow-y-auto flex flex-col gap-4"
        style={{ maxHeight, maxWidth }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex justify-between items-center">
            <h3 className="m-0 text-lg font-bold">{title}</h3>
            <button
              onClick={onClose}
              className="px-2 py-1 rounded-sm border border-subtle bg-elevated text-secondary text-[13px]"
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
