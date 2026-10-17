"use client";

import { toast } from "sonner";

export interface ToastMessage {
  text: string;
  tone?: "success" | "error";
  /** Shows an "Urungkan" button while the toast is up; it reports its own result. */
  undo?: () => Promise<unknown>;
}

const SHOW_MS = 7000;

/** A short note in the corner after saving, with an optional undo. One `<Toaster>` lives in the root layout. */
export function notify({ text, tone = "success", undo }: ToastMessage) {
  const show = tone === "error" ? toast.error : toast.success;
  show(text, {
    duration: undo ? SHOW_MS : 4000,
    action: undo && {
      label: "Urungkan",
      onClick: () => {
        void undo();
      },
    },
  });
}

/**
 * A dark capsule at the bottom center for about two seconds: confirmations and errors on
 * pages where people work quickly and don't need an undo.
 */
export function notifyCapsule(text: string, tone: "success" | "error" = "success", duration = 2000) {
  toast.custom(
    () => (
      <div
        role={tone === "error" ? "alert" : "status"}
        className="mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg ring-1 ring-white/10"
      >
        <span className={tone === "error" ? "size-2 shrink-0 rounded-full bg-red-400" : "size-2 shrink-0 rounded-full bg-emerald-400"} aria-hidden="true" />
        {text}
      </div>
    ),
    { position: "bottom-center", duration }
  );
}

/** `show` for components that send toasts. */
export function useToast() {
  return { show: notify };
}
