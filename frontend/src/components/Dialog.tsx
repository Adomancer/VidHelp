"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DialogSize = "sm" | "md" | "lg" | "xl";

interface DialogProps {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  /** Unsaved entries: closing with Esc, a click outside or × asks first. */
  dirty?: boolean;
  /** Buttons along the bottom; they stay in view while the body scrolls. */
  footer?: ReactNode;
  size?: DialogSize;
  /** A click outside closes it (default). Off for long forms, so a stray click doesn't lose them. */
  closeOnOutsideClick?: boolean;
  /** `side`: a full-height panel from the right on `sm` up (detail views next to a list). */
  placement?: "center" | "side";
  children: ReactNode;
}

const widths: Record<DialogSize, string> = {
  sm: "sm:max-w-md",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
};

const placements = {
  // A centered panel that fades and scales in
  center:
    "sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[calc(100dvh-4rem)] sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:pb-0 sm:duration-150 sm:data-open:fade-in-0 sm:data-open:slide-in-from-bottom-0 sm:data-open:zoom-in-95",
  // A full-height panel sliding in from the right
  side: "h-[92dvh] sm:inset-y-0 sm:right-0 sm:left-auto sm:h-dvh sm:max-h-none sm:w-full sm:rounded-none sm:rounded-l-xl sm:pb-0 sm:duration-200 sm:data-open:slide-in-from-bottom-0 sm:data-open:slide-in-from-right",
};

/**
 * A modal over the page, so the page behind keeps its place. Render it to open it; the parent
 * unmounts it to close. A bottom sheet on phones, a centered panel from `sm` up.
 */
export default function Dialog({
  title,
  description,
  onClose,
  dirty = false,
  footer,
  size = "md",
  closeOnOutsideClick = true,
  placement = "center",
  children,
}: DialogProps) {
  const [confirming, setConfirming] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const requestClose = useCallback(() => (dirty ? setConfirming(true) : onClose()), [dirty, onClose]);

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && requestClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 duration-150 supports-backdrop-filter:backdrop-blur-xs dark:bg-black/60 data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Content
          ref={panelRef}
          // Without a description, say so explicitly (Radix warns otherwise)
          {...(!description && { "aria-describedby": undefined })}
          onOpenAutoFocus={(event) => {
            // Keep an `autoFocus` field's focus; otherwise focus the panel, not the × button
            event.preventDefault();
            const panel = panelRef.current;
            if (panel && !panel.contains(document.activeElement)) panel.focus();
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            requestClose();
          }}
          onInteractOutside={(event) => {
            event.preventDefault();
            if (closeOnOutsideClick) requestClose();
          }}
          className={cn(
            "fixed z-50 flex flex-col bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/10 outline-none",
            // Phones: a sheet rising from the bottom
            "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)] duration-300 ease-out data-open:animate-in data-open:slide-in-from-bottom",
            placements[placement],
            widths[size]
          )}
        >
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border sm:hidden" aria-hidden="true" />

          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-base font-semibold tracking-tight text-foreground">{title}</DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description asChild>
                  <div className="mt-1 text-sm text-muted-foreground">{description}</div>
                </DialogPrimitive.Description>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={requestClose}
              aria-label="Tutup"
              className="-mt-1 -mr-2 shrink-0 text-muted-foreground max-md:size-10"
            >
              <X />
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">{children}</div>

          {confirming ? (
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-warning/30 bg-warning/10 px-5 py-3.5 sm:rounded-b-xl sm:px-6">
              <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
              <p className="min-w-48 flex-1 text-sm text-warning">Ada isian yang belum disimpan. Tutup dan buang perubahan?</p>
              <Button type="button" variant="ghost" autoFocus onClick={() => setConfirming(false)}>
                Lanjut mengisi
              </Button>
              <Button type="button" variant="destructive" onClick={onClose}>
                Buang perubahan
              </Button>
            </div>
          ) : (
            footer && (
              <div
                className={cn(
                  "flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3.5 sm:px-6",
                  placement === "center" && "sm:rounded-b-xl"
                )}
              >
                {footer}
              </div>
            )
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
