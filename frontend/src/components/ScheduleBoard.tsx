"use client";

import { useState } from "react";
import { operatorApi, scheduleApi, type ScheduleSlot, type SlotBackupMarker } from "@/lib/api";
import { carriedInto, dateOfWeekday, DAYS, dayShort, formatShortDate, formatTimeRange, isoWeekday, toDateInput } from "@/lib/format";
import BackupMarker, { markerFor } from "./BackupMarker";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "./AuthProvider";
import FormAlert from "./FormAlert";
import SlotForm from "./SlotForm";

type Editing = { slot: ScheduleSlot } | { day: number } | null;

/**
 * Weekly timetable for one brand as of a chosen date. Operators add/edit slots;
 * admins can also lock them (`isAdmin`).
 */
export default function ScheduleBoard({ isAdmin = false }: { isAdmin?: boolean }) {
  const { token } = useAuth();
  const [chosenBrandId, setChosenBrandId] = useState("");
  const [on, setOn] = useState(toDateInput());
  const [editing, setEditing] = useState<Editing>(null);

  const brands = useApiData("brands", () => operatorApi.brands(token));
  const activeBrands = brands.data?.brands.filter((brand) => brand.status === "active") ?? [];
  const brandId = chosenBrandId || activeBrands[0]?.id || "";

  const slots = useApiData(`${brandId}|${on}`, () =>
    brandId ? scheduleApi.list(token, { brand_id: brandId, on }) : Promise.resolve({ slots: [], backups: [], replacing_events: [] })
  );
  const hosts = useApiData(brandId, () => (brandId ? scheduleApi.brandHosts(token, brandId) : Promise.resolve({ assignments: [] })));

  const today = on === toDateInput() ? isoWeekday() : null;

  function done() {
    setEditing(null);
    slots.reload();
  }

  if (brands.data && activeBrands.length === 0) {
    return <FormAlert tone="warning">There are no active brands yet. An admin can create them on the Brands page.</FormAlert>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1 space-y-1">
          <span className="block text-sm text-gray-300">Brand</span>
          <select
            value={brandId}
            onChange={(event) => {
              setChosenBrandId(event.target.value);
              setEditing(null);
            }}
            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white"
          >
            {activeBrands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-sm text-gray-300">Schedule as of</span>
          <input
            type="date"
            value={on}
            onChange={(event) => event.target.value && setOn(event.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white"
          />
        </label>
        <button
          type="button"
          onClick={() => setEditing({ day: today ?? 1 })}
          className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-500"
        >
          Add slot
        </button>
      </div>

      {slots.error && <FormAlert tone="error">{slots.error}</FormAlert>}

      {editing && hosts.data && (
        <SlotForm
          key={"slot" in editing ? editing.slot.id : `new-${editing.day}`}
          hosts={hosts.data.assignments}
          slot={"slot" in editing ? editing.slot : undefined}
          day={"day" in editing ? editing.day : undefined}
          isAdmin={isAdmin}
          onDone={done}
          onCancel={() => setEditing(null)}
        />
      )}

      <div className={`grid grid-cols-1 md:grid-cols-7 gap-3 ${slots.loading ? "opacity-60" : ""}`}>
        {DAYS.map((day) => {
          const daySlots = slots.data?.slots.filter((slot) => slot.day_of_week === day.value) ?? [];
          // The board shows the 7 days starting at "as of"; backups are per date
          const date = dateOfWeekday(on, day.value);
          const dayBefore = toDateInput(new Date(new Date(`${date}T00:00`).getTime() - 86_400_000));
          // An event with "schedule opened empty" replaces the regular slots on its days
          const replacedBy = (onDate: string) =>
            slots.data?.replacing_events.find((event) => event.start_date <= onDate && event.end_date >= onDate);
          const event = replacedBy(date);

          return (
            <div
              key={day.value}
              className={`bg-slate-900 border rounded-xl p-3 space-y-2 min-h-24 ${day.value === today ? "border-purple-500" : "border-slate-800"}`}
            >
              {event && (
                <p className="rounded-md bg-yellow-500/10 px-2 py-1 text-[11px] text-yellow-200">
                  {event.name}: regular slots don&apos;t run, hosts claim event blocks
                </p>
              )}
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-white">
                  <span className="md:hidden">{day.long}</span>
                  <span className="hidden md:inline">{day.short}</span>
                  <span className="ml-1 text-xs font-normal text-gray-500">{formatShortDate(date)}</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setEditing({ day: day.value })}
                  aria-label={`Add slot on ${day.long}`}
                  className="w-6 h-6 rounded-md text-gray-400 hover:bg-slate-800 hover:text-white"
                >
                  +
                </button>
              </div>

              {/* Overnight slots from the day before still running this morning */}
              {carriedInto(slots.data?.slots ?? [], day.value).map((slot) => (
                <button
                  key={`carry-${slot.id}`}
                  type="button"
                  onClick={() => setEditing({ slot })}
                  title={`Continues from ${dayShort(slot.day_of_week)} night`}
                  className={`w-full text-left rounded-lg border border-dashed border-slate-600 hover:bg-slate-800 px-2.5 py-1.5 transition-colors ${
                    replacedBy(dayBefore) ? "opacity-40" : ""
                  }`}
                >
                  <span className="block text-xs text-gray-400">
                    until {slot.end_time} · from {dayShort(slot.day_of_week)} {slot.start_time}
                  </span>
                  <span className="block text-sm text-gray-300 truncate">{slot.assignment.host?.user.name}</span>
                  <SlotBackup markers={slots.data?.backups} slotId={slot.id} date={dayBefore} />
                </button>
              ))}

              {daySlots.map((slot) => (
                <button
                  key={slot.id}
                  type="button"
                  onClick={() => setEditing({ slot })}
                  className={`w-full text-left rounded-lg bg-slate-800 hover:bg-slate-700 px-2.5 py-2 transition-colors ${event ? "opacity-40" : ""}`}
                >
                  <span className="block text-xs text-purple-200">
                    {formatTimeRange(slot.start_time, slot.end_time, slot.day_of_week)}
                    {slot.is_locked && <span title="Locked"> 🔒</span>}
                    {slot.slot_type === "pd" && <span className="ml-1 px-1 rounded bg-yellow-500/20 text-yellow-200">PD</span>}
                  </span>
                  <span className="block text-sm text-white truncate">{slot.assignment.host?.user.name}</span>
                  <SlotBackup markers={slots.data?.backups} slotId={slot.id} date={date} />
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-500">
        Slots repeat every week; dates show the week from &quot;Schedule as of&quot;, including backups on those dates. Dashed entries are overnight slots continuing from the day before. Change &quot;Schedule as of&quot; to see or plan a future week.
      </p>
    </div>
  );
}

function SlotBackup({ markers, slotId, date }: { markers?: SlotBackupMarker[]; slotId: string; date: string }) {
  const marker = markerFor(markers, slotId, date);
  return marker ? <BackupMarker marker={marker} /> : null;
}
