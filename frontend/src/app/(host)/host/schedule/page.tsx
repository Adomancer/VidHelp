"use client";

import { useState } from "react";
import { errorMessage, fieldErrors, scheduleApi, type AvailabilityRange, type DayOfWeek, type ScheduleSlot } from "@/lib/api";
import { carriedInto, DAYS, dayShort, formatDate, formatTimeRange, isoWeekday } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import FormAlert from "@/components/FormAlert";

export default function HostSchedulePage() {
  const { token, user } = useAuth();
  const schedule = useApiData("my-schedule", () => scheduleApi.mine(token));
  const isHost = user.roles.some((role) => role.name === "host");

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-xl font-bold text-white">My Schedule</h1>

      {schedule.error && <FormAlert tone="error">{schedule.error}</FormAlert>}
      {schedule.data && <WeekList slots={schedule.data.slots} />}
      {schedule.data && schedule.data.upcoming.length > 0 && <UpcomingList slots={schedule.data.upcoming} />}
      {isHost && <AvailabilityEditor />}
    </div>
  );
}

function SlotLine({ slot }: { slot: ScheduleSlot }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg bg-slate-800 px-3 py-2">
      <span className="text-white">{slot.assignment.brand.name}</span>
      <span className="text-sm text-purple-200 whitespace-nowrap">
        {formatTimeRange(slot.start_time, slot.end_time, slot.day_of_week)}
        {slot.slot_type === "pd" && <span className="ml-1 px-1 rounded bg-yellow-500/20 text-yellow-200 text-xs">PD</span>}
      </span>
    </li>
  );
}

/** An overnight slot from the previous day, shown at the top of the day it ends on. */
function CarryOverLine({ slot }: { slot: ScheduleSlot }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-slate-600 px-3 py-2">
      <span className="text-gray-300">{slot.assignment.brand.name}</span>
      <span className="text-xs text-gray-400 whitespace-nowrap">
        until {slot.end_time} · from {dayShort(slot.day_of_week)} {slot.start_time}
      </span>
    </li>
  );
}

/** This week's recurring slots grouped by day, starting from today. */
function WeekList({ slots }: { slots: ScheduleSlot[] }) {
  const today = isoWeekday();
  const ordered = [...DAYS.filter((day) => day.value >= today), ...DAYS.filter((day) => day.value < today)];

  if (slots.length === 0) {
    return (
      <Card>
        <p className="text-sm text-gray-400">You don&apos;t have any live slots yet. Your operator will add them.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {ordered.map((day) => {
        const daySlots = slots.filter((slot) => slot.day_of_week === day.value);
        const carried = carriedInto(slots, day.value);
        if (daySlots.length === 0 && carried.length === 0) return null;

        return (
          <Card key={day.value}>
            <h2 className={`text-sm font-medium ${day.value === today ? "text-purple-300" : "text-white"}`}>
              {day.long}
              {day.value === today && " · today"}
            </h2>
            <ul className="space-y-2">
              {carried.map((slot) => (
                <CarryOverLine key={`carry-${slot.id}`} slot={slot} />
              ))}
              {daySlots.map((slot) => (
                <SlotLine key={slot.id} slot={slot} />
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

function UpcomingList({ slots }: { slots: ScheduleSlot[] }) {
  return (
    <Card title="Starting soon" description="New slots that begin on a later date.">
      <ul className="space-y-2">
        {slots.map((slot) => (
          <li key={slot.id} className="space-y-1">
            <p className="text-xs text-gray-400">
              {DAYS[slot.day_of_week - 1].long}s from {formatDate(slot.effective_from)}
            </p>
            <ul>
              <SlotLine slot={slot} />
            </ul>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Weekly free-time ranges; the whole list is saved at once. */
function AvailabilityEditor() {
  const { token } = useAuth();
  const saved = useApiData("my-availability", () => scheduleApi.myAvailability(token));
  const [draft, setDraft] = useState<AvailabilityRange[] | null>(null);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string; errors?: Record<string, string> } | null>(null);
  const [saving, setSaving] = useState(false);

  const ranges = draft ?? saved.data?.availability ?? [];

  function change(index: number, patch: Partial<AvailabilityRange>) {
    setDraft(ranges.map((range, i) => (i === index ? { ...range, ...patch } : range)));
    setStatus(null);
  }

  async function save() {
    setSaving(true);
    try {
      const result = await scheduleApi.saveAvailability(token, ranges);
      saved.setData({ availability: result.availability });
      setDraft(null);
      setStatus({ tone: "success", text: result.message });
    } catch (caught) {
      setStatus({ tone: "error", text: errorMessage(caught), errors: fieldErrors(caught) });
    } finally {
      setSaving(false);
    }
  }

  const input = "px-2 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-white text-sm";

  return (
    <Card title="When I'm available" description="Helps your operator plan slots. An end time before the start means it runs past midnight.">
      {saved.error && <FormAlert tone="error">{saved.error}</FormAlert>}
      {status && <FormAlert tone={status.tone}>{status.text}</FormAlert>}

      {ranges.length === 0 && <p className="text-sm text-gray-400">No availability added yet.</p>}

      <ul className="space-y-2">
        {ranges.map((range, index) => (
          <li key={index} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={range.day_of_week}
                onChange={(event) => change(index, { day_of_week: Number(event.target.value) as DayOfWeek })}
                aria-label="Day"
                className={input}
              >
                {DAYS.map((day) => (
                  <option key={day.value} value={day.value}>
                    {day.short}
                  </option>
                ))}
              </select>
              <input type="time" value={range.available_from} onChange={(event) => change(index, { available_from: event.target.value })} aria-label="From" className={input} />
              <span className="text-gray-400">–</span>
              <input type="time" value={range.available_to} onChange={(event) => change(index, { available_to: event.target.value })} aria-label="To" className={input} />
              <input
                value={range.note ?? ""}
                onChange={(event) => change(index, { note: event.target.value || null })}
                placeholder="Note"
                aria-label="Note"
                className={`${input} flex-1 min-w-24`}
              />
              <button
                type="button"
                onClick={() => setDraft(ranges.filter((_, i) => i !== index))}
                aria-label="Remove range"
                className="px-2 py-1.5 rounded-md text-gray-400 hover:bg-slate-800 hover:text-white"
              >
                ✕
              </button>
            </div>
            {status?.errors && Object.entries(status.errors).filter(([field]) => field.startsWith(`ranges.${index}.`)).map(([field, message]) => (
              <p key={field} className="text-xs text-red-300">{message}</p>
            ))}
          </li>
        ))}
      </ul>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setDraft([...ranges, { day_of_week: 1, available_from: "08:00", available_to: "17:00", note: null }])}
          className="px-3 py-2 rounded-lg border border-slate-700 text-sm text-gray-300 hover:bg-slate-800"
        >
          Add time
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || draft === null}
          className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save availability"}
        </button>
      </div>
    </Card>
  );
}
