/**
 * The agency runs on WIB: the backend stores and compares times in Asia/Jakarta and slot times
 * ("14:00") are WIB. Moments from the server (ISO, in UTC) are shown in WIB too, whatever the
 * device's time zone, so a phone set to WITA shows the same hours as the schedule.
 */
export const APP_TIME_ZONE = "Asia/Jakarta";

const appDateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const appTimeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** The WIB date ("YYYY-MM-DD") of a moment; today's by default. */
export function appDate(moment: Date | string = new Date()): string {
  return appDateFormat.format(new Date(moment));
}

/** The moment a WIB wall-clock time happens, e.g. a slot's "2026-10-06" + "14:00" (WIB is UTC+7 all year). */
export function appMoment(date: string, time = "00:00"): Date {
  return new Date(`${date}T${time.slice(0, 5)}:00+07:00`);
}

/** Minutes since WIB midnight of a moment, e.g. 14:30 → 870. */
export function appMinutes(moment: Date | string = new Date()): number {
  const [hours, minutes] = appTimeFormat.format(new Date(moment)).split(":").map(Number);
  return hours * 60 + minutes;
}

/** True if this device's clock isn't on WIB right now (times on screen then differ from its own clock). */
export function deviceOutsideAppTimeZone(): boolean {
  const now = new Date();
  return appMinutes(now) !== now.getHours() * 60 + now.getMinutes() || appDate(now) !== toDateInput(now);
}

const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

/** 15000 → "Rp 15.000" */
export function formatRupiah(value: string | number): string {
  return rupiah.format(Number(value));
}

/** "2026-09-28" (or a moment) → "28 Sep 2026" */
export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: APP_TIME_ZONE });
}

/** Today (or `moment`) in full for page headers, e.g. "Jumat, 23 Oktober 2026" (WIB). */
export function formatFullDay(moment: Date = new Date(), withYear = true): string {
  return moment.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", ...(withYear && { year: "numeric" }), timeZone: APP_TIME_ZONE });
}

/** "1 Okt 2026 – 28 Okt 2026", or "1 Okt 2026 – sekarang" while a pay period still runs. */
export function formatPeriodDates(start: string, end: string | null): string {
  return `${formatDate(start)} – ${end ? formatDate(end) : "sekarang"}`;
}

/** 13 → "1 yr 1 mo" */
export function formatTenure(joinDate: string): string {
  const joined = new Date(joinDate);
  const now = new Date();
  const months = Math.max(0, (now.getFullYear() - joined.getFullYear()) * 12 + now.getMonth() - joined.getMonth() - (now.getDate() < joined.getDate() ? 1 : 0));
  const years = Math.floor(months / 12);

  if (years === 0) return `${months} bln`;
  return months % 12 === 0 ? `${years} thn` : `${years} thn ${months % 12} bln`;
}

export const DAYS = [
  { value: 1, short: "Sen", long: "Senin" },
  { value: 2, short: "Sel", long: "Selasa" },
  { value: 3, short: "Rab", long: "Rabu" },
  { value: 4, short: "Kam", long: "Kamis" },
  { value: 5, short: "Jum", long: "Jumat" },
  { value: 6, short: "Sab", long: "Sabtu" },
  { value: 7, short: "Min", long: "Minggu" },
] as const;

/** ISO weekday (1 = Monday ... 7 = Sunday) of a calendar date (local fields); today's in WIB by default. */
export function isoWeekday(date: Date = new Date(`${appDate()}T00:00`)): number {
  return ((date.getDay() + 6) % 7) + 1;
}

/**
 * A calendar date (a Date built from local fields, e.g. a picked day or date arithmetic) as "YYYY-MM-DD";
 * without one, today in WIB. For a moment from the server use `appDate`.
 */
