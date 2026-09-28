const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

/** 15000 → "Rp 15.000" */
export function formatRupiah(value: string | number): string {
  return rupiah.format(Number(value));
}

/** "2026-09-28" → "28 Sep 2026" */
export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** 13 → "1 yr 1 mo" */
export function formatTenure(joinDate: string): string {
  const joined = new Date(joinDate);
  const now = new Date();
  const months = Math.max(0, (now.getFullYear() - joined.getFullYear()) * 12 + now.getMonth() - joined.getMonth() - (now.getDate() < joined.getDate() ? 1 : 0));
  const years = Math.floor(months / 12);

  if (years === 0) return `${months} mo`;
  return months % 12 === 0 ? `${years} yr` : `${years} yr ${months % 12} mo`;
}

export const DAYS = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 7, short: "Sun", long: "Sunday" },
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
