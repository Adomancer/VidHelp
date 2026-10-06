"use client";

import { useState } from "react";
import {
  errorMessage,
  fieldErrors,
  scheduleApi,
  type AvailabilityRange,
  type BackupNeed,
  type DayOfWeek,
  type MyEventClaim,
  type ReplacingEvent,
  type ScheduleSlot,
  type SlotBackupMarker,
} from "@/lib/api";
import { carriedInto, dateOfWeekday, DAYS, dayShort, formatDate, formatShortDate, formatTimeRange, formatWindow, isoWeekday, toDateInput } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import BackupMarker, { markerFor } from "@/components/BackupMarker";
import FormAlert from "@/components/FormAlert";

export default function HostSchedulePage() {
  const { token, user } = useAuth();
  const schedule = useApiData("my-schedule", () => scheduleApi.mine(token));
  const isHost = user.roles.some((role) => role.name === "host");

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-xl font-bold text-white">Jadwal Saya</h1>

      {schedule.error && <FormAlert tone="error">{schedule.error}</FormAlert>}
      {schedule.data && (
        <WeekList
          slots={schedule.data.slots}
          covers={schedule.data.covers}
          absences={schedule.data.absences}
          eventClaims={schedule.data.event_claims}
          replacingEvents={schedule.data.replacing_events}
        />
      )}
      {schedule.data && schedule.data.upcoming.length > 0 && <UpcomingList slots={schedule.data.upcoming} />}
      {isHost && <AvailabilityEditor />}
    </div>
  );
}

function SlotLine({ slot, marker, replacedBy }: { slot: ScheduleSlot; marker?: SlotBackupMarker; replacedBy?: string }) {
  const off = marker?.status === "filled" || replacedBy !== undefined;

  return (
    <li className={`rounded-lg px-3 py-2 ${off ? "bg-slate-800/40" : "bg-slate-800"}`}>
      <div className="flex items-center justify-between gap-3">
        <span className={off ? "text-gray-400 line-through" : "text-white"}>{slot.assignment.brand.name}</span>
        <span className={`text-sm whitespace-nowrap ${off ? "text-gray-500 line-through" : "text-purple-200"}`}>
          {formatTimeRange(slot.start_time, slot.end_time, slot.day_of_week)}
          {slot.slot_type === "pd" && <span className="ml-1 px-1 rounded bg-yellow-500/20 text-yellow-200 text-xs">PD</span>}
        </span>
      </div>
      {replacedBy ? (
        <span className="block text-xs text-yellow-200">Diganti event {replacedBy}: ambil blok event di bawah</span>
      ) : (
        marker && <BackupMarker marker={marker} mine />
      )}
    </li>
  );
}

/** An event block I claimed on this date. */
function EventLine({ claim }: { claim: MyEventClaim }) {
  return (
    <li className="rounded-lg bg-yellow-500/10 border border-yellow-400/30 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-white">{claim.brand.name}</span>
        <span className="text-sm text-yellow-100 whitespace-nowrap">{formatWindow(claim.start_at, claim.end_at).split(", ")[1]}</span>
      </div>
      <span className="block text-xs text-yellow-200">Event: {claim.event_name}</span>
    </li>
  );
}

/** A backup I'm doing for someone else on this date. */
function CoverLine({ cover }: { cover: BackupNeed }) {
  return (
    <li className="rounded-lg bg-green-500/10 border border-green-400/30 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-white">{cover.brand.name}</span>
        <span className="text-sm text-green-200 whitespace-nowrap">{formatWindow(cover.start_at, cover.end_at).split(", ")[1]}</span>
      </div>
      <span className="block text-xs text-green-300">Backup untuk {cover.requester_name}</span>
    </li>
  );
}

/** An overnight slot from the previous day, shown at the top of the day it ends on. */
function CarryOverLine({ slot }: { slot: ScheduleSlot }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-slate-600 px-3 py-2">
      <span className="text-gray-300">{slot.assignment.brand.name}</span>
      <span className="text-xs text-gray-400 whitespace-nowrap">
        sampai {slot.end_time} · dari {dayShort(slot.day_of_week)} {slot.start_time}
      </span>
    </li>
  );
}

/**
 * The next 7 days starting today: my recurring slots (marked when someone covers
 * me or an event replaces them), backups I'm doing for others and my event blocks.
 */
