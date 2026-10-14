import type { ScheduleSlot, SlotHistoryEntry } from "./api";
import { DAYS, isoWeekday, nextDay, toDateInput } from "./format";

/*
 * Helpers for the weekly schedule board and its dialogs. Dates are local "YYYY-MM-DD",
 * times "HH:MM".
 */

const DAY_MINUTES = 24 * 60;

export function dayLong(day: number): string {
  return DAYS[day - 1].long;
}

export function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00`);
  result.setDate(result.getDate() + days);
  return toDateInput(result);
}

/** The Monday of the week `date` falls in. */
export function weekStart(date: string = toDateInput()): string {
  return addDays(date, 1 - isoWeekday(new Date(`${date}T00:00`)));
}

/** The first day of the month `date` falls in: "2026-10-01". */
export function monthStart(date: string = toDateInput()): string {
  return `${date.slice(0, 7)}-01`;
}

/** The first day of the month `count` months later (or earlier). */
export function addMonths(month: string, count: number): string {
  const result = new Date(`${month}T00:00`);
  result.setMonth(result.getMonth() + count, 1);
  return toDateInput(result);
}

/** The weeks a month calendar shows: Monday on or before the 1st to Sunday on or after the last day (35 or 42 days). */
export function monthGrid(month: string): { start: string; days: number } {
  const start = weekStart(month);
  const end = addDays(weekStart(addDays(addMonths(month, 1), -1)), 6);
  const days = Math.round((Date.parse(`${end}T00:00`) - Date.parse(`${start}T00:00`)) / 86_400_000) + 1;
  return { start, days };
}

/** "Oktober 2026" */
export function formatMonth(month: string): string {
  return new Date(`${month}T00:00`).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
}

/** The later of two dates. */
export function laterDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** "6 Oktober 2026" */
export function formatLongDate(date: string): string {
  return new Date(`${date}T00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

/** "Senin, 6 Okt" */
export function formatDayDate(date: string): string {
  return new Date(`${date}T00:00`).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "short" });
}

/** "6 – 12 Oktober 2026", "28 September – 4 Oktober 2026", "29 Desember 2026 – 4 Januari 2027" */
export function formatWeekRange(start: string): string {
  const first = new Date(`${start}T00:00`);
  const last = new Date(`${addDays(start, 6)}T00:00`);
  const month = (date: Date) => date.toLocaleDateString("id-ID", { month: "long" });

  if (first.getFullYear() !== last.getFullYear()) return `${formatLongDate(start)} – ${formatLongDate(addDays(start, 6))}`;
  if (first.getMonth() !== last.getMonth()) {
    return `${first.getDate()} ${month(first)} – ${last.getDate()} ${month(last)} ${last.getFullYear()}`;
  }
  return `${first.getDate()} – ${last.getDate()} ${month(last)} ${last.getFullYear()}`;
}

