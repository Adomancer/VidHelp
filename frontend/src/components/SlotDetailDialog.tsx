"use client";

import { useState } from "react";
import { Lock, LockOpen, Pencil } from "lucide-react";
import { scheduleApi, type ScheduleSlot, type SlotBackupMarker } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { dayLong, describeChange, describePeriod, describeTimes, formatDayDate } from "@/lib/schedule";
import { useApiData } from "@/lib/useApiData";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "./AuthProvider";
import Dialog from "./Dialog";
import FormAlert from "./FormAlert";
import StatusBadge from "./StatusBadge";
import UserAvatar from "./UserAvatar";

interface SlotDetailDialogProps {
  slot: ScheduleSlot;
  /** The session that was clicked. */
  date: string;
  /** A backup on that date, if any. */
  backup?: SlotBackupMarker;
  isAdmin: boolean;
  onClose: () => void;
  onEdit: () => void;
  onBackup: () => void;
  onStop: () => void;
  onToggleLock: () => Promise<void>;
}

const HISTORY_SHOWN = 4;

/** Look before changing: what the slot is, who's on it, its backup and recent changes, then the actions. */
export default function SlotDetailDialog({ slot, date, backup, isAdmin, onClose, onEdit, onBackup, onStop, onToggleLock }: SlotDetailDialogProps) {
  const { token } = useAuth();
  const [allHistory, setAllHistory] = useState(false);
  const [locking, setLocking] = useState(false);
  const history = useApiData(`slot-history-${slot.id}-${slot.is_locked}`, () => scheduleApi.history(token, slot.id));
  const canChange = isAdmin || !slot.is_locked;
  const host = slot.assignment.host?.user;
  const entries = history.data?.history ?? [];

  async function toggleLock() {
    setLocking(true);
    try {
      await onToggleLock();
    } finally {
      setLocking(false);
    }
  }

  return (
    <Dialog
      title={`${dayLong(slot.day_of_week)}, ${describeTimes(slot.day_of_week, slot.start_time, slot.end_time)}`}
      description={slot.assignment.brand.name}
      onClose={onClose}
      footer={
        <>
          {canChange && (
            <Button type="button" variant="ghost" onClick={onStop} className="mr-auto text-destructive hover:text-destructive">
              Hentikan jadwal
            </Button>
          )}
          {isAdmin && (
            <Button type="button" variant="outline" onClick={toggleLock} disabled={locking}>
              {slot.is_locked ? <LockOpen aria-hidden="true" /> : <Lock aria-hidden="true" />}
              {slot.is_locked ? "Buka kunci" : "Kunci"}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onBackup}>
            Atur backup
          </Button>
          {canChange && (
            <Button type="button" onClick={onEdit}>
              <Pencil aria-hidden="true" />
              Edit
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        {!canChange && <FormAlert tone="warning">Dikunci oleh admin. Hubungi admin untuk mengubah.</FormAlert>}

        <div className="flex items-center gap-3">
          {host && <UserAvatar user={host} size="size-11 text-sm" />}
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{host?.name ?? "Host"}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <StatusBadge tone={slot.slot_type === "pd" ? "warning" : "brand"}>{slot.slot_type === "pd" ? "PD" : "Reguler"}</StatusBadge>
              {slot.is_locked && (
                <StatusBadge tone="neutral">
                  <Lock className="size-3" aria-hidden="true" />
                  Dikunci
                </StatusBadge>
              )}
              {slot.effective_to && <StatusBadge tone="info">Sementara</StatusBadge>}
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          <dt className="text-muted-foreground">Berlaku</dt>
          <dd className="text-foreground">{describePeriod(slot)}</dd>
          <dt className="text-muted-foreground">Backup {formatDayDate(date)}</dt>
          <dd className="text-foreground">
            {!backup && <span className="text-muted-foreground">Tidak ada, {host?.name ?? "host"} live seperti biasa</span>}
            {backup?.status === "filled" && <span className="font-medium text-success">Digantikan oleh {backup.filler_name}</span>}
            {backup?.status === "open" && <span className="text-warning">Belum ada host pengganti</span>}
            {backup?.status === "pending" && <span className="text-warning">Ada pelamar, menunggu persetujuan di halaman Backup</span>}
          </dd>
        </dl>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-foreground">Riwayat perubahan</h3>
          {history.error && <FormAlert tone="error">{history.error}</FormAlert>}
          {!history.data && !history.error && (
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          )}
          {history.data && entries.length === 0 && <p className="text-xs text-muted-foreground">Belum ada catatan.</p>}
          <ol className="space-y-3 border-l border-border pl-4">
            {entries.slice(0, allHistory ? undefined : HISTORY_SHOWN).map((entry) => (
              <li key={entry.id} className="relative">
                <span aria-hidden="true" className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-faint ring-2 ring-popover" />
                <p className="text-sm text-body">{describeChange(entry)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(entry.created_at)} · {entry.user?.name ?? "Sistem"}
                </p>
              </li>
            ))}
          </ol>
          {entries.length > HISTORY_SHOWN && (
            <button type="button" onClick={() => setAllHistory(!allHistory)} className="mt-3 text-xs font-medium text-brand hover:underline">
              {allHistory ? "Tampilkan lebih sedikit" : `Lihat semua (${entries.length})`}
            </button>
          )}
        </section>
      </div>
    </Dialog>
  );
}
