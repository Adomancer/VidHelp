"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeftRight, CalendarX2, ChevronRight, Clock, Lock, Plus, Ticket, X } from "lucide-react";
import type { BrandHost, ReplacingEvent, ScheduleSlot, SlotBackupMarker } from "@/lib/api";
import { DAYS, isoWeekday, previousDay } from "@/lib/format";
import { addDays, durationMinutes, formatDayDate, formatMonth, fromMinutes, inEffectOn, toMinutes } from "@/lib/schedule";
import { useMediaQuery } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Card from "./Card";
import Dialog from "./Dialog";
import EmptyState from "./EmptyState";
import { NativeSelect } from "./SelectField";
import StatusBadge, { type Tone } from "./StatusBadge";
import UserAvatar from "./UserAvatar";

const DAY_MINUTES = 24 * 60;
/** Lines a day cell lists before "+N lainnya". */
const CELL_LINES = 3;
/** Shorter breaks between slots aren't worth calling out. */
const MIN_GAP = 30;

/** One stretch of live time inside a calendar day; an overnight slot is split over two days. */
interface Session {
  key: string;
  slot: ScheduleSlot;
  /** The date the session starts on (the slot detail opens for that date). */
  date: string;
  /** Minutes from 00:00 of this day. */
  start: number;
  end: number;
  /** The tail of last night's overnight slot. */
  carried: boolean;
  marker?: SlotBackupMarker;
  /** An event takes over the brand's schedule that day, so this doesn't run. */
  replaced: boolean;
}

interface Day {
  date: string;
  inMonth: boolean;
  past: boolean;
  isToday: boolean;
  event?: ReplacingEvent;
  sessions: Session[];
  /** Live minutes that actually run (not replaced by an event). */
  minutes: number;
  /** Sessions still without a confirmed cover. */
  needsBackup: number;
}

type State = "regular" | "pd" | "covered" | "pending" | "open" | "replaced";

const states: Record<State, { fill: string; label: string; tone: Tone }> = {
  regular: { fill: "bg-primary", label: "Reguler", tone: "brand" },
  pd: { fill: "bg-primary/55", label: "PD", tone: "brand" },
  covered: { fill: "bg-success", label: "Digantikan backup", tone: "success" },
  pending: { fill: "bg-warning", label: "Backup menunggu keputusan", tone: "warning" },
  open: { fill: "bg-destructive", label: "Butuh backup", tone: "danger" },
  replaced: { fill: "bg-[repeating-linear-gradient(135deg,var(--faint)_0_2px,transparent_2px_5px)]", label: "Diganti event", tone: "neutral" },
};

function stateOf(session: Session): State {
  if (session.replaced) return "replaced";
  if (session.marker?.status === "filled") return "covered";
  if (session.marker?.status === "open") return "open";
  if (session.marker?.status === "pending") return "pending";
  return session.slot.slot_type === "pd" ? "pd" : "regular";
}

/** Who is live: the cover when someone covers the slot. */
function liveName(session: Session): string {
  if (session.marker?.status === "filled" && session.marker.filler_name) return session.marker.filler_name;
  return session.slot.assignment.host?.user.name ?? "Host";
}

