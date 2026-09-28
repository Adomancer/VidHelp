"use client";

import { useState } from "react";
import { errorMessage, scheduleApi, type BrandHost, type ScheduleSlot, type SlotInput } from "@/lib/api";
import { DAYS, formatTimeRange, toDateInput } from "@/lib/format";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import FormAlert from "./FormAlert";
import SelectField from "./SelectField";
import SubmitButton from "./SubmitButton";
import TextField from "./TextField";

interface SlotFormProps {
  hosts: BrandHost[];
  /** Editing an existing slot; omit to add one. */
  slot?: ScheduleSlot;
  /** Prefill the day when adding from a day column. */
  day?: number;
  isAdmin: boolean;
  onDone: () => void;
  onCancel: () => void;
}

/** Add or edit a weekly slot. Shows the chosen host's availability for the chosen day. */
export default function SlotForm({ hosts, slot, day, isAdmin, onDone, onCancel }: SlotFormProps) {
  const { token } = useAuth();
  const [assignmentId, setAssignmentId] = useState(slot?.assignment_id ?? hosts[0]?.id ?? "");
  const [dayOfWeek, setDayOfWeek] = useState(String(slot?.day_of_week ?? day ?? 1));
  const [actionError, setActionError] = useState<string | null>(null);
  const readOnly = Boolean(slot?.is_locked && !isAdmin);

  const { loading, errors, error, handleSubmit } = useApiForm((data) => {
    const input: SlotInput = {
      assignment_id: assignmentId,
      day_of_week: Number(dayOfWeek),
      start_time: formValue(data, "start_time"),
      end_time: formValue(data, "end_time"),
      slot_type: formValue(data, "slot_type") as SlotInput["slot_type"],
      effective_from: formValue(data, "effective_from"),
      effective_to: formValue(data, "effective_to") || null,
    };
    return slot ? scheduleApi.update(token, slot.id, input) : scheduleApi.create(token, input);
  }, onDone);

  async function act(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
      onDone();
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  const host = hosts.find((option) => option.id === assignmentId)?.host;
  const freeThatDay = host?.availability.filter((range) => range.day_of_week === Number(dayOfWeek)) ?? [];
  const dayName = DAYS.find((option) => option.value === Number(dayOfWeek))?.long;

  if (hosts.length === 0 && !slot) {
    return (
      <Card title="Add slot">
        <p className="text-sm text-gray-400">No hosts are assigned to this brand yet. Assign hosts on the Hosts page first.</p>
        <button type="button" onClick={onCancel} className="text-sm text-purple-300 hover:text-white">
          Close
        </button>
      </Card>
    );
  }

  return (
    <Card title={slot ? "Edit slot" : "Add slot"}>
      {readOnly && <FormAlert tone="warning">This slot is locked. Only an admin can change or remove it.</FormAlert>}
      {actionError && <FormAlert tone="error">{actionError}</FormAlert>}

      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <FormAlert tone="error">{error}</FormAlert>
          </div>
        )}
        <fieldset disabled={readOnly} className="contents">
          <SelectField
            label="Host"
            name="assignment_id"
            value={assignmentId}
            onChange={(event) => setAssignmentId(event.target.value)}
            error={errors.assignment_id}
            options={hosts.map((option) => ({ value: option.id, label: option.host.user.name }))}
          />
          <SelectField
            label="Day"
            name="day_of_week"
            value={dayOfWeek}
            onChange={(event) => setDayOfWeek(event.target.value)}
            error={errors.day_of_week}
            options={DAYS.map((option) => ({ value: String(option.value), label: option.long }))}
          />

          <p className="sm:col-span-2 -mt-2 text-xs text-gray-400">
            {host?.user.name ?? "Host"} is free on {dayName}:{" "}
            {freeThatDay.length === 0
              ? "not filled in"
              : freeThatDay.map((range) => formatTimeRange(range.available_from, range.available_to)).join(", ")}
          </p>

          <TextField label="Start" name="start_time" type="time" defaultValue={slot?.start_time} required error={errors.start_time} />
          <TextField label="End (can be after midnight)" name="end_time" type="time" defaultValue={slot?.end_time} required error={errors.end_time} />
          <TextField label="Starts from" name="effective_from" type="date" defaultValue={slot?.effective_from ?? toDateInput()} error={errors.effective_from} />
          <TextField label="Until (optional)" name="effective_to" type="date" defaultValue={slot?.effective_to ?? ""} error={errors.effective_to} />
          <SelectField
            label="Type"
            name="slot_type"
            defaultValue={slot?.slot_type ?? "regular"}
            options={[
              { value: "regular", label: "Regular" },
              { value: "pd", label: "PD" },
            ]}
          />
        </fieldset>

        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          {!readOnly && (
            <div className="w-36">
              <SubmitButton loading={loading}>Save</SubmitButton>
            </div>
          )}
          <button type="button" onClick={onCancel} className="px-4 py-3 rounded-xl text-gray-300 hover:bg-slate-800">
            Cancel
          </button>

          {slot && isAdmin && (
            <button
              type="button"
              onClick={() => act(() => scheduleApi.lock(token, slot.id, !slot.is_locked))}
              className="px-4 py-3 rounded-xl border border-slate-700 text-gray-300 hover:bg-slate-800"
            >
              {slot.is_locked ? "Unlock" : "Lock"}
            </button>
          )}
          {slot && !readOnly && (
            <button
              type="button"
              onClick={() => confirm("Remove this slot from today on? Past weeks stay in the history.") && act(() => scheduleApi.remove(token, slot.id))}
              className="ml-auto px-4 py-3 rounded-xl border border-red-400/40 text-red-300 hover:bg-red-500/10"
            >
              Remove
            </button>
          )}
        </div>
      </form>
    </Card>
  );
}