export function toDateInput(date?: Date): string {
  if (!date) return appDate();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dayShort(day: number): string {
  return DAYS[day - 1].short;
}

/** Monday → Tuesday, Sunday → Monday */
export function nextDay(day: number): number {
  return day === 7 ? 1 : day + 1;
}

export function previousDay(day: number): number {
  return day === 1 ? 7 : day - 1;
}

/**
 * "14:00–15:00". A range that ends after midnight names the end day when the
 * start day is known ("23:00 – Tue 03:30"), otherwise "23:00–03:30 (+1)".
 */
export function formatTimeRange(start: string, end: string, day?: number): string {
  if (end > start) return `${start}–${end}`;
  return day ? `${start} – ${dayShort(nextDay(day))} ${end}` : `${start}–${end} (+1)`;
}

/** Overnight slots from the day before that are still running at the start of `day`. */
export function carriedInto<T extends { day_of_week: number; crosses_midnight: boolean }>(slots: T[], day: number): T[] {
  return slots.filter((slot) => slot.crosses_midnight && slot.day_of_week === previousDay(day));
}

/** "2026-10-06T07:00:00Z" → "Sel, 6 Okt" (WIB) */
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short", timeZone: APP_TIME_ZONE });
}

/** "14:00" (WIB), with a colon like slot times (id-ID would give "14.00") */
export function formatClock(value: string | Date): string {
  return new Date(value).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: APP_TIME_ZONE }).replace(".", ":");
}

/** "Sel 6 Okt, 14:00–16:00" or "Sel 6 Okt, 23:00 – Rab 02:00" (WIB) */
export function formatWindow(startIso: string, endIso: string): string {
  const sameDay = appDate(startIso) === appDate(endIso);
  const end = sameDay ? formatClock(endIso) : ` ${new Date(endIso).toLocaleDateString("id-ID", { weekday: "short", timeZone: APP_TIME_ZONE })} ${formatClock(endIso)}`;
  return `${formatDay(startIso)}, ${formatClock(startIso)}${sameDay ? "–" : " –"}${end}`;
}

/** "Sel 6 Okt, 14:00" (WIB) */
export function formatDateTime(iso: string): string {
  return `${formatDay(iso)}, ${formatClock(iso)}`;
}

/**
 * The date ("YYYY-MM-DD") within the 7 days starting at `from` that falls on `day`
 * (ISO weekday). E.g. from Wednesday, Monday is the Monday after.
 */
export function dateOfWeekday(from: string, day: number): string {
  const start = new Date(`${from}T00:00`);
  start.setDate(start.getDate() + ((day - isoWeekday(start) + 7) % 7));
  return toDateInput(start);
}

/** "2026-10-06" → "6 Oct" */
export function formatShortDate(date: string): string {
  return new Date(`${date}T00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

/** 0.33 → "20 menit", 2 → "2 jam", 2.5 → "2 jam 30 menit" */
export function formatDuration(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;

  if (h === 0) return `${m} menit`;
  return m === 0 ? `${h} jam` : `${h} jam ${m} menit`;
}

/** 12.5 → "12j 30m": short enough for a headline number. */
export function compactHours(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}j` : `${h}j ${m}m`;
}

const compactNumber = new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 });

/** 12_345_678 → "Rp 12,3 jt": short enough for a headline number. */
export function compactRupiah(value: number): string {
  return `Rp ${compactNumber.format(value)}`;
}

const relative = new Intl.RelativeTimeFormat("id-ID", { numeric: "auto" });

/** "baru saja", "5 menit yang lalu", "kemarin"; older than a week falls back to the date. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);

  if (abs < 45) return "baru saja";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86_400) return relative.format(Math.round(seconds / 86_400), "day");
  return formatDateTime(iso);
}

/** "Hari ini", "Besok", or "Sel, 13 Okt" for a moment (ISO) or a date ("YYYY-MM-DD"), by the WIB calendar. */
export function dayWord(value: string, now: Date = new Date()): string {
  const day = value.length === 10 ? value : appDate(value);
  const diff = Math.round((Date.parse(`${day}T00:00Z`) - Date.parse(`${appDate(now)}T00:00Z`)) / 86_400_000);
  if (diff === 0) return "Hari ini";
  if (diff === 1) return "Besok";
  return new Date(`${day}T00:00`).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" });
}
