"use client";

import { useState } from "react";
import { Check, CircleAlert, Loader2, RotateCw, X, type LucideIcon } from "lucide-react";
import Dialog from "@/components/Dialog";
import StatusBadge from "@/components/StatusBadge";
import { notify } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { runWithConcurrency, type BulkItemResult } from "./runBulk";

export interface BulkAction<T> {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Optional filter when only a subset of selected rows qualify for this action. */
  isEligible?: (item: T) => boolean;
  confirmTitle?: (count: number) => string;
  confirmDescription?: (count: number) => string;
  confirmLabel?: string;
  getItemLabel?: (item: T) => string;
  /** Non-destructive per-item async handler executed with bounded concurrency (max 3-5). */
  runItem?: (item: T) => Promise<void>;
  /** Local batch handler (e.g. copy or export selected rows). */
  runBatch?: (items: T[]) => Promise<void> | void;
  concurrency?: number;
}

interface TableBulkBarProps<T> {
  selectedItems: T[];
  actions: BulkAction<T>[];
  onClear: () => void;
  onComplete?: () => void;
  className?: string;
}

type ModalState<T> =
  | { kind: "confirm"; action: BulkAction<T>; items: T[] }
  | { kind: "running"; action: BulkAction<T>; done: number; total: number }
  | { kind: "summary"; action: BulkAction<T>; succeededCount: number; failed: BulkItemResult<T>[] }
  | null;

/**
 * Non-destructive bulk action bar for DataTable.
 * Always confirms the selected count before executing, runs per-item handlers with bounded
 * concurrency (3–5), and surfaces partial failures with a retry-failed button.
 */
export default function TableBulkBar<T>({ selectedItems, actions, onClear, onComplete, className }: TableBulkBarProps<T>) {
  const [modal, setModal] = useState<ModalState<T>>(null);

  if (selectedItems.length === 0 && !modal) return null;

  function openConfirm(action: BulkAction<T>) {
    const items = action.isEligible ? selectedItems.filter(action.isEligible) : selectedItems;
    if (items.length === 0) return;
    setModal({ kind: "confirm", action, items });
  }

  async function execute(action: BulkAction<T>, items: T[], previousSucceeded = 0) {
    if (action.runBatch) {
      setModal({ kind: "running", action, done: 0, total: items.length });
      try {
        await action.runBatch(items);
        setModal(null);
        onClear();
        onComplete?.();
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Aksi gagal dijalankan.";
        setModal({
          kind: "summary",
          action,
          succeededCount: previousSucceeded,
          failed: items.map((item, idx) => ({
            item,
            label: action.getItemLabel?.(item) ?? `Item #${idx + 1}`,
            ok: false,
            error: message,
          })),
        });
      }
      return;
    }

    if (!action.runItem) {
      setModal(null);
      return;
    }

    setModal({ kind: "running", action, done: 0, total: items.length });
    const summary = await runWithConcurrency(items, action.runItem, {
      concurrency: action.concurrency,
      getLabel: action.getItemLabel,
      onProgress: (done, total) => {
        setModal((current) => (current?.kind === "running" ? { ...current, done, total } : current));
      },
    });

    const totalSucceeded = previousSucceeded + summary.succeeded.length;
    if (summary.failed.length === 0) {
      notify({ text: `${totalSucceeded} item berhasil diproses.` });
      setModal(null);
      onClear();
      onComplete?.();
      return;
    }

    setModal({
      kind: "summary",
      action,
      succeededCount: totalSucceeded,
      failed: summary.failed,
    });
  }

  function closeSummary(succeededCount: number) {
    setModal(null);
    if (succeededCount > 0) {
      onClear();
      onComplete?.();
    }
  }

  return (
    <>
      {selectedItems.length > 0 && (
        <div
          role="region"
          aria-label="Aksi massa"
          className={cn("flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/25 bg-primary/[0.05] px-4 py-2.5", className)}
        >
          <div className="flex items-center gap-2">
            <StatusBadge tone="brand" className="tabular-nums">
              {selectedItems.length} dipilih
            </StatusBadge>
            <Button type="button" variant="ghost" size="sm" onClick={onClear} className="text-muted-foreground">
              <X aria-hidden="true" />
              Batal pilih
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {actions.map((action, index) => {
              const Icon = action.icon;
              const eligibleCount = action.isEligible ? selectedItems.filter(action.isEligible).length : selectedItems.length;
              return (
                <Button
                  key={action.id}
                  type="button"
                  size="sm"
                  variant={index === 0 ? "default" : "outline"}
                  disabled={eligibleCount === 0}
                  onClick={() => openConfirm(action)}
                >
                  {Icon && <Icon aria-hidden="true" />}
                  <span>
                    {action.label}
                    {action.isEligible && eligibleCount !== selectedItems.length ? ` (${eligibleCount})` : ""}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {modal?.kind === "confirm" && (
        <Dialog
          title={modal.action.confirmTitle?.(modal.items.length) ?? `${modal.action.label} ${modal.items.length} item?`}
          size="sm"
          onClose={() => setModal(null)}
          footer={
            <>
              <Button type="button" variant="outline" onClick={() => setModal(null)}>
                Batal
              </Button>
              <Button type="button" onClick={() => void execute(modal.action, modal.items)}>
                {modal.action.confirmLabel ?? `${modal.action.label} (${modal.items.length})`}
              </Button>
            </>
          }
        >
          <p className="text-sm text-body">
            {modal.action.confirmDescription?.(modal.items.length) ?? `Aksi "${modal.action.label}" akan dijalankan untuk ${modal.items.length} item terpilih.`}
          </p>
        </Dialog>
      )}

      {modal?.kind === "running" && (
        <Dialog title={modal.action.label} size="sm" closeOnOutsideClick={false} onClose={() => {}}>
          <div className="space-y-3" aria-busy="true">
            <div className="flex items-center gap-2 text-sm text-body">
              <Loader2 className="size-4 animate-spin text-brand" aria-hidden="true" />
              <span className="tabular-nums">
                Memproses {modal.done} dari {modal.total} item…
              </span>
            </div>
            <Progress value={modal.total > 0 ? (modal.done / modal.total) * 100 : 0} aria-label="Progres aksi massa" />
          </div>
        </Dialog>
      )}

      {modal?.kind === "summary" && (
        <Dialog
          title="Ringkasan hasil"
          size="md"
          onClose={() => closeSummary(modal.succeededCount)}
          footer={
            <>
              <Button type="button" variant="outline" onClick={() => closeSummary(modal.succeededCount)}>
                Tutup
              </Button>
              <Button
                type="button"
                onClick={() =>
                  void execute(
                    modal.action,
                    modal.failed.map((entry) => entry.item),
                    modal.succeededCount
                  )
                }
              >
                <RotateCw aria-hidden="true" />
                Coba ulang yang gagal ({modal.failed.length})
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="success" className="tabular-nums">
                <Check className="size-3" aria-hidden="true" />
                {modal.succeededCount} berhasil
              </StatusBadge>
              <StatusBadge tone="danger" className="tabular-nums">
                <CircleAlert className="size-3" aria-hidden="true" />
                {modal.failed.length} gagal
              </StatusBadge>
            </div>

            <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-xl border border-border">
              {modal.failed.map((entry, idx) => (
                <li key={`${entry.label}-${idx}`} className="space-y-0.5 px-3.5 py-2.5 text-sm">
                  <p className="font-medium text-foreground">{entry.label}</p>
                  {entry.error && <p className="text-xs text-destructive">{entry.error}</p>}
                </li>
              ))}
            </ul>
          </div>
        </Dialog>
      )}
    </>
  );
}
