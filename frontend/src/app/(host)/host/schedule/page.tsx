"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { ArrowLeftRight, CalendarClock, CalendarX2, ChevronRight, Clock, Moon, Plus, Ticket, Trash2 } from "lucide-react";
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
import { DAYS, dayWord, formatClock, formatDate, isoWeekday, previousDay, toDateInput } from "@/lib/format";
import { addDays, durationMinutes, formatDayDate, inEffectOn, toMinutes, weekStart } from "@/lib/schedule";
import { inputSmClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { timeUntil, useNow } from "@/lib/useNow";
import { useMediaQuery } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import { KnowledgeButton } from "@/components/BrandKnowledge";
import Card from "@/components/Card";
import Dialog from "@/components/Dialog";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import FormAlert from "@/components/FormAlert";
import PageHeader from "@/components/PageHeader";
import { NativeSelect } from "@/components/SelectField";
import StatusBadge, { type Tone } from "@/components/StatusBadge";
import { notify } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** This week and the three after it. */
const WEEKS = 4;
const DAYS_SHOWN = WEEKS * 7;
const DAY_MINUTES = 24 * 60;
const CELL_LINES = 3;

/**
 * own: my slot · off: someone covers me · cover: I cover someone ·
 * event: an event block I took · replaced: an event replaces my slot that day
 */
type Kind = "own" | "off" | "cover" | "event" | "replaced";

interface Entry {
  key: string;
  kind: Kind;
  /** The calendar day it shows on. */
  date: string;
  /** Minutes from 00:00 of that day. */
  start: number;
  end: number;
  /** Clock times as shown, e.g. "22:00" and "02:00". */
  from: string;
  to: string;
  brand: string;
  brandId: string;
  /** What's special about it, e.g. "Digantikan Ayu" or "Backup untuk Rizky". */
  note?: string;
  /** My slot is waiting for a cover. */
  needsCover?: "open" | "pending";
  /** The tail of last night's overnight slot. */
  carried?: boolean;
}

interface Day {
  date: string;
  isToday: boolean;
  past: boolean;
  entries: Entry[];
  /** Minutes I'm live (my slots, covers, event blocks). */
  minutes: number;
}

const kinds: Record<Kind, { bar: string; label: string; tone: Tone }> = {
  own: { bar: "bg-primary", label: "Slot saya", tone: "brand" },
  cover: { bar: "bg-success", label: "Backup", tone: "success" },
  event: { bar: "bg-warning", label: "Event", tone: "warning" },
  off: { bar: "bg-faint", label: "Libur", tone: "neutral" },
  replaced: { bar: "bg-faint", label: "Diganti event", tone: "neutral" },
};

const live = (entry: Entry) => entry.kind === "own" || entry.kind === "cover" || entry.kind === "event";

/** Minutes from 00:00 of `date` for a moment (ISO), held inside that day. */
function minutesOn(iso: string, date: string): number {
  const moment = new Date(iso);
  if (toDateInput(moment) > date) return DAY_MINUTES;
  return moment.getHours() * 60 + moment.getMinutes();
}

/** 390 → "6j 30m" */
function compactHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}j` : `${h}j ${m}m`;
}

function buildDays(
  start: string,
  today: string,
  slots: ScheduleSlot[],
  absences: SlotBackupMarker[],
  covers: BackupNeed[],
  claims: MyEventClaim[],
  replacing: ReplacingEvent[]
): Day[] {
  const replacedBy = (slot: ScheduleSlot, date: string) =>
    replacing.find((event) => event.brand_id === slot.assignment.brand_id && event.start_date <= date && event.end_date >= date)?.name;
  const markerFor = (slot: ScheduleSlot, date: string) => absences.find((marker) => marker.slot_id === slot.id && marker.backup_date === date);

  /** My slot on the date it starts: who's on it and what happens to it. */
  const slotEntry = (slot: ScheduleSlot, date: string, part: { key: string; date: string; start: number; end: number; carried?: boolean }): Entry => {
    const event = replacedBy(slot, date);
    const marker = markerFor(slot, date);
    const base = { ...part, from: slot.start_time, to: slot.end_time, brand: slot.assignment.brand.name, brandId: slot.assignment.brand.id };
    if (event) return { ...base, kind: "replaced", note: `Diganti event ${event}` };
    if (marker?.status === "filled") return { ...base, kind: "off", note: `Digantikan ${marker.filler_name ?? "host lain"}` };
    if (marker) return { ...base, kind: "own", note: marker.status === "open" ? "Mencari backup" : "Backup diajukan", needsCover: marker.status };
    return { ...base, kind: "own", note: slot.slot_type === "pd" ? "PD" : undefined };
  };

  return Array.from({ length: DAYS_SHOWN }, (_, index) => {
    const date = addDays(start, index);
    const weekday = isoWeekday(new Date(`${date}T00:00`));
    const dayBefore = addDays(date, -1);

    const own = slots
      .filter((slot) => slot.day_of_week === weekday && inEffectOn(slot, date))
      .map((slot) => {
        const begin = toMinutes(slot.start_time);
        return slotEntry(slot, date, { key: `${slot.id}|${date}`, date, start: begin, end: Math.min(DAY_MINUTES, begin + durationMinutes(slot.start_time, slot.end_time)) });
      });

    // Overnight slots from the evening before, still running this morning
    const carried = slots
      .filter((slot) => slot.crosses_midnight && slot.day_of_week === previousDay(weekday) && inEffectOn(slot, dayBefore))
      .map((slot) => ({
        ...slotEntry(slot, dayBefore, { key: `${slot.id}|${dayBefore}|carry`, date, start: 0, end: toMinutes(slot.end_time), carried: true }),
        date,
      }));

    const coverEntries: Entry[] = covers
      .filter((cover) => cover.backup_date === date)
      .map((cover) => ({
        key: `cover-${cover.id}`,
        kind: "cover",
        date,
        start: minutesOn(cover.start_at, date),
        end: minutesOn(cover.end_at, date),
        from: formatClock(cover.start_at),
        to: formatClock(cover.end_at),
        brand: cover.brand.name,
        brandId: cover.brand.id,
        note: `Backup untuk ${cover.requester_name}`,
      }));

    const eventEntries: Entry[] = claims
      .filter((claim) => claim.date === date)
      .map((claim) => ({
        key: `event-${claim.id}`,
        kind: "event",
        date,
        start: minutesOn(claim.start_at, date),
        end: minutesOn(claim.end_at, date),
        from: formatClock(claim.start_at),
        to: formatClock(claim.end_at),
        brand: claim.brand.name,
        brandId: claim.brand.id,
        note: `Event ${claim.event_name}`,
      }));

    const entries = [...carried, ...own, ...coverEntries, ...eventEntries].sort((a, b) => a.start - b.start);

    return {
      date,
      isToday: date === today,
      past: date < today,
      entries,
      minutes: entries.filter(live).reduce((total, entry) => total + (entry.end - entry.start), 0),
    };
  });
}

export default function HostSchedulePage() {
  const { token, user } = useAuth();
  const schedule = useApiData("my-schedule-calendar", () => scheduleApi.mine(token, DAYS_SHOWN));
  const isHost = user.roles.some((role) => role.name === "host");
  const today = toDateInput();
  const start = weekStart(today);
  const data = schedule.data;

  // Slots that start later (a change from next week) take part in the calendar from their first day
  const slots = data ? [...data.slots, ...data.upcoming.filter((later) => !data.slots.some((slot) => slot.id === later.id))] : [];
  const days = data ? buildDays(start, today, slots, data.absences, data.covers, data.event_claims, data.replacing_events) : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Jadwal saya" description="Empat minggu ke depan, mulai minggu ini. Klik tanggal untuk melihat detailnya." />

      {schedule.error && <ErrorState message={schedule.error} onRetry={schedule.reload} />}

      {!data && !schedule.error && (
        <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_22rem]" aria-busy="true" aria-label="Memuat jadwal">
          <div className="space-y-4">
            <Skeleton className="h-[74px] rounded-xl" />
            <Skeleton className="h-[32rem] rounded-xl" />
          </div>
          <Skeleton className="h-80 rounded-xl" />
        </div>
      )}

      {data && (
        <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-4">
            {slots.length === 0 && data.covers.length === 0 && data.event_claims.length === 0 ? (
              <Card>
                <EmptyState
                  icon={CalendarX2}
                  title="Belum ada slot live"
                  description="Operator akan menambahkan slot untukmu. Isi waktu luangmu supaya mereka tahu kapan kamu bisa."
                />
              </Card>
            ) : (
              <>
                <Summary days={days} />
                <Calendar days={days} today={today} />
              </>
            )}
          </div>

          <aside className="grid items-start gap-6 md:grid-cols-2 2xl:sticky 2xl:top-20 2xl:grid-cols-1">
            <NextUp days={days} />
            {isHost && <AvailabilityEditor />}
            {data.upcoming.length > 0 && <UpcomingList slots={data.upcoming} />}
          </aside>
        </div>
      )}
    </div>
  );
}

/** Four numbers for the four weeks. */
function Summary({ days }: { days: Day[] }) {
  const ahead = days.filter((day) => !day.past);
  const entries = ahead.flatMap((day) => day.entries.filter((entry) => !entry.carried));
  const covering = entries.filter((entry) => entry.kind === "cover").length;
  const asked = entries.filter((entry) => entry.kind === "off" || entry.needsCover).length;
  const metrics: { label: string; value: React.ReactNode; tone?: string }[] = [
    { label: "Sesi live", value: entries.filter(live).length },
    { label: "Jam live", value: compactHours(ahead.reduce((total, day) => total + day.minutes, 0)) },
    { label: "Jadi backup", value: covering, tone: covering > 0 ? "text-success" : undefined },
    { label: "Minta backup", value: asked, tone: entries.some((entry) => entry.needsCover === "open") ? "text-destructive" : undefined },
  ];

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-xs sm:grid-cols-4 dark:shadow-none">
      {metrics.map((metric) => (
        <div key={metric.label} className="bg-card px-4 py-3">
          <span className="block truncate text-xs text-muted-foreground">{metric.label}</span>
          <span className={cn("mt-0.5 block text-xl font-semibold tracking-tight text-foreground tabular-nums", metric.tone)}>{metric.value}</span>
        </div>
      ))}
    </div>
  );
}

/** The four weeks as a calendar; a day opens its detail (a side panel, or under the calendar on phones). */
function Calendar({ days, today }: { days: Day[]; today: string }) {
  const wide = useMediaQuery("(min-width: 768px)");
  const [focusDate, setFocusDate] = useState(today);
  const [panelOpen, setPanelOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const selected = days.find((day) => day.date === focusDate) ?? days[0];

  function move(event: KeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const next = addDays(focusDate, step);
    if (!days.some((day) => day.date === next)) return;
    setFocusDate(next);
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus());
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-border shadow-xs dark:shadow-none">
        <div className="grid grid-cols-7 gap-px" aria-hidden="true">
          {DAYS.map((day) => (
            <div key={day.value} className="bg-muted/60 px-2 py-2 text-center text-xs font-medium text-muted-foreground md:text-left">
              {day.short}
            </div>
          ))}
        </div>
        <div ref={gridRef} role="grid" aria-label="Jadwal empat minggu" onKeyDown={move} className="grid grid-cols-7 gap-px border-t border-border">
          {days.map((day) => (
            <DayCell
              key={day.date}
              day={day}
              focused={day.date === focusDate}
              selected={!wide && day.date === focusDate}
              onOpen={() => {
                setFocusDate(day.date);
                if (wide) setPanelOpen(true);
              }}
            />
          ))}
        </div>
      </div>

      <Legend />

      {!wide && selected && (
        <Card title={formatDayDate(selected.date)} description={dayLine(selected)}>
          <DayDetail day={selected} />
        </Card>
      )}

      {wide && panelOpen && selected && (
        <Dialog title={formatDayDate(selected.date)} description={dayLine(selected)} placement="side" size="md" onClose={() => setPanelOpen(false)}>
          <DayDetail day={selected} />
        </Dialog>
      )}
    </>
  );
}

function dayLine(day: Day): string {
  const count = day.entries.filter(live).length;
  return count === 0 ? "Tidak ada jadwal live" : `${count} sesi · ${compactHours(day.minutes)} live`;
}

function Legend() {
  const shown: Kind[] = ["own", "cover", "event", "off"];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Keterangan warna">
      {shown.map((kind) => (
        <li key={kind} className="flex items-center gap-1.5">
          <span className={cn("h-2 w-3.5 rounded-sm", kinds[kind].bar)} aria-hidden="true" />
          {kind === "off" ? "Libur / diganti event" : kinds[kind].label}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-destructive" aria-hidden="true" />
        Mencari backup
      </li>
    </ul>
  );
}

function DayCell({ day, focused, selected, onOpen }: { day: Day; focused: boolean; selected: boolean; onOpen: () => void }) {
  const shown = day.entries.slice(0, CELL_LINES);
  const more = day.entries.length - shown.length;
  const label = [formatDayDate(day.date), dayLine(day)].join(", ");

  return (
    <button
      type="button"
      role="gridcell"
      data-date={day.date}
      tabIndex={focused ? 0 : -1}
      aria-label={label}
      aria-selected={selected || undefined}
      onClick={onOpen}
      className={cn(
        "relative flex min-h-16 flex-col gap-1 bg-card p-1.5 text-left transition-colors outline-none hover:bg-muted focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:min-h-28 md:gap-1.5 md:p-2",
        day.past && "bg-muted text-faint hover:bg-secondary",
        selected && "z-10 ring-2 ring-primary ring-inset"
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full text-xs font-medium tabular-nums",
            day.isToday ? "bg-primary font-semibold text-primary-foreground" : day.past ? "text-faint" : "text-foreground"
          )}
        >
          {Number(day.date.slice(8))}
        </span>
        {day.minutes > 0 && <span className={cn("hidden text-[11px] tabular-nums md:inline", day.past ? "text-faint" : "text-muted-foreground")}>{compactHours(day.minutes)}</span>}
      </div>

      {/* Phones: a dot per kind */}
      <div className="flex flex-wrap gap-1 md:hidden" aria-hidden="true">
        {[...new Set(day.entries.map((entry) => (entry.needsCover === "open" ? "need" : entry.kind)))].map((kind) => (
          <span key={kind} className={cn("size-1.5 rounded-full", kind === "need" ? "bg-destructive" : kinds[kind as Kind].bar)} />
        ))}
      </div>

      <ul className={cn("hidden min-w-0 space-y-1 md:block", day.past && "opacity-60")}>
        {shown.map((entry) => (
          <li key={entry.key} className="flex min-w-0 items-stretch gap-1.5 rounded-sm bg-muted/60 pr-1.5 text-[11px] leading-4">
            <span className={cn("w-[3px] shrink-0 rounded-l-sm", entry.needsCover === "open" ? "bg-destructive" : kinds[entry.kind].bar)} aria-hidden="true" />
            <span className="min-w-0 flex-1 py-0.5">
              <span
                className={cn(
                  "block truncate font-medium",
                  entry.kind === "off" || entry.kind === "replaced" ? "text-muted-foreground line-through" : "text-foreground"
                )}
              >
                {entry.brand}
              </span>
              <span className="block truncate text-muted-foreground tabular-nums">
                {entry.carried ? "00:00" : entry.from}–{entry.to}
              </span>
            </span>
          </li>
        ))}
        {more > 0 && <li className="text-[11px] font-medium text-muted-foreground">+{more} lainnya</li>}
      </ul>
    </button>
  );
}

/** One day: each session with its time and what's special about it, plus where to act on it. */
function DayDetail({ day }: { day: Day }) {
  const ownAhead = day.entries.some((entry) => entry.kind === "own" && !entry.needsCover && !day.past);
  const backupInvolved = day.entries.some((entry) => entry.kind === "cover" || entry.kind === "off" || entry.needsCover);
  const hasEvent = day.entries.some((entry) => entry.kind === "event" || entry.kind === "replaced");

  if (day.entries.length === 0) {
    return <EmptyState compact icon={CalendarX2} title="Tidak ada jadwal live" description="Kamu bebas di hari ini." />;
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {day.entries.map((entry) => (
          <li key={entry.key} className="flex items-center gap-3 bg-card px-3.5 py-3">
            <span className={cn("h-10 w-1 shrink-0 rounded-full", entry.needsCover === "open" ? "bg-destructive" : kinds[entry.kind].bar)} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-sm font-medium", entry.kind === "off" || entry.kind === "replaced" ? "text-muted-foreground line-through" : "text-foreground")}>
                {entry.brand}
              </p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                {entry.carried && <Moon className="size-3" aria-hidden="true" />}
                {entry.from}–{entry.to}
                {entry.carried ? " · lanjutan dari kemarin" : ` · ${compactHours(entry.end - entry.start)}`}
              </p>
            </div>
            {entry.note && (
              <StatusBadge
                tone={entry.needsCover === "open" ? "danger" : entry.needsCover === "pending" ? "warning" : kinds[entry.kind].tone}
                className="max-w-[45%] truncate"
              >
                {(entry.kind === "cover" || entry.kind === "off" || entry.needsCover) && <ArrowLeftRight className="size-3" aria-hidden="true" />}
                {entry.kind === "event" && <Ticket className="size-3" aria-hidden="true" />}
                <span className="truncate">{entry.note}</span>
              </StatusBadge>
            )}
            {live(entry) && !day.past && <KnowledgeButton brand={{ id: entry.brandId, name: entry.brand }} compact className="shrink-0" />}
          </li>
        ))}
      </ul>

      {(ownAhead || backupInvolved || hasEvent) && (
        <div className="grid gap-2">
          {(ownAhead || backupInvolved) && (
            <Button asChild variant="outline" className="w-full justify-between">
              <Link href="/host/backups">
                {ownAhead && !backupInvolved ? "Tidak bisa live? Ajukan backup" : "Lihat di halaman Backup"}
                <ChevronRight aria-hidden="true" />
              </Link>
            </Button>
          )}
          {hasEvent && (
            <Button asChild variant="outline" className="w-full justify-between">
              <Link href="/host/events">
                Lihat di halaman Event
                <ChevronRight aria-hidden="true" />
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** The next few sessions I'm live, the first with a countdown. */
function NextUp({ days }: { days: Day[] }) {
  const now = useNow(60_000);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const today = toDateInput(now);
  const next = days
    .filter((day) => day.date >= today)
    .flatMap((day) => day.entries.filter((entry) => live(entry) && !entry.carried && (day.date > today || entry.end > minutesNow)))
    .slice(0, 5);

  return (
    <Card title="Berikutnya" bodyClassName="pt-3">
      {next.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tidak ada sesi live dalam empat minggu ke depan.</p>
      ) : (
        <ol className="space-y-2.5">
          {next.map((entry, index) => {
            const startsAt = new Date(`${entry.date}T${entry.from}`);
            const running = entry.date === today && entry.start <= minutesNow;
            return (
              <li key={entry.key} className={cn("flex items-start gap-3", index === 0 && "rounded-lg border border-primary/30 bg-primary/[0.05] p-3")}>
                <span className={cn("mt-1 h-8 w-1 shrink-0 rounded-full", entry.needsCover === "open" ? "bg-destructive" : kinds[entry.kind].bar)} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    {dayWord(entry.date)} · <span className="tabular-nums">{entry.from}–{entry.to}</span>
                  </p>
                  <p className="truncate text-sm font-semibold text-foreground">{entry.brand}</p>
                  {entry.note && <p className="truncate text-xs text-muted-foreground">{entry.note}</p>}
                  {index === 0 && (
                    <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-brand">
                      <Clock className="size-3.5" aria-hidden="true" />
                      {running ? "Sedang berlangsung" : `Mulai ${timeUntil(startsAt, now)}`}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {next.length > 0 && next[0].date === today && (
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link href="/host/live">Buka halaman Live</Link>
        </Button>
      )}
    </Card>
  );
}

function UpcomingList({ slots }: { slots: ScheduleSlot[] }) {
  return (
    <Card title="Slot baru" description="Mulai berlaku di tanggal berikutnya.">
      <ul className="space-y-2.5">
        {slots.map((slot) => (
          <li key={slot.id} className="flex items-start gap-3">
            <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{slot.assignment.brand.name}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                Setiap {DAYS[slot.day_of_week - 1].long}, {slot.start_time}–{slot.end_time} · mulai {formatDate(slot.effective_from)}
              </p>
            </div>
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
  const [status, setStatus] = useState<{ text: string; errors?: Record<string, string> } | null>(null);
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
      setStatus(null);
      notify({ text: result.message });
    } catch (caught) {
      setStatus({ text: errorMessage(caught), errors: fieldErrors(caught) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="Waktu luang"
      description="Membantu operator menyusun slot. Jam selesai lebih awal dari jam mulai berarti lewat tengah malam."
    >
      {saved.error && <FormAlert tone="error">{saved.error}</FormAlert>}
      {status && <FormAlert tone="error">{status.text}</FormAlert>}

      {ranges.length === 0 && <p className="text-sm text-muted-foreground">Belum ada waktu luang.</p>}

      <ul className="space-y-2">
        {ranges.map((range, index) => (
          <li key={index} className="space-y-2 rounded-lg border border-border p-2.5">
            <div className="flex items-center gap-2">
              <NativeSelect
                small
                wrapperClassName="flex-1"
                value={range.day_of_week}
                onChange={(event) => change(index, { day_of_week: Number(event.target.value) as DayOfWeek })}
                aria-label="Hari"
              >
                {DAYS.map((day) => (
                  <option key={day.value} value={day.value}>
                    {day.long}
                  </option>
                ))}
              </NativeSelect>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setDraft(ranges.filter((_, i) => i !== index))}
                aria-label="Hapus rentang waktu"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 />
              </Button>
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <input type="time" value={range.available_from} onChange={(event) => change(index, { available_from: event.target.value })} aria-label="Dari" className={cn(inputSmClass, "tabular-nums")} />
              <span className="text-muted-foreground">–</span>
              <input type="time" value={range.available_to} onChange={(event) => change(index, { available_to: event.target.value })} aria-label="Sampai" className={cn(inputSmClass, "tabular-nums")} />
            </div>
            <input
              value={range.note ?? ""}
              onChange={(event) => change(index, { note: event.target.value || null })}
              placeholder="Catatan (opsional)"
              aria-label="Catatan"
              className={inputSmClass}
            />
            {status?.errors &&
              Object.entries(status.errors)
                .filter(([field]) => field.startsWith(`ranges.${index}.`))
                .map(([field, message]) => (
                  <p key={field} className="text-xs text-destructive">
                    {message}
                  </p>
                ))}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setDraft([...ranges, { day_of_week: 1, available_from: "08:00", available_to: "17:00", note: null }])}
        >
          <Plus aria-hidden="true" />
          Tambah
        </Button>
        <Button type="button" onClick={save} disabled={saving || draft === null} className="ml-auto">
          {saving ? "Menyimpan…" : "Simpan"}
        </Button>
      </div>
      {draft !== null && <p className="text-xs text-warning">Ada perubahan yang belum disimpan.</p>}
    </Card>
  );
}
