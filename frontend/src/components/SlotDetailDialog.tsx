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
              className="px-3 py-2 rounded-lg text-sm border border-red-400/40 text-red-300 hover:bg-red-500/10"
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
              className="px-3 py-2 rounded-lg text-sm border border-slate-700 text-gray-300 hover:bg-slate-800 disabled:opacity-60"
            >
              {slot.is_locked ? "Buka kunci" : "Kunci"}
            </button>
          )}
          <button type="button" onClick={onBackup} className="px-3 py-2 rounded-lg text-sm border border-slate-700 text-gray-200 hover:bg-slate-800">
            Atur backup
          </button>
          {canChange && (
            <button type="button" onClick={onEdit} className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-500">
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
            <p className="text-white font-medium truncate">{host?.name ?? "Host"}</p>
            <div className="flex flex-wrap gap-1.5 mt-0.5">
              <Badge tone={slot.slot_type === "pd" ? "amber" : "purple"}>{slot.slot_type === "pd" ? "PD" : "Reguler"}</Badge>
              {slot.is_locked && <Badge tone="slate">🔒 Dikunci</Badge>}
              {slot.effective_to && <Badge tone="sky">Sementara</Badge>}
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-gray-400">Berlaku</dt>
          <dd className="text-gray-100">{describePeriod(slot)}</dd>
          <dt className="text-gray-400">Backup {formatDayDate(date)}</dt>
          <dd className="text-gray-100">
            {!backup && <span className="text-gray-400">Tidak ada, {host?.name ?? "host"} live seperti biasa</span>}
            {backup?.status === "filled" && <span className="text-green-300">Digantikan oleh {backup.filler_name}</span>}
            {backup?.status === "open" && <span className="text-amber-200">Belum ada host pengganti</span>}
            {backup?.status === "pending" && <span className="text-amber-200">Ada pelamar, menunggu persetujuan di halaman Backup</span>}
          </dd>
        </dl>

        <section>
          <h3 className="text-sm font-medium text-white mb-2">Riwayat perubahan</h3>
          {history.error && <p className="text-xs text-red-300">{history.error}</p>}
          {!history.data && !history.error && <p className="text-xs text-gray-500">Memuat…</p>}
          {history.data && entries.length === 0 && <p className="text-xs text-gray-500">Belum ada catatan.</p>}
          <ol className="space-y-2 border-l border-slate-700 pl-4">
            {entries.slice(0, allHistory ? undefined : HISTORY_SHOWN).map((entry) => (
              <li key={entry.id} className="relative">
                <span aria-hidden="true" className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full bg-slate-500" />
                <p className="text-sm text-gray-200">{describeChange(entry)}</p>
                <p className="text-xs text-gray-500">
                  {formatDateTime(entry.created_at)} · {entry.user?.name ?? "Sistem"}
                </p>
              </li>
            ))}
          </ol>
          {entries.length > HISTORY_SHOWN && (
            <button type="button" onClick={() => setAllHistory(!allHistory)} className="mt-2 text-xs text-purple-300 hover:text-white">
              {allHistory ? "Tampilkan lebih sedikit" : `Lihat semua (${entries.length})`}
            </button>
          )}
        </section>
      </div>
    </Dialog>
  );
}

const badgeTones = {
  purple: "bg-purple-500/15 text-purple-200",
  amber: "bg-amber-500/15 text-amber-200",
  slate: "bg-slate-700 text-gray-200",
  sky: "bg-sky-500/15 text-sky-200",
};

function Badge({ tone, children }: { tone: keyof typeof badgeTones; children: React.ReactNode }) {
  return <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${badgeTones[tone]}`}>{children}</span>;
}
