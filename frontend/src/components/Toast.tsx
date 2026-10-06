"use client";

import { useCallback, useEffect, useState } from "react";

export interface ToastMessage {
  text: string;
  tone?: "success" | "error";
  /** Shows an "Urungkan" button while the toast is up. */
  undo?: () => Promise<unknown>;
}

const SHOW_MS = 7000;

/** One toast at a time; a new one replaces the last. */
export function useToast() {
  const [toast, setToast] = useState<(ToastMessage & { id: number }) | null>(null);
  const show = useCallback((message: ToastMessage) => setToast({ ...message, id: Date.now() }), []);
  const dismiss = useCallback(() => setToast(null), []);

  return { toast, show, dismiss };
}

/** A short note in the corner after saving, with an optional undo. */
export default function Toast({ toast, onDismiss }: { toast: (ToastMessage & { id: number }) | null; onDismiss: () => void }) {
  const [undoing, setUndoing] = useState<number | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, SHOW_MS);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  async function undo() {
    if (!toast?.undo) return;
    setUndoing(toast.id);
    try {
      await toast.undo();
    } finally {
      setUndoing(null);
    }
  }

  return (
    <div aria-live="polite" className="fixed z-[60] top-4 inset-x-4 sm:top-auto sm:inset-x-auto sm:right-6 sm:bottom-6 flex justify-center pointer-events-none">
      {toast && (
        <div
          key={toast.id}
          className={`pointer-events-auto relative overflow-hidden flex items-center gap-3 rounded-xl border px-4 py-3 shadow-2xl sm:min-w-80 max-w-md ${
            toast.tone === "error" ? "bg-red-950 border-red-400/40 text-danger" : "bg-surface-2 border-stroke-strong text-heading"
          }`}
        >
          <span aria-hidden="true" className={toast.tone === "error" ? "text-danger" : "text-success"}>
            {toast.tone === "error" ? "!" : "✓"}
          </span>
          <p className="flex-1 text-sm">{toast.text}</p>
          {toast.undo && (
            <button
              type="button"
              onClick={undo}
              disabled={undoing === toast.id}
              className="px-2 py-1 rounded-md text-sm font-medium text-accent hover:bg-surface-3 hover:text-heading disabled:opacity-60"
            >
              {undoing === toast.id ? "Mengurungkan…" : "Urungkan"}
            </button>
          )}
          <button type="button" onClick={onDismiss} aria-label="Tutup notifikasi" className="text-muted hover:text-heading">
            ✕
          </button>
          <span
            aria-hidden="true"
            className="absolute left-0 bottom-0 h-0.5 bg-primary/70 origin-left"
            style={{ width: "100%", animation: `toast-timer ${SHOW_MS}ms linear forwards` }}
          />
        </div>
      )}
    </div>
  );
}
