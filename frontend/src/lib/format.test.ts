import { describe, expect, it } from "vitest";
import { appDate, appMinutes, appMoment, dateOfWeekday, dayWord, formatClock, formatDate, formatTimeRange, formatWindow, isoWeekday, toDateInput } from "./format";

// Tests run with TZ=America/New_York (vitest.config.mts): what is shown must still be WIB.
describe("WIB on a device outside WIB", () => {
  it("runs in a non-WIB zone", () => {
    expect(new Date("2026-10-06T00:00:00Z").getTimezoneOffset()).not.toBe(-420);
  });

  it("shows clock times in WIB", () => {
    expect(formatClock("2026-10-06T07:00:00.000000Z")).toBe("14:00");
    expect(appMinutes("2026-10-06T07:30:00Z")).toBe(14 * 60 + 30);
  });

  it("takes the WIB date of a moment", () => {
    // 20:00 UTC on the 6th is already the 7th in Jakarta, still the 6th in New York
    expect(appDate("2026-10-06T20:00:00Z")).toBe("2026-10-07");
    expect(formatDate("2026-10-06T20:00:00Z")).toBe(new Date(Date.UTC(2026, 9, 7, 5)).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }));
  });

  it("treats a date-only value as that calendar day", () => {
    expect(formatDate("2026-09-28")).toContain("28");
  });

  it("puts a slot time on the WIB clock", () => {
    expect(appMoment("2026-10-06", "14:00").toISOString()).toBe("2026-10-06T07:00:00.000Z");
    expect(appMoment("2026-10-06", "14:00:00").toISOString()).toBe("2026-10-06T07:00:00.000Z");
  });

  it("says today and tomorrow by the WIB calendar", () => {
    const now = new Date("2026-10-06T18:00:00Z"); // 01:00 on the 7th in WIB
    expect(dayWord("2026-10-07T05:00:00Z", now)).toBe("Hari ini");
    expect(dayWord("2026-10-08", now)).toBe("Besok");
  });

  it("shows a window crossing midnight with the end day", () => {
    expect(formatWindow("2026-10-06T16:00:00Z", "2026-10-06T19:00:00Z")).toMatch(/23:00 – \S+ 02:00$/);
    expect(formatWindow("2026-10-06T07:00:00Z", "2026-10-06T09:00:00Z")).toMatch(/14:00–16:00$/);
  });

  it("defaults today to the WIB date", () => {
    expect(toDateInput()).toBe(appDate());
    expect(isoWeekday()).toBe(isoWeekday(new Date(`${appDate()}T00:00`)));
  });
});

describe("calendar dates", () => {
  it("keeps a local calendar date as is", () => {
    expect(toDateInput(new Date(2026, 0, 31))).toBe("2026-01-31");
  });

  it("finds the weekday within the next seven days", () => {
    expect(dateOfWeekday("2026-10-07", 1)).toBe("2026-10-12"); // Wednesday → next Monday
    expect(dateOfWeekday("2026-10-07", 3)).toBe("2026-10-07"); // the same day
  });

  it("names the end day of an overnight range", () => {
    expect(formatTimeRange("14:00", "16:00")).toBe("14:00–16:00");
    expect(formatTimeRange("23:00", "03:30")).toBe("23:00–03:30 (+1)");
    expect(formatTimeRange("23:00", "03:30", 2)).toBe("23:00 – Rab 03:30");
  });
});
