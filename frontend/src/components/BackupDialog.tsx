"use client";

import { useState } from "react";
import { ChevronRight, Megaphone, Search, Star } from "lucide-react";
import { errorMessage, fieldErrors, operatorBackupApi, type BackupReason, type ScheduleSlot, type SlotBackupMarker } from "@/lib/api";
import { toDateInput } from "@/lib/format";
import { describeTimes, formatDayDate, upcomingDates } from "@/lib/schedule";
import { inputSmClass, textareaClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "./AuthProvider";
import Chip from "./Chip";
import Dialog from "./Dialog";
import FormAlert from "./FormAlert";
import { ListSkeleton } from "./Loading";
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
          <Button type="button" variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button type="button" onClick={save} disabled={!backupDate || !cover || Boolean(existing) || saving}>
            {saving ? "Menyimpan…" : "Simpan backup"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <FormAlert tone="error">{error}</FormAlert>}

        <section>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Tanggal</h3>
          {dates.length === 0 ? (
            <p className="text-sm text-muted-foreground">Slot ini tidak punya jadwal mendatang.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {dates.map((option) => (
                <Chip
                  key={option}
                  selected={option === backupDate}
                  onClick={() => {
                    setBackupDate(option);
                    setCover("");
                  }}
                >
                  {formatDayDate(option)}
                </Chip>
              ))}
            </div>
          )}
          {existing && (
            <FormAlert tone="warning" className="mt-3">
              Sudah ada backup di tanggal ini
              {existing.status === "filled" ? `: ${existing.filler_name} menggantikan.` : ", masih mencari pengganti."} Kelola di halaman Backup.
            </FormAlert>
          )}
        </section>

        {backupDate && !existing && (
          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">Host pengganti</h3>
              <div className="relative w-44">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Cari nama…"
                  aria-label="Cari host pengganti"
                  className={cn(inputSmClass, "pl-8")}
                />
              </div>
            </div>

            {candidates.error && <FormAlert tone="error">{candidates.error}</FormAlert>}
            {candidates.loading && !candidates.data && <ListSkeleton rows={3} />}

            <div role="radiogroup" aria-label="Host pengganti" className={cn("space-y-1.5 transition-opacity", candidates.loading && "opacity-60")}>
              {free.length > 0 && <p className="pt-1 text-xs font-medium text-success">Kosong di jam ini</p>}
              {free.map((candidate) => (
                <label
                  key={candidate.host_id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
                    cover === candidate.host_id ? "border-primary bg-primary/[0.06]" : "border-border hover:bg-muted/60"
                  )}
                >
                  <input
                    type="radio"
                    name="cover"
                    checked={cover === candidate.host_id}
                    onChange={() => setCover(candidate.host_id)}
                    className="size-4 accent-primary"
                  />
                  <UserAvatar user={{ name: candidate.name, avatar_url: candidate.avatar_url }} size="size-8 text-xs" />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{candidate.name}</span>
                    <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                      {candidate.rating != null && (
                        <span className="inline-flex items-center gap-0.5 font-medium text-foreground tabular-nums">
                          <Star className="size-3 fill-warning text-warning" aria-hidden="true" />
                          {candidate.rating.toFixed(1)}
                        </span>
                      )}
                      {candidate.same_brand ? "Brand yang sama" : `Brand lain · kuota ${candidate.quota.quota_used}/${candidate.quota.quota_max}`}
                    </span>
                  </span>
                </label>
              ))}
              {candidates.data && free.length === 0 && (
                <p className="py-1 text-sm text-muted-foreground">{search ? "Tidak ada host kosong dengan nama itu." : "Tidak ada host yang kosong di jam ini."}</p>
              )}

              <label
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
                  cover === OPEN ? "border-primary bg-primary/[0.06]" : "border-dashed border-input hover:bg-muted/60"
                )}
              >
                <input type="radio" name="cover" checked={cover === OPEN} onChange={() => setCover(OPEN)} className="size-4 accent-primary" />
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Megaphone className="size-4" aria-hidden="true" />
                </span>
                <span className="text-sm font-medium text-foreground">
                  Belum tahu, umumkan ke semua host
                  <span className="block text-xs font-normal text-muted-foreground">Host bisa melamar; admin memilih di halaman Backup.</span>
                </span>
              </label>

              {busy.length > 0 && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowBusy(!showBusy)}
                    aria-expanded={showBusy}
                    className="inline-flex items-center gap-1 rounded text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <ChevronRight className={cn("size-3.5 transition-transform", showBusy && "rotate-90")} aria-hidden="true" />
                    Tidak tersedia ({busy.length})
                  </button>
                  {showBusy && (
                    <ul className="mt-1 space-y-1">
                      {busy.map((candidate) => (
                        <li key={candidate.host_id} className="flex items-center gap-3 rounded-lg px-3 py-1.5 opacity-60">
                          <UserAvatar user={{ name: candidate.name, avatar_url: candidate.avatar_url }} size="size-6 text-[10px]" />
                          <span className="min-w-0 flex-1 truncate text-sm text-body">{candidate.name}</span>
                          <span className="text-right text-xs text-destructive">{candidate.ineligible_reason}</span>
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
            <h3 className="mb-2 text-sm font-semibold text-foreground">
              Alasan <span className="font-normal text-muted-foreground">(opsional)</span>
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map((reason) => (
                <Chip key={reason.value} selected={reasonType === reason.value} onClick={() => setReasonType(reasonType === reason.value ? null : reason.value)}>
                  {reason.label}
                </Chip>
              ))}
            </div>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              maxLength={1000}
              placeholder={`Catatan, misalnya "${hostName} ada acara keluarga"`}
              aria-label="Catatan backup"
              className={cn(textareaClass, "mt-2")}
            />
          </section>
        )}
      </div>
    </Dialog>
  );
}
