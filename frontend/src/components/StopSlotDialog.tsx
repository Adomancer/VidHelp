"use client";

import { useState } from "react";
import { errorMessage, fieldErrors, scheduleApi, type ScheduleSlot } from "@/lib/api";
import { toDateInput } from "@/lib/format";
import { describeWeekly, formatLongDate, laterDate } from "@/lib/schedule";
import { useAuth } from "./AuthProvider";
import Dialog from "./Dialog";
import FormAlert from "./FormAlert";
import type { ToastMessage } from "./Toast";

interface StopSlotDialogProps {
  slot: ScheduleSlot;
  /** Monday of the week open on the board. */
  week: string;
  onClose: () => void;
  onSaved: (message: ToastMessage) => void;
}

/** End a weekly slot from a date on; the weeks before stay for history and payroll. */
export default function StopSlotDialog({ slot, week, onClose, onSaved }: StopSlotDialogProps) {
  const { token } = useAuth();
  const today = toDateInput();
  const [from, setFrom] = useState(laterDate(week, today));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hostName = slot.assignment.host?.user.name ?? "host";
  const weekly = describeWeekly(slot.day_of_week, slot.start_time, slot.end_time);
  const alreadyEnded = slot.effective_to !== null && slot.effective_to < from;
  // Nothing ran before that date: the slot goes away entirely
  const removesAll = slot.effective_from >= from;

  async function stop() {
    setSaving(true);
    setError(null);
    try {
      await scheduleApi.remove(token, slot.id, from);
      const { assignment_id, day_of_week, start_time, end_time, slot_type, effective_from, effective_to } = slot;
      onSaved({
        text: `Jadwal dihentikan mulai ${formatLongDate(from)}`,
        undo: () =>
          removesAll
            ? scheduleApi.create(token, { assignment_id, day_of_week, start_time, end_time, slot_type, effective_from, effective_to })
            : scheduleApi.update(token, slot.id, { effective_to }),
      });
    } catch (caught) {
      setError(fieldErrors(caught).from ?? errorMessage(caught));
      setSaving(false);
    }
  }

  return (
    <Dialog
      title="Hentikan jadwal?"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-body hover:bg-surface-2">
            Batal
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={stop}
            disabled={saving || alreadyEnded || from < today}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Menghentikan…" : "Hentikan jadwal"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <FormAlert tone="error">{error}</FormAlert>}

        <p className="text-heading">
          Hentikan jadwal <strong>{hostName}</strong> {weekly} mulai <strong>{formatLongDate(from)}</strong>?
        </p>

        <label className="flex flex-wrap items-center gap-2 text-sm text-body">
          Berhenti mulai
          <input
            type="date"
            value={from}
            min={today}
            onChange={(event) => event.target.value && setFrom(event.target.value)}
            className="px-2 py-1 rounded-md bg-surface-2 border border-stroke-strong text-heading [color-scheme:dark]"
          />
        </label>

        {alreadyEnded ? (
          <FormAlert tone="warning">Jadwal ini sudah berakhir pada {formatLongDate(slot.effective_to!)}.</FormAlert>
        ) : removesAll ? (
          <p className="text-sm text-muted">Jadwal ini belum pernah berjalan sebelum tanggal itu, jadi akan dihapus seluruhnya.</p>
        ) : (
          <p className="text-sm text-muted">Jadwal sebelum tanggal ini tetap tersimpan untuk riwayat dan payroll.</p>
        )}
      </div>
    </Dialog>
  );
}