/** 390 → "6j 30m" */
function compactHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}j` : `${h}j ${m}m`;
}

function eventOn(events: ReplacingEvent[], date: string) {
  return events.find((event) => event.start_date <= date && event.end_date >= date);
}

function markerOn(markers: SlotBackupMarker[], slotId: string, date: string) {
  return markers.find((marker) => marker.slot_id === slotId && marker.backup_date === date);
}

/** Every day the grid shows, with the slots that run on it. */
function buildDays(
  start: string,
  count: number,
  month: string,
  today: string,
  slots: ScheduleSlot[],
  backups: SlotBackupMarker[],
  events: ReplacingEvent[]
): Day[] {
  return Array.from({ length: count }, (_, index) => {
    const date = addDays(start, index);
    const weekday = isoWeekday(new Date(`${date}T00:00`));
    const dayBefore = addDays(date, -1);
    const event = eventOn(events, date);
    const eventBefore = eventOn(events, dayBefore);

    const own: Session[] = slots
      .filter((slot) => slot.day_of_week === weekday && inEffectOn(slot, date))
      .map((slot) => {
        const begin = toMinutes(slot.start_time);
        return {
          key: `${slot.id}|${date}`,
          slot,
          date,
          start: begin,
          end: Math.min(DAY_MINUTES, begin + durationMinutes(slot.start_time, slot.end_time)),
          carried: false,
          marker: markerOn(backups, slot.id, date),
          replaced: Boolean(event),
        };
      });

    // Overnight slots from the evening before, still running this morning
    const carried: Session[] = slots
      .filter((slot) => slot.crosses_midnight && slot.day_of_week === previousDay(weekday) && inEffectOn(slot, dayBefore))
      .map((slot) => ({
        key: `${slot.id}|${dayBefore}|carry`,
        slot,
        date: dayBefore,
        start: 0,
        end: toMinutes(slot.end_time),
        carried: true,
        marker: markerOn(backups, slot.id, dayBefore),
        replaced: Boolean(eventBefore),
      }));

    const sessions = [...carried, ...own].sort((a, b) => a.start - b.start);
    const running = sessions.filter((session) => !session.replaced);

    return {
      date,
      inMonth: date.slice(0, 7) === month.slice(0, 7),
      past: date < today,
      isToday: date === today,
      event,
      sessions,
      minutes: running.reduce((total, session) => total + (session.end - session.start), 0),
      needsBackup: running.filter((session) => session.marker && session.marker.status !== "filled").length,
    };
  });
}

/** The stretches of the day nobody is live, at least MIN_GAP long. */
function gapsOf(day: Day): [number, number][] {
  const busy = day.sessions
    .filter((session) => !session.replaced)
    .map((session) => [session.start, session.end] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const gaps: [number, number][] = [];
  let cursor = 0;
  for (const [start, end] of busy) {
    if (start - cursor >= MIN_GAP) gaps.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (DAY_MINUTES - cursor >= MIN_GAP) gaps.push([cursor, DAY_MINUTES]);
  return gaps;
}

const timeLabel = (minutes: number) => (minutes >= DAY_MINUTES ? "24:00" : fromMinutes(minutes));

type Focus = "backup" | "empty" | "event" | null;

interface ScheduleMonthProps {
  /** First day of the month shown, "2026-10-01". */
  month: string;
  /** Monday the grid starts on and how many days it shows. */
  gridStart: string;
  gridDays: number;
  today: string;
  slots: ScheduleSlot[];
  backups: SlotBackupMarker[];
  events: ReplacingEvent[];
  hosts: BrandHost[];
  loading: boolean;
  /** Open one slot on one date (detail, then edit, backup, stop, lock). */
  onOpenSlot: (slot: ScheduleSlot, date: string) => void;
  /** Add a weekly slot starting on this weekday. */
  onAddSlot: (day: number, date: string) => void;
}

/**
 * One brand's month: every day shows who is live and when (a 24-hour bar, so empty
 * hours stand out), the hours, events and backups. A summary on top filters the days;
 * a day opens its full detail. Arrow keys move between days.
 */
export default function ScheduleMonth({
  month,
  gridStart,
  gridDays,
  today,
  slots,
  backups,
  events,
  hosts,
  loading,
  onOpenSlot,
  onAddSlot,
}: ScheduleMonthProps) {
  const wide = useMediaQuery("(min-width: 768px)");
  const days = buildDays(gridStart, gridDays, month, today, slots, backups, events);
  const inMonth = days.filter((day) => day.inMonth);
  const [focusDate, setFocusDate] = useState(() => (today.slice(0, 7) === month.slice(0, 7) ? today : month));
  const [panelOpen, setPanelOpen] = useState(false);
  const [focus, setFocus] = useState<Focus>(null);
  const [hostId, setHostId] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);

  const running = (day: Day) => day.sessions.filter((session) => !session.replaced);
  const byHost = (day: Day) => running(day).filter((session) => session.slot.assignment.host_id === hostId);
  const matches = (day: Day) => {
    if (focus === "backup" && day.needsBackup === 0) return false;
    if (focus === "empty" && (running(day).length > 0 || day.event)) return false;
    if (focus === "event" && !day.event) return false;
    if (hostId && byHost(day).length === 0) return false;
    return true;
  };

  const totals = {
    sessions: inMonth.reduce((total, day) => total + running(day).filter((session) => !session.carried).length, 0),
    minutes: inMonth.reduce((total, day) => total + day.minutes, 0),
    backup: inMonth.reduce((total, day) => total + day.needsBackup, 0),
    empty: inMonth.filter((day) => running(day).length === 0 && !day.event).length,
    events: inMonth.filter((day) => day.event).length,
  };
  const hostTotals = hostId
    ? inMonth.reduce(
        (total, day) => {
          const own = byHost(day);
          return {
            sessions: total.sessions + own.filter((session) => !session.carried).length,
            minutes: total.minutes + own.reduce((sum, s) => sum + s.end - s.start, 0),
          };
        },
        { sessions: 0, minutes: 0 }
      )
    : null;
  const hostName = hosts.find((host) => host.host_id === hostId)?.host.user.name;

  const selected = days.find((day) => day.date === focusDate) ?? days[0];

  function move(event: KeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const next = addDays(focusDate, step);
    if (next < gridStart || next > addDays(gridStart, gridDays - 1)) return;
    setFocusDate(next);
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus());
  }

  function open(date: string) {
    setFocusDate(date);
    if (wide) setPanelOpen(true);
  }

  return (
    <div className="space-y-4">
      {/* The month at a glance; the last three filter the grid */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-xs sm:grid-cols-5 dark:shadow-none [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
        <Metric label="Sesi live" value={totals.sessions} />
        <Metric label="Jam live" value={compactHours(totals.minutes)} />
        <Metric
          label="Butuh backup"
          value={totals.backup}
          tone={totals.backup > 0 ? "danger" : undefined}
          active={focus === "backup"}
          onClick={() => setFocus(focus === "backup" ? null : "backup")}
        />
        <Metric
          label="Hari tanpa jadwal"
          value={totals.empty}
          tone={totals.empty > 0 ? "warning" : undefined}
          active={focus === "empty"}
          onClick={() => setFocus(focus === "empty" ? null : "empty")}
        />
        <Metric label="Hari event" value={totals.events} active={focus === "event"} onClick={() => setFocus(focus === "event" ? null : "event")} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect small wrapperClassName="w-48" value={hostId} onChange={(event) => setHostId(event.target.value)} aria-label="Sorot host">
            <option value="">Sorot host…</option>
            {hosts.map((host) => (
              <option key={host.host_id} value={host.host_id}>
                {host.host.user.name}
              </option>
            ))}
          </NativeSelect>
          {hostTotals && (
            <span className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{hostName}</span>: {hostTotals.sessions} sesi · {compactHours(hostTotals.minutes)}
            </span>
          )}
          {(focus || hostId) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setFocus(null);
                setHostId("");
              }}
              className="text-muted-foreground"
            >
              <X aria-hidden="true" />
              Hapus sorotan
            </Button>
          )}
        </div>
        <Legend />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-border shadow-xs dark:shadow-none" aria-busy={loading || undefined}>
        <div className="grid grid-cols-7 gap-px" aria-hidden="true">
          {DAYS.map((day) => (
            <div key={day.value} className="bg-muted/60 px-2 py-2 text-center text-xs font-medium text-muted-foreground md:text-left">
              {day.short}
            </div>
          ))}
        </div>
        <div
          ref={gridRef}
          role="grid"
          aria-label={`Jadwal ${formatMonth(month)}`}
          onKeyDown={move}
          className={cn("grid grid-cols-7 gap-px border-t border-border transition-opacity", loading && "opacity-60")}
        >
          {days.map((day) => (
            <DayCell
              key={day.date}
              day={day}
              hostId={hostId}
              dimmed={(focus !== null || hostId !== "") && !matches(day)}
              focused={day.date === focusDate}
              selected={!wide && day.date === focusDate}
              onOpen={() => open(day.date)}
            />
          ))}
        </div>
      </div>

      {/* Phones: the tapped day right under the month */}
      {!wide && selected && (
        <Card title={formatDayDate(selected.date)} description={daySummary(selected)}>
          <DayDetail day={selected} hostId={hostId} onOpenSlot={onOpenSlot} onAddSlot={onAddSlot} />
        </Card>
      )}

      {wide && panelOpen && selected && (
        <Dialog title={formatDayDate(selected.date)} description={daySummary(selected)} placement="side" size="md" onClose={() => setPanelOpen(false)}>
          <DayDetail day={selected} hostId={hostId} onOpenSlot={onOpenSlot} onAddSlot={onAddSlot} />
        </Dialog>
      )}
    </div>
  );
}

function daySummary(day: Day): string {
  const count = day.sessions.filter((session) => !session.replaced).length;
  if (day.event) return `Event ${day.event.name}`;
  return count === 0 ? "Belum ada jadwal" : `${count} sesi · ${compactHours(day.minutes)} live`;
}

function Metric({ label, value, tone, active, onClick }: { label: string; value: React.ReactNode; tone?: Tone; active?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "mt-0.5 block text-xl font-semibold tracking-tight tabular-nums",
          tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-foreground"
        )}
      >
        {value}
      </span>
    </>
  );

  if (!onClick) return <div className="bg-card px-4 py-3">{body}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={active ? "Tampilkan semua hari" : "Sorot hari-hari ini di kalender"}
      className={cn(
        "relative bg-card px-4 py-3 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/60",
        active && "bg-primary/[0.06] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary"
      )}
    >
      {body}
    </button>
  );
}

function Legend() {
  const shown: State[] = ["regular", "covered", "pending", "open", "replaced"];
  return (
    <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground" aria-label="Keterangan warna">
      {shown.map((state) => (
        <li key={state} className="flex items-center gap-1.5">
          <span className={cn("h-2 w-3.5 rounded-sm", states[state].fill)} aria-hidden="true" />
          {states[state].label}
        </li>
      ))}
    </ul>
  );
}

/** A day's 24 hours with each session drawn at its time; empty stretches stay grey. */
function CoverageBar({ day, hostId, large = false }: { day: Day; hostId?: string; large?: boolean }) {
  return (
    <div className={cn("relative w-full overflow-hidden rounded-full bg-muted", large ? "h-3" : "h-1.5")} aria-hidden="true">
      {day.sessions.map((session) => (
        <span
          key={session.key}
          className={cn("absolute inset-y-0", states[stateOf(session)].fill, hostId && session.slot.assignment.host_id !== hostId && "opacity-30")}
          style={{ left: `${(session.start / DAY_MINUTES) * 100}%`, width: `${((session.end - session.start) / DAY_MINUTES) * 100}%` }}
        />
      ))}
    </div>
  );
}

function DayCell({
  day,
  hostId,
  dimmed,
  focused,
  selected,
  onOpen,
}: {
  day: Day;
  hostId: string;
  dimmed: boolean;
  focused: boolean;
  selected: boolean;
  onOpen: () => void;
}) {
  const lines = day.sessions;
  const shown = lines.slice(0, CELL_LINES);
  const more = lines.length - shown.length;
  const label = [
    formatDayDate(day.date),
    day.event ? `event ${day.event.name}` : `${day.sessions.filter((s) => !s.replaced).length} sesi, ${compactHours(day.minutes)}`,
    day.needsBackup > 0 && `${day.needsBackup} butuh backup`,
  ]
    .filter(Boolean)
    .join(", ");

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
        "group relative flex min-h-16 flex-col gap-1 p-1.5 text-left transition-[background-color,opacity] outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:min-h-32 md:gap-1.5 md:p-2",
        day.inMonth ? "bg-card hover:bg-muted" : "bg-muted text-faint hover:bg-secondary",
        selected && "z-10 ring-2 ring-primary ring-inset",
        dimmed && "opacity-35"
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full text-xs font-medium tabular-nums",
            day.isToday
              ? "bg-primary font-semibold text-primary-foreground"
              : day.inMonth
                ? day.past
                  ? "text-muted-foreground"
                  : "text-foreground"
                : "text-faint"
          )}
        >
          {Number(day.date.slice(8))}
        </span>
        {day.minutes > 0 && <span className="hidden text-[11px] text-muted-foreground tabular-nums md:inline">{compactHours(day.minutes)}</span>}
      </div>

      <CoverageBar day={day} hostId={hostId} />

      {/* Phones: just markers under the bar */}
      <div className="flex gap-1 md:hidden" aria-hidden="true">
        {day.event && <span className="size-1.5 rounded-full bg-warning" />}
        {day.needsBackup > 0 && (
          <span
            className={cn(
              "size-1.5 rounded-full",
              day.sessions.some((session) => !session.replaced && session.marker?.status === "open") ? "bg-destructive" : "bg-warning"
            )}
          />
        )}
      </div>

      {day.event && (
        <span className="hidden items-center gap-1 truncate rounded bg-warning/12 px-1.5 py-0.5 text-[11px] font-medium text-warning md:flex">
          <Ticket className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{day.event.name}</span>
        </span>
      )}

      <ul className="hidden min-w-0 space-y-0.5 md:block">
        {shown.map((session) => {
          const state = stateOf(session);
          const needs = state === "open" || state === "pending";
          return (
            <li
              key={session.key}
              className={cn(
                "flex min-w-0 items-center gap-1 text-[11px] leading-4",
                state === "replaced" && "line-through opacity-50",
                hostId && session.slot.assignment.host_id !== hostId && "opacity-40"
              )}
            >
              <span className={cn("size-1.5 shrink-0 rounded-full", states[state].fill)} aria-hidden="true" />
              <span className="shrink-0 text-muted-foreground tabular-nums">{session.carried ? "00:00" : session.slot.start_time}</span>
              <span className={cn("truncate", needs ? (state === "open" ? "font-medium text-destructive" : "font-medium text-warning") : "text-body")}>
                {needs ? (state === "open" ? "Butuh backup" : "Backup ditinjau") : liveName(session).split(" ")[0]}
              </span>
            </li>
          );
        })}
        {more > 0 && <li className="text-[11px] font-medium text-muted-foreground">+{more} lainnya</li>}
      </ul>
    </button>
  );
}

/** Everything about one day: the coverage, its empty hours and each session with what's going on. */
function DayDetail({
  day,
  hostId,
  onOpenSlot,
  onAddSlot,
}: {
  day: Day;
  hostId: string;
  onOpenSlot: (slot: ScheduleSlot, date: string) => void;
  onAddSlot: (day: number, date: string) => void;
}) {
  const weekday = isoWeekday(new Date(`${day.date}T00:00`));
  const running = day.sessions.filter((session) => !session.replaced);
  const gaps = running.length > 0 ? gapsOf(day) : [];

  return (
    <div className="space-y-5">
      {day.event && (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3 text-sm text-warning">
          <Ticket className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-semibold">{day.event.name}</span>: jadwal reguler hari ini diganti blok event.
          </p>
        </div>
      )}

      {day.sessions.length > 0 && (
        <div className="space-y-1.5">
          <CoverageBar day={day} hostId={hostId} large />
          <div className="relative h-3.5 text-[10px] text-faint tabular-nums" aria-hidden="true">
            {[0, 6, 12, 18, 24].map((hour) => (
              <span
                key={hour}
                className={cn("absolute", hour === 0 ? "" : hour === 24 ? "-translate-x-full" : "-translate-x-1/2")}
                style={{ left: `${(hour / 24) * 100}%` }}
              >
                {String(hour).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {gaps.length > 0 ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs text-muted-foreground">
              <Clock className="size-3.5 shrink-0" aria-hidden="true" />
              Jam kosong:
              {gaps.map(([start, end]) => (
                <span key={start} className="rounded bg-muted px-1.5 py-0.5 font-medium text-body tabular-nums">
                  {timeLabel(start)}–{timeLabel(end)}
                </span>
              ))}
            </p>
          ) : (
            running.length > 0 && <p className="pt-1 text-xs font-medium text-success">Terisi 24 jam penuh</p>
          )}
        </div>
      )}

      {day.sessions.length === 0 ? (
        <EmptyState compact icon={CalendarX2} title="Belum ada jadwal di hari ini" />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {day.sessions.map((session) => {
            const state = stateOf(session);
            const host = session.slot.assignment.host?.user;
            return (
              <li key={session.key}>
                <button
                  type="button"
                  onClick={() => onOpenSlot(session.slot, session.date)}
                  className={cn(
                    "flex w-full items-center gap-3 bg-card px-3.5 py-3 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/60",
                    hostId && session.slot.assignment.host_id !== hostId && "opacity-50"
                  )}
                >
                  <span className={cn("h-10 w-1 shrink-0 rounded-full", states[state].fill)} aria-hidden="true" />
                  {host && <UserAvatar user={host} size="size-8 text-xs" />}
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm font-medium", state === "replaced" ? "text-muted-foreground line-through" : "text-foreground")}>
                      {liveName(session)}
                    </span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {session.slot.start_time}–{session.slot.end_time}
                      {session.carried && " · lanjutan dari kemarin"}
                      {!session.carried && session.slot.crosses_midnight && " · lewat tengah malam"}
                      {state === "covered" && host && ` · menggantikan ${host.name}`}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {state !== "regular" && state !== "pd" && (
                        <StatusBadge tone={states[state].tone} className="h-5 px-1.5 text-[11px]">
                          {state === "covered" || state === "open" || state === "pending" ? <ArrowLeftRight className="size-3" aria-hidden="true" /> : null}
                          {states[state].label}
                        </StatusBadge>
                      )}
                      {session.slot.slot_type === "pd" && (
                        <StatusBadge tone="warning" className="h-5 px-1.5 text-[11px]">
                          PD
                        </StatusBadge>
                      )}
                      {session.slot.is_locked && (
                        <StatusBadge tone="neutral" className="h-5 px-1.5 text-[11px]">
                          <Lock className="size-3" aria-hidden="true" />
                          Dikunci
                        </StatusBadge>
                      )}
                      {session.slot.effective_to && (
                        <StatusBadge tone="info" className="h-5 px-1.5 text-[11px]">
                          Sementara
                        </StatusBadge>
                      )}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Button type="button" variant="outline" className="w-full" onClick={() => onAddSlot(weekday, day.date)}>
        <Plus aria-hidden="true" />
        Tambah slot setiap {DAYS[weekday - 1].long}
      </Button>
    </div>
  );
}
