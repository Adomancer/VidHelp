"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Dialog from "./Dialog";

interface ConfirmDialogProps {
  title: string;
  /** What happens, in a sentence or two. */
  children?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** A red confirm button for things that can't simply be undone. */
  destructive?: boolean;
  /** Runs on confirm; the dialog closes once it settles. */
  onConfirm: () => Promise<unknown> | void;
  onClose: () => void;
}

/** "Are you sure?" before an action. Render it to open it. */
export default function ConfirmDialog({ title, children, confirmLabel, cancelLabel = "Batal", destructive = true, onConfirm, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      onClose();
    }
  }

  return (
    <Dialog
      title={title}
      size="sm"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy} autoFocus={destructive}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={destructive ? "danger" : "default"} onClick={confirm} disabled={busy} autoFocus={!destructive}>
            {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-body">{children}</div>
    </Dialog>
  );
}
