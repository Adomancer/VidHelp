"use client";

import { useState } from "react";
import { operatorBackupApi, scheduleApi, type BackupReason } from "@/lib/api";
import { formatTimeRange, isoWeekday, toDateInput } from "@/lib/format";
import { inputClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { Label } from "@/components/ui/label";
import { useAuth } from "../AuthProvider";
import { reasonLabels } from "../BackupBadges";
import DatePicker from "../DatePicker";
import { FieldError } from "../FieldMessage";
import FormActions from "../FormActions";
import FormAlert from "../FormAlert";
import Modal from "../Modal";
import { NativeSelect } from "../SelectField";

/** Emergency: open a request for a host who called in, e.g. by phone. */
export function OnBehalfForm({ onDone, onCancel }: { onDone: (message: string) => void; onCancel: () => void }) {
  const { token } = useAuth();
  const [date, setDate] = useState(toDateInput());
  const [reasonType, setReasonType] = useState<BackupReason>("sick");
  const slots = useApiData(`schedules-on-${date}`, () => scheduleApi.list(token, { on: date }));
  const weekday = isoWeekday(new Date(`${date}T00:00`));
  const daySlots = slots.data?.slots.filter((slot) => slot.day_of_week === weekday) ?? [];

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      operatorBackupApi.create(token, {
        slot_id: formValue(data, "slot_id"),
        backup_date: date,
        reason_type: reasonType,
        reason: formValue(data, "reason") || null,
      }),
    ({ message }) => onDone(message),
    ["backup_date"]
  );

  return (
    <Modal title="Ajukan backup untuk host" description="Langsung muncul di papan backup, juga untuk sesi yang akan segera mulai." onClose={onCancel}>
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <FormAlert tone="error">{error}</FormAlert>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="on-behalf-date">Tanggal</Label>
          <DatePicker id="on-behalf-date" value={date} min={toDateInput()} onChange={setDate} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="on-behalf-slot">Sesi</Label>
          <NativeSelect id="on-behalf-slot" name="slot_id" disabled={daySlots.length === 0}>
            {daySlots.length === 0 && <option>{slots.loading ? "Memuat sesi…" : "Tidak ada sesi di hari itu"}</option>}
            {daySlots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {slot.assignment.host?.user.name} · {slot.assignment.brand.name} · {formatTimeRange(slot.start_time, slot.end_time, slot.day_of_week)}
              </option>
            ))}
          </NativeSelect>
          <FieldError>{errors.slot_id ?? errors.backup_date}</FieldError>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="on-behalf-reason-type">Alasan</Label>
          <NativeSelect id="on-behalf-reason-type" value={reasonType} onChange={(event) => setReasonType(event.target.value as BackupReason)}>
            {(Object.keys(reasonLabels) as BackupReason[]).map((value) => (
              <option key={value} value={value}>
                {reasonLabels[value]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="on-behalf-reason">
            Keterangan <span className="font-normal text-muted-foreground">(opsional)</span>
          </Label>
          <input id="on-behalf-reason" name="reason" maxLength={1000} className={inputClass} />
          <FieldError>{errors.reason}</FieldError>
        </div>
        <FormActions loading={loading} submitLabel="Buka permintaan" onCancel={onCancel} disabled={daySlots.length === 0} />
      </form>
    </Modal>
  );
}
