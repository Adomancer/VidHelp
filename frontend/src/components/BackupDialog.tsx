"use client";

import { useState } from "react";
import { errorMessage, fieldErrors, operatorBackupApi, type BackupReason, type ScheduleSlot, type SlotBackupMarker } from "@/lib/api";
import { toDateInput } from "@/lib/format";
import { describeTimes, formatDayDate, upcomingDates } from "@/lib/schedule";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "./AuthProvider";
import Dialog from "./Dialog";
import FormAlert from "./FormAlert";
import type { ToastMessage } from "./Toast";
import UserAvatar from "./UserAvatar";

interface BackupDialogProps {
  slot: ScheduleSlot;
  /** The session that was clicked; preselected when it's still ahead. */
  date: string;
  /** Backups already on the board's week. */
  markers: SlotBackupMarker[];
  onClose: () => void;
  onSaved: (message: ToastMessage) => void;
}

/** Nobody picked yet: the request goes to every host to apply. */
const OPEN = "open";

const REASONS: { value: BackupReason; label: string }[] = [
  { value: "sick", label: "Sakit" },
  { value: "permit", label: "Izin" },
  { value: "other", label: "Lainnya" },
];

/**
 * Someone else covers one session of the slot (one date, not every week):
 * pick the date, the cover (hosts free at that time first) and optionally why.
 */
