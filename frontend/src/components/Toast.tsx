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

/** `show` for components that send toasts. */
export function useToast() {
  return { show: notify };
}