/** "14:30" → 870 */
export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** 870 → "14:30" (wraps past midnight) */
export function fromMinutes(minutes: number): string {
  const wrapped = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/** Length of a start–end range; an end at or before the start is the next day. */
export function durationMinutes(start: string, end: string): number {
  const length = toMinutes(end) - toMinutes(start);
  return length > 0 ? length : length + DAY_MINUTES;
}

/** 240 → "4 jam", 210 → "3 jam 30 menit", 30 → "30 menit" */
export function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} menit`;
  return minutes === 0 ? `${hours} jam` : `${hours} jam ${minutes} menit`;
}

/** Every half hour of the day, for the time pickers. */
export const HALF_HOURS = Array.from({ length: 48 }, (_, index) => fromMinutes(index * 30));

/**
 * What someone typed as a time, as "HH:MM", or null if it isn't one.
 * "19" → "19:00", "1930" → "19:30", "9.30" → "09:30", "24:00" → "00:00".
 */
export function normalizeTime(input: string): string | null {
  const match = input.trim().match(/^(\d{1,2})(?:[:.]?(\d{2}))?$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes > 0)) return null;
  return fromMinutes(hours * 60 + minutes);
}

/** Whether a weekly slot is in effect on a date (ignores the weekday). */
export function inEffectOn(slot: Pick<ScheduleSlot, "effective_from" | "effective_to">, date: string): boolean {
  return slot.effective_from <= date && (slot.effective_to === null || slot.effective_to >= date);
}

/** "19:00–23:00" or "22:00–02:00 (selesai Selasa)" */
export function describeTimes(day: number, start: string, end: string): string {
  return toMinutes(end) > toMinutes(start) ? `${start}–${end}` : `${start}–${end} (selesai ${dayLong(nextDay(day))})`;
}

/** "setiap Senin, 19:00–23:00" */
export function describeWeekly(day: number, start: string, end: string): string {
  return `setiap ${dayLong(day)}, ${describeTimes(day, start, end)}`;
}

/** "setiap hari, 19:00–23:00", "setiap Senin, Rabu dan Jumat, 22:00–02:00 (selesai esok hari)"; one day as describeWeekly. */
export function describeDays(days: number[], start: string, end: string): string {
  if (days.length === 1) return describeWeekly(days[0], start, end);

  const names = [...days].sort((a, b) => a - b).map(dayLong);
  const which = days.length === 7 ? "setiap hari" : `setiap ${names.slice(0, -1).join(", ")} dan ${names.at(-1)}`;
  const times = toMinutes(end) > toMinutes(start) ? `${start}–${end}` : `${start}–${end} (selesai esok hari)`;
  return `${which}, ${times}`;
}

/** "Andi akan live setiap Senin, 19:00–23:00, mulai 6 Oktober 2026, tanpa batas akhir." */
export function describePlan(plan: { hostName: string; days: number[]; start: string; end: string; from: string; until: string | null }): string {
  const period = plan.until ? `sampai ${formatLongDate(plan.until)}` : "tanpa batas akhir";
  return `${plan.hostName} akan live ${describeDays(plan.days, plan.start, plan.end)}, mulai ${formatLongDate(plan.from)}, ${period}.`;
}

/** "Setiap minggu sejak 6 Okt 2026" or "Sementara: 6 Okt – 31 Okt 2026" */
export function describePeriod(slot: Pick<ScheduleSlot, "effective_from" | "effective_to">): string {
  const short = (date: string) =>
    new Date(`${date}T00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });

  return slot.effective_to
    ? `Sementara: ${short(slot.effective_from)} – ${short(slot.effective_to)}`
    : `Setiap minggu sejak ${short(slot.effective_from)}`;
}

/** The next dates (from `from`, at most `count`) a slot runs on. */
export function upcomingDates(slot: ScheduleSlot, from: string, count: number): string[] {
  const dates: string[] = [];
  let date = laterDate(from, slot.effective_from);
  date = addDays(date, (slot.day_of_week - isoWeekday(new Date(`${date}T00:00`)) + 7) % 7);

  while (dates.length < count && inEffectOn(slot, date)) {
    dates.push(date);
    date = addDays(date, 7);
  }
  return dates;
}

/*
 * History: audit rows store raw column values ("14:00:00", "2026-10-06 00:00:00").
 */
const rawTime = (value: unknown) => String(value ?? "").slice(0, 5);
const rawDate = (value: unknown) => (value ? formatLongDate(String(value).slice(0, 10)) : null);

/** One line saying what an audit row changed on a slot, e.g. "Jam 19:00–23:00 → 20:00–23:00". */
export function describeChange(entry: SlotHistoryEntry): string {
  const before = entry.old_value ?? {};
  const after = entry.new_value ?? {};

  if (entry.action === "delete") return "Slot dihapus";
  if (entry.action === "create") {
    return after.previous_slot_id
      ? `Perubahan mulai berlaku ${rawDate(after.effective_from)}`
      : `Slot dibuat, mulai ${rawDate(after.effective_from)}`;
  }

  const changes: string[] = [];
  if ("start_time" in after || "end_time" in after) {
    const range = (values: Record<string, unknown>, fallback: Record<string, unknown>) =>
      `${rawTime(values.start_time ?? fallback.start_time)}–${rawTime(values.end_time ?? fallback.end_time)}`;
    changes.push("start_time" in before && "end_time" in before ? `Jam ${range(before, after)} → ${range(after, before)}` : "Jam diubah");
  }
  if ("day_of_week" in after) changes.push(`Hari ${dayLong(Number(before.day_of_week))} → ${dayLong(Number(after.day_of_week))}`);
  if ("slot_type" in after) changes.push(`Tipe ${after.slot_type === "pd" ? "PD" : "Reguler"}`);
  if ("assignment_id" in after) changes.push("Host diganti");
  if ("effective_from" in after) changes.push(`Mulai ${rawDate(after.effective_from)}`);
  if ("effective_to" in after) changes.push(after.effective_to ? `Berakhir ${rawDate(after.effective_to)}` : "Berlaku tanpa batas akhir");
  // true/false, or 1/0 straight from the database
  if ("is_locked" in after) changes.push(Number(after.is_locked) === 1 ? "Dikunci" : "Kunci dibuka");

  return changes.length > 0 ? changes.join(" · ") : "Diubah";
}
