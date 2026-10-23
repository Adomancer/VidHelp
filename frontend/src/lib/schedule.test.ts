import { describe, expect, it } from "vitest";
import type { ScheduleSlot } from "./api";
import { addDays, addMonths, describeDays, describeTimes, durationMinutes, fromMinutes, monthGrid, normalizeTime, upcomingDates, weekStart } from "./schedule";

describe("times", () => {
  it("measures ranges that cross midnight", () => {
    expect(durationMinutes("14:00", "16:30")).toBe(150);
    expect(durationMinutes("22:00", "02:00")).toBe(240);
    expect(durationMinutes("10:00", "10:00")).toBe(24 * 60);
  });

  it("wraps minutes past midnight", () => {
    expect(fromMinutes(25 * 60 + 15)).toBe("01:15");
    expect(fromMinutes(-30)).toBe("23:30");
  });

  it("reads what people type as a time", () => {
    expect(normalizeTime("19")).toBe("19:00");
    expect(normalizeTime("1930")).toBe("19:30");
    expect(normalizeTime("9.30")).toBe("09:30");
    expect(normalizeTime("24:00")).toBe("00:00");
    expect(normalizeTime("24:30")).toBeNull();
    expect(normalizeTime("7:61")).toBeNull();
    expect(normalizeTime("abc")).toBeNull();
  });

  it("names the day an overnight slot ends", () => {
    expect(describeTimes(1, "19:00", "23:00")).toBe("19:00–23:00");
    expect(describeTimes(1, "22:00", "02:00")).toBe("22:00–02:00 (selesai Selasa)");
    expect(describeTimes(7, "23:00", "01:00")).toBe("23:00–01:00 (selesai Senin)");
    expect(describeDays([5, 1, 3], "22:00", "02:00")).toBe("setiap Senin, Rabu dan Jumat, 22:00–02:00 (selesai esok hari)");
  });
});

describe("dates", () => {
  it("adds days across months and years", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("starts weeks on Monday", () => {
    expect(weekStart("2026-10-07")).toBe("2026-10-05");
    expect(weekStart("2026-10-11")).toBe("2026-10-05"); // Sunday
  });

  it("moves to the first of other months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
  });

  it("covers whole weeks in a month calendar", () => {
    expect(monthGrid("2026-10-01")).toEqual({ start: "2026-09-28", days: 35 });
    expect(monthGrid("2026-03-01")).toEqual({ start: "2026-02-23", days: 42 });
  });
});

describe("upcomingDates", () => {
  const slot = { day_of_week: 2, effective_from: "2026-10-01", effective_to: "2026-10-20" } as ScheduleSlot;

  it("lists the weekday's dates while the slot is in effect", () => {
    expect(upcomingDates(slot, "2026-09-01", 5)).toEqual(["2026-10-06", "2026-10-13", "2026-10-20"]);
    expect(upcomingDates(slot, "2026-10-14", 5)).toEqual(["2026-10-20"]);
  });
});
