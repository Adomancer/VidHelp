"use client";

import { useState } from "react";
import { scheduleApi, shownKeys, splitApiError, type ScheduleSlot } from "@/lib/api";
import { toDateInput } from "@/lib/format";
import { describeWeekly, formatLongDate, laterDate } from "@/lib/schedule";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "./AuthProvider";
import Dialog from "./Dialog";
import DatePicker from "./DatePicker";
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
      const { fields, message } = splitApiError(caught, shownKeys("from"));
      setError(message ?? fields.from);
      setSaving(false);
    }
  }

  return (
    <Dialog
      title="Hentikan jadwal?"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button type="button" variant="danger" onClick={stop} disabled={saving || alreadyEnded || from < today}>
            {saving ? "Menghentikan…" : "Hentikan jadwal"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <FormAlert tone="error">{error}</FormAlert>}

        <p className="text-sm text-body">
          Hentikan jadwal <strong className="font-semibold text-foreground">{hostName}</strong> {weekly} mulai{" "}
          <strong className="font-semibold text-foreground">{formatLongDate(from)}</strong>?
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="stop-from">Berhenti mulai</Label>
          <DatePicker id="stop-from" value={from} min={today} onChange={setFrom} className="sm:w-56" />
        </div>

        {alreadyEnded ? (
          <FormAlert tone="warning">Jadwal ini sudah berakhir pada {formatLongDate(slot.effective_to!)}.</FormAlert>
        ) : removesAll ? (
          <p className="text-sm text-muted-foreground">Jadwal ini belum pernah berjalan sebelum tanggal itu, jadi akan dihapus seluruhnya.</p>
        ) : (
          <p className="text-sm text-muted-foreground">Jadwal sebelum tanggal ini tetap tersimpan untuk riwayat dan payroll.</p>
        )}
      </div>
    </Dialog>
  );
}