function WeekList({
  slots,
  covers,
  absences,
  eventClaims,
  replacingEvents,
}: {
  slots: ScheduleSlot[];
  covers: BackupNeed[];
  absences: SlotBackupMarker[];
  eventClaims: MyEventClaim[];
  replacingEvents: ReplacingEvent[];
}) {
  const today = isoWeekday();
  const todayDate = toDateInput();
  const ordered = [...DAYS.filter((day) => day.value >= today), ...DAYS.filter((day) => day.value < today)];
  const replacedBy = (slot: ScheduleSlot, date: string) =>
    replacingEvents.find((event) => event.brand_id === slot.assignment.brand_id && event.start_date <= date && event.end_date >= date)?.name;

  if (slots.length === 0 && covers.length === 0 && eventClaims.length === 0) {
    return (
      <Card>
        <p className="text-sm text-gray-400">Kamu belum punya slot live. Operator akan menambahkannya.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {ordered.map((day) => {
        const date = dateOfWeekday(todayDate, day.value);
        const daySlots = slots.filter((slot) => slot.day_of_week === day.value);
        const carried = carriedInto(slots, day.value);
        const dayCovers = covers.filter((cover) => cover.backup_date === date);
        const dayEvents = eventClaims.filter((claim) => claim.date === date);
        if (daySlots.length === 0 && carried.length === 0 && dayCovers.length === 0 && dayEvents.length === 0) return null;

        return (
          <Card key={day.value}>
            <h2 className={`text-sm font-medium ${day.value === today ? "text-purple-300" : "text-white"}`}>
              {day.long}
              <span className="ml-1 font-normal text-gray-500">{formatShortDate(date)}</span>
              {day.value === today && " · hari ini"}
            </h2>
            <ul className="space-y-2">
              {carried.map((slot) => (
                <CarryOverLine key={`carry-${slot.id}`} slot={slot} />
              ))}
              {daySlots.map((slot) => (
                <SlotLine key={slot.id} slot={slot} marker={markerFor(absences, slot.id, date)} replacedBy={replacedBy(slot, date)} />
              ))}
              {dayCovers.map((cover) => (
                <CoverLine key={cover.id} cover={cover} />
              ))}
              {dayEvents.map((claim) => (
                <EventLine key={claim.id} claim={claim} />
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
    <Card title="Segera dimulai" description="Slot baru yang mulai di tanggal berikutnya.">
      <ul className="space-y-2">
        {slots.map((slot) => (
          <li key={slot.id} className="space-y-1">
            <p className="text-xs text-gray-400">
              Setiap {DAYS[slot.day_of_week - 1].long} mulai {formatDate(slot.effective_from)}
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
    <Card title="Waktu luang saya" description="Membantu operator menyusun slot. Jam selesai yang lebih awal dari jam mulai berarti lewat tengah malam.">
      {saved.error && <FormAlert tone="error">{saved.error}</FormAlert>}
      {status && <FormAlert tone={status.tone}>{status.text}</FormAlert>}

      {ranges.length === 0 && <p className="text-sm text-gray-400">Belum ada waktu luang yang ditambahkan.</p>}

      <ul className="space-y-2">
        {ranges.map((range, index) => (
          <li key={index} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={range.day_of_week}
                onChange={(event) => change(index, { day_of_week: Number(event.target.value) as DayOfWeek })}
                aria-label="Hari"
                className={input}
              >
                {DAYS.map((day) => (
                  <option key={day.value} value={day.value}>
                    {day.short}
                  </option>
                ))}
              </select>
              <input type="time" value={range.available_from} onChange={(event) => change(index, { available_from: event.target.value })} aria-label="Dari" className={input} />
              <span className="text-gray-400">–</span>
              <input type="time" value={range.available_to} onChange={(event) => change(index, { available_to: event.target.value })} aria-label="Sampai" className={input} />
              <input
                value={range.note ?? ""}
                onChange={(event) => change(index, { note: event.target.value || null })}
                placeholder="Catatan"
                aria-label="Catatan"
                className={`${input} flex-1 min-w-24`}
              />
              <button
                type="button"
                onClick={() => setDraft(ranges.filter((_, i) => i !== index))}
                aria-label="Hapus rentang waktu"
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
          Tambah waktu
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || draft === null}
          className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-500 disabled:opacity-50"
        >
          {saving ? "Menyimpan…" : "Simpan waktu luang"}
        </button>
      </div>
    </Card>
  );
}
