const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

/** 15000 → "Rp 15.000" */
export function formatRupiah(value: string | number): string {
  return rupiah.format(Number(value));
}

/** "2026-09-28" → "28 Sep 2026" */
export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
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

/** ISO weekday (1 = Monday ... 7 = Sunday) of a local date. */
export function isoWeekday(date: Date = new Date()): number {
  return ((date.getDay() + 6) % 7) + 1;
}

/** Local date as "YYYY-MM-DD" (toISOString would shift it to UTC). */
export function toDateInput(date: Date = new Date()): string {
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

/** "2026-10-06T07:00:00Z" → "Tue 6 Oct" (local time) */
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" });
}

/** "14:00" (local time), with a colon like slot times (id-ID would give "14.00") */
export function formatClock(value: string | Date): string {
  return new Date(value).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }).replace(".", ":");
}

/** "Tue 6 Oct, 14:00–16:00" or "Tue 6 Oct, 23:00 – Wed 02:00" */
export function formatWindow(startIso: string, endIso: string): string {
  const sameDay = new Date(startIso).toDateString() === new Date(endIso).toDateString();
  const end = sameDay ? formatClock(endIso) : ` ${new Date(endIso).toLocaleDateString("id-ID", { weekday: "short" })} ${formatClock(endIso)}`;
  return `${formatDay(startIso)}, ${formatClock(startIso)}${sameDay ? "–" : " –"}${end}`;
}

/** "Tue 6 Oct, 14:00" (local time) */
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

/** "Hari ini", "Besok", or "Sel, 13 Okt" for a moment (ISO) or a date ("YYYY-MM-DD"). */
export function dayWord(value: string, now: Date = new Date()): string {
  const day = new Date(value.length === 10 ? `${value}T00:00` : value);
  const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((start(day) - start(now)) / 86_400_000);
  if (diff === 0) return "Hari ini";
  if (diff === 1) return "Besok";
  return day.toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" });
}
