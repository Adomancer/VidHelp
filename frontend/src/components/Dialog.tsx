"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface DialogProps {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  /** Unsaved entries: closing with Esc, a click outside or × asks first. */
  dirty?: boolean;
  /** Buttons along the bottom. */
  footer?: ReactNode;
  size?: "md" | "lg";
  children: ReactNode;
}

/**
 * A modal over the page, so the page behind keeps its place. Render it to open it.
 * Closes with Esc or a click outside.
 */
export default function Dialog({ title, description, onClose, dirty = false, footer, size = "md", children }: DialogProps) {
  const [confirming, setConfirming] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const requestClose = useCallback(() => (dirty ? setConfirming(true) : onClose()), [dirty, onClose]);

  // While open: the page behind doesn't scroll; focus comes back to where it was afterwards
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [requestClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-[2px] sm:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`w-full ${size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg"} max-h-[92vh] flex flex-col bg-surface border border-stroke rounded-t-2xl sm:rounded-[10px] shadow-2xl outline-none`}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-heading">
              {title}
            </h2>
            {description && <div className="mt-0.5 text-sm text-muted">{description}</div>}
          </div>
          <button
            type="button"
            onClick={() => requestClose()}
            aria-label="Tutup"
            className="-mr-1 w-8 h-8 shrink-0 rounded-lg text-muted hover:bg-surface-2 hover:text-heading"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5">{children}</div>

        {confirming ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-yellow-400/30 bg-yellow-500/10 px-5 py-4 rounded-b-[10px]">
            <p className="flex-1 min-w-48 text-sm text-warning">Ada isian yang belum disimpan. Tutup dan buang perubahan?</p>
            <button
              type="button"
              autoFocus
              onClick={() => setConfirming(false)}
              className="px-4 py-2 rounded-lg text-sm text-body hover:bg-surface-2"
            >
              Lanjut mengisi
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-yellow-500/20 text-warning hover:bg-yellow-500/30">
              Buang perubahan
            </button>
          </div>
        ) : (
          footer && <div className="flex flex-wrap items-center gap-2 border-t border-stroke px-5 py-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body
  );
}
