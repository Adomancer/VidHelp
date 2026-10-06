"use client";

import { useState } from "react";
import { scheduleApi, type ScheduleSlot, type SlotBackupMarker } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { dayLong, describeChange, describePeriod, describeTimes, formatDayDate } from "@/lib/schedule";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "./AuthProvider";
import Dialog from "./Dialog";
import FormAlert from "./FormAlert";
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
  const history = useApiData(`history-${slot.id}-${slot.is_locked}`, () => scheduleApi.history(token, slot.id));
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
            <button
              type="button"
              onClick={onStop}
              className="px-3 py-2 rounded-lg text-sm border border-red-400/40 text-danger hover:bg-red-500/10"
            >
              Hentikan jadwal
            </button>
          )}
          <span className="flex-1" />
          {isAdmin && (
            <button
              type="button"
              onClick={toggleLock}
              disabled={locking}
              className="px-3 py-2 rounded-lg text-sm border border-stroke-strong text-body hover:bg-surface-2 disabled:opacity-60"
            >
              {slot.is_locked ? "Buka kunci" : "Kunci"}
            </button>
          )}
          <button type="button" onClick={onBackup} className="px-3 py-2 rounded-lg text-sm border border-stroke-strong text-body hover:bg-surface-2">
            Atur backup
          </button>
          {canChange && (
            <button type="button" onClick={onEdit} className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary-hover">
              Edit
            </button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        {!canChange && <FormAlert tone="warning">Dikunci oleh Admin. Hubungi Admin untuk mengubah.</FormAlert>}

        <div className="flex items-center gap-3">
          {host && <UserAvatar user={host} size="w-10 h-10" />}
          <div className="min-w-0">
            <p className="text-heading font-medium truncate">{host?.name ?? "Host"}</p>
            <div className="flex flex-wrap gap-1.5 mt-0.5">
              <Badge tone={slot.slot_type === "pd" ? "amber" : "purple"}>{slot.slot_type === "pd" ? "PD" : "Reguler"}</Badge>
              {slot.is_locked && <Badge tone="slate">🔒 Dikunci</Badge>}
              {slot.effective_to && <Badge tone="sky">Sementara</Badge>}
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">Berlaku</dt>
          <dd className="text-heading">{describePeriod(slot)}</dd>
          <dt className="text-muted">Backup {formatDayDate(date)}</dt>
          <dd className="text-heading">
            {!backup && <span className="text-muted">Tidak ada, {host?.name ?? "host"} live seperti biasa</span>}
            {backup?.status === "filled" && <span className="text-success">Digantikan oleh {backup.filler_name}</span>}
            {backup?.status === "open" && <span className="text-warning">Belum ada host pengganti</span>}
            {backup?.status === "pending" && <span className="text-warning">Ada pelamar, menunggu persetujuan di halaman Backup</span>}
          </dd>
        </dl>

        <section>
          <h3 className="text-sm font-medium text-heading mb-2">Riwayat perubahan</h3>
          {history.error && <p className="text-xs text-danger">{history.error}</p>}
          {!history.data && !history.error && <p className="text-xs text-faint">Memuat…</p>}
          {history.data && entries.length === 0 && <p className="text-xs text-faint">Belum ada catatan.</p>}
          <ol className="space-y-2 border-l border-stroke-strong pl-4">
            {entries.slice(0, allHistory ? undefined : HISTORY_SHOWN).map((entry) => (
              <li key={entry.id} className="relative">
                <span aria-hidden="true" className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full bg-slate-500" />
                <p className="text-sm text-body">{describeChange(entry)}</p>
                <p className="text-xs text-faint">
                  {formatDateTime(entry.created_at)} · {entry.user?.name ?? "Sistem"}
                </p>
              </li>
            ))}
          </ol>
          {entries.length > HISTORY_SHOWN && (
            <button type="button" onClick={() => setAllHistory(!allHistory)} className="mt-2 text-xs text-accent hover:text-heading">
              {allHistory ? "Tampilkan lebih sedikit" : `Lihat semua (${entries.length})`}
            </button>
          )}
        </section>
      </div>
    </Dialog>
  );
}

const badgeTones = {
  purple: "bg-primary/15 text-accent",
  amber: "bg-amber-500/15 text-warning",
  slate: "bg-surface-3 text-body",
  sky: "bg-sky-500/15 text-info",
};

function Badge({ tone, children }: { tone: keyof typeof badgeTones; children: React.ReactNode }) {
  return <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${badgeTones[tone]}`}>{children}</span>;
}