export default function BackupDialog({ slot, date, markers, onClose, onSaved }: BackupDialogProps) {
  const { token } = useAuth();
  const dates = upcomingDates(slot, toDateInput(), 6);
  const [backupDate, setBackupDate] = useState(dates.includes(date) ? date : dates[0] ?? "");
  const [cover, setCover] = useState("");
  const [search, setSearch] = useState("");
  const [reasonType, setReasonType] = useState<BackupReason | null>(null);
  const [note, setNote] = useState("");
  const [showBusy, setShowBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useApiData(`backup-candidates-${slot.id}-${backupDate}`, () =>
    backupDate ? operatorBackupApi.slotCandidates(token, slot.id, backupDate) : Promise.resolve({ candidates: [] })
  );
  const matches = (candidates.data?.candidates ?? []).filter((candidate) => candidate.name.toLowerCase().includes(search.trim().toLowerCase()));
  const free = matches.filter((candidate) => candidate.eligible);
  const busy = matches.filter((candidate) => !candidate.eligible);

  const existing = markers.find((marker) => marker.slot_id === slot.id && marker.backup_date === backupDate);
  const hostName = slot.assignment.host?.user.name ?? "host";
  const dirty = Boolean(cover || reasonType || note);

  async function save() {
    setSaving(true);
    setError(null);
    const coverName = candidates.data?.candidates.find((candidate) => candidate.host_id === cover)?.name;

    try {
      const { request } = await operatorBackupApi.create(token, {
        slot_id: slot.id,
        backup_date: backupDate,
        reason_type: reasonType ?? "other",
        reason: note.trim() || null,
        host_id: cover === OPEN ? null : cover,
      });
      onSaved({
        text:
          cover === OPEN
            ? `Backup dibuka untuk ${formatDayDate(backupDate)}, menunggu host pengganti`
            : `Backup disimpan: ${coverName} menggantikan ${hostName} pada ${formatDayDate(backupDate)}`,
        undo: () => operatorBackupApi.cancel(token, request.id),
      });
    } catch (caught) {
      const fields = fieldErrors(caught);
      setError(fields.host_id ?? fields.backup_date ?? errorMessage(caught));
      setSaving(false);
    }
  }

  return (
    <Dialog
      title="Atur backup"
      description={`${hostName} · ${describeTimes(slot.day_of_week, slot.start_time, slot.end_time)} · hanya untuk satu tanggal`}
      onClose={onClose}
      dirty={dirty && !saving}
      footer={
        <>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:bg-slate-800">
            Batal
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!backupDate || !cover || Boolean(existing) || saving}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Menyimpan…" : "Simpan backup"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <FormAlert tone="error">{error}</FormAlert>}

        <section>
          <h3 className="text-sm font-medium text-white mb-2">Tanggal</h3>
          {dates.length === 0 ? (
            <p className="text-sm text-gray-400">Slot ini tidak punya jadwal mendatang.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {dates.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setBackupDate(option);
                    setCover("");
                  }}
                  className={`px-3 py-1.5 rounded-lg text-sm border ${
                    option === backupDate ? "bg-purple-600 border-purple-500 text-white" : "border-slate-700 text-gray-300 hover:bg-slate-800"
                  }`}
                >
                  {formatDayDate(option)}
                </button>
              ))}
            </div>
          )}
          {existing && (
            <p className="mt-2 text-sm text-amber-200">
              Sudah ada backup di tanggal ini
              {existing.status === "filled" ? `: ${existing.filler_name} menggantikan.` : ", masih mencari pengganti."} Kelola di halaman Backup.
            </p>
          )}
        </section>

        {backupDate && !existing && (
          <section>
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="text-sm font-medium text-white">Host pengganti</h3>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cari nama…"
                className="w-40 px-3 py-1.5 rounded-lg bg-slate-950/60 border border-slate-700 text-sm text-white outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {candidates.error && <p className="text-xs text-red-300">{candidates.error}</p>}
            {candidates.loading && !candidates.data && <p className="text-xs text-gray-500">Memuat host…</p>}

            <div role="radiogroup" aria-label="Host pengganti" className={`space-y-1 ${candidates.loading ? "opacity-60" : ""}`}>
              {free.length > 0 && <p className="text-xs text-green-300/80 pt-1">Kosong di jam ini</p>}
              {free.map((candidate) => (
                <label
                  key={candidate.host_id}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer border ${
                    cover === candidate.host_id ? "border-purple-500 bg-purple-500/10" : "border-transparent bg-slate-800/50 hover:bg-slate-800"
                  }`}
                >
                  <input
                    type="radio"
                    name="cover"
                    checked={cover === candidate.host_id}
                    onChange={() => setCover(candidate.host_id)}
                    className="accent-purple-500"
                  />
                  <UserAvatar user={{ name: candidate.name, avatar_url: candidate.avatar_url }} size="w-7 h-7" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-white truncate">{candidate.name}</span>
                    <span className="block text-xs text-gray-400">
                      {candidate.rating != null && <span className="text-yellow-200">★ {candidate.rating.toFixed(1)} · </span>}
                      {candidate.same_brand ? "Brand yang sama" : `Brand lain · kuota ${candidate.quota.quota_used}/${candidate.quota.quota_max}`}
                    </span>
                  </span>
                </label>
              ))}
              {candidates.data && free.length === 0 && (
                <p className="text-sm text-gray-400 py-1">{search ? "Tidak ada host kosong dengan nama itu." : "Tidak ada host yang kosong di jam ini."}</p>
              )}

              <label
                className={`flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer border ${
                  cover === OPEN ? "border-purple-500 bg-purple-500/10" : "border-dashed border-slate-700 hover:bg-slate-800/60"
                }`}
              >
                <input type="radio" name="cover" checked={cover === OPEN} onChange={() => setCover(OPEN)} className="accent-purple-500" />
                <span className="text-sm text-gray-200">
                  Belum tahu, umumkan ke semua host
                  <span className="block text-xs text-gray-400">Host bisa melamar; Admin memilih di halaman Backup.</span>
                </span>
              </label>

              {busy.length > 0 && (
                <div className="pt-1">
                  <button type="button" onClick={() => setShowBusy(!showBusy)} className="text-xs text-gray-400 hover:text-white">
                    {showBusy ? "▾" : "▸"} Tidak tersedia ({busy.length})
                  </button>
                  {showBusy && (
                    <ul className="mt-1 space-y-1">
                      {busy.map((candidate) => (
                        <li key={candidate.host_id} className="flex items-center gap-3 rounded-lg px-3 py-1.5 opacity-60">
                          <UserAvatar user={{ name: candidate.name, avatar_url: candidate.avatar_url }} size="w-6 h-6" />
                          <span className="flex-1 min-w-0 text-sm text-gray-300 truncate">{candidate.name}</span>
                          <span className="text-xs text-red-300/80 text-right">{candidate.ineligible_reason}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {backupDate && !existing && (
          <section>
            <h3 className="text-sm font-medium text-white mb-2">
              Alasan <span className="font-normal text-gray-500">(opsional)</span>
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map((reason) => (
                <button
                  key={reason.value}
                  type="button"
                  aria-pressed={reasonType === reason.value}
                  onClick={() => setReasonType(reasonType === reason.value ? null : reason.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm border ${
                    reasonType === reason.value ? "bg-slate-700 border-slate-500 text-white" : "border-slate-700 text-gray-300 hover:bg-slate-800"
                  }`}
                >
                  {reason.label}
                </button>
              ))}
            </div>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              maxLength={1000}
              placeholder={`Catatan, misalnya "${hostName} ada acara keluarga"`}
              className="mt-2 w-full px-3 py-2 rounded-lg bg-slate-950/60 border border-slate-700 text-sm text-white outline-none focus:ring-2 focus:ring-purple-500"
            />
          </section>
        )}
      </div>
    </Dialog>
  );
}
