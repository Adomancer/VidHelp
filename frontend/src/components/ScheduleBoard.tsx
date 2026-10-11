"use client";

import { useRef, useState, type ReactNode } from "react";
import { ArrowLeftRight, CalendarDays, ChevronLeft, ChevronRight, Clock, Lock, Plus, Ticket } from "lucide-react";
import { errorMessage, operatorApi, scheduleApi, type ReplacingEvent, type ScheduleSlot, type SlotBackupMarker } from "@/lib/api";
import { DAYS, formatShortDate, isoWeekday, previousDay, toDateInput } from "@/lib/format";
import { addDays, addMonths, dayLong, formatLongDate, formatMonth, formatWeekRange, inEffectOn, monthGrid, monthStart, weekStart } from "@/lib/schedule";
import { useApiData } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "./AuthProvider";
import BackupDialog from "./BackupDialog";
import FormAlert from "./FormAlert";
import ScheduleMonth from "./ScheduleMonth";
import SearchableSelect from "./SearchableSelect";
import SlotDetailDialog from "./SlotDetailDialog";
import SlotDialog from "./SlotDialog";
import StopSlotDialog from "./StopSlotDialog";
import { useToast, type ToastMessage } from "./Toast";
import ToggleGroup from "./ToggleGroup";

type OpenDialog =
  | { kind: "detail"; slot: ScheduleSlot; date: string }
  | { kind: "slot"; slot?: ScheduleSlot; day?: number; week?: string }
  | { kind: "backup"; slot: ScheduleSlot; date: string }
  | { kind: "stop"; slot: ScheduleSlot; week?: string }
  | null;

type View = "month" | "week";

const BRAND_KEY = "vidhelp.schedule.brand";
const VIEW_KEY = "vidhelp.schedule.view";

/** The view picked last time on this device; the month by default. */
function rememberedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "week" ? "week" : "month";
  } catch {
    return "month";
  }
}

/** The brand opened last time, if it's still one of `ids`. */
function rememberedBrand(ids: string[]): string | undefined {
  try {
    const id = localStorage.getItem(BRAND_KEY);
    return id && ids.includes(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

function rememberBrand(id: string) {
  try {
    localStorage.setItem(BRAND_KEY, id);
  } catch {
    // Private mode: the brand just isn't remembered
  }
}

/**
 * One brand's schedule as a month calendar (default) or a week board, Monday to Sunday.
 * Every change happens in a dialog over the board: open a slot to see it first, "+" to
 * add one. Operators and admins use it; only admins can lock (`isAdmin`).
 */
export default function ScheduleBoard({ isAdmin = false }: { isAdmin?: boolean }) {
  const { token } = useAuth();
  const today = toDateInput();
  const [chosenBrandId, setChosenBrandId] = useState("");
  const [view, setView] = useState<View>(rememberedView);
  const [week, setWeek] = useState(() => weekStart());
  const [month, setMonth] = useState(() => monthStart());
  const [mobileDay, setMobileDay] = useState(() => isoWeekday());
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const { show } = useToast();
  const pickerRef = useRef<HTMLInputElement>(null);
  const swipeFrom = useRef<number | null>(null);

  const brands = useApiData("brands", () => operatorApi.brands(token));
  const activeBrands = brands.data?.brands.filter((brand) => brand.status === "active") ?? [];
  const brandId =
    chosenBrandId || (activeBrands.length > 0 ? rememberedBrand(activeBrands.map((brand) => brand.id)) ?? activeBrands[0].id : "");

  // The week board loads 7 days; the month calendar every day its grid shows (5 or 6 weeks)
  const grid = monthGrid(month);
  const range = view === "week" ? { on: week, days: 7 } : { on: grid.start, days: grid.days };
  const board = useApiData(`${brandId}|${range.on}|${range.days}`, () =>
    brandId
      ? scheduleApi.list(token, { brand_id: brandId, ...range })
      : Promise.resolve({ slots: [], backups: [], replacing_events: [] })
  );
  const hosts = useApiData(brandId, () => (brandId ? scheduleApi.brandHosts(token, brandId) : Promise.resolve({ assignments: [] })));

  const slots = board.data?.slots ?? [];
  const backups = board.data?.backups ?? [];
  const events = board.data?.replacing_events ?? [];
  const isThisWeek = week === weekStart();

  const days = DAYS.map((day) => {
    const date = addDays(week, day.value - 1);
    const dayBefore = addDays(date, -1);
    return {
      ...day,
      date,
      event: eventOn(events, date),
      eventDayBefore: eventOn(events, dayBefore),
      slots: slots.filter((slot) => slot.day_of_week === day.value && inEffectOn(slot, date)),
      // Overnight slots from the night before, still running this morning
      carried: slots.filter((slot) => slot.crosses_midnight && slot.day_of_week === previousDay(day.value) && inEffectOn(slot, dayBefore)),
    };
  });

  const sessions = days.reduce((total, day) => total + (day.event ? 0 : day.slots.length), 0);
  const uncovered = backups.filter((marker) => marker.status !== "filled").length;

  function goToWeek(start: string) {
    setWeek(start);
    setMobileDay(start === weekStart() ? isoWeekday() : 1);
  }

  function switchView(next: View) {
    setView(next);
    // Keep looking at the same time: the week of the month's first day (or today), or that week's month
    if (next === "week") goToWeek(monthStart() === month ? weekStart() : weekStart(month));
    else setMonth(monthStart(week));
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Private mode: the view just isn't remembered
    }
  }

  const isThisMonth = month === monthStart();

  /** After a save: back to the board, refreshed, with a note that can take it back. */
  function saved(message: ToastMessage) {
    setDialog(null);
    board.reload();
    show({
      ...message,
      undo:
        message.undo &&
        (async () => {
          try {
            await message.undo!();
            show({ text: "Perubahan diurungkan" });
          } catch (caught) {
            show({ text: errorMessage(caught), tone: "error" });
          }
          board.reload();
        }),
    });
  }

  async function toggleLock(slot: ScheduleSlot, date: string) {
    try {
      const { slot: updated } = await scheduleApi.lock(token, slot.id, !slot.is_locked);
      setDialog({ kind: "detail", slot: updated, date });
      board.reload();
      show({
        text: updated.is_locked ? "Slot dikunci. Operator tidak bisa mengubahnya." : "Kunci slot dibuka",
        undo: async () => {
          await scheduleApi.lock(token, slot.id, slot.is_locked);
          setDialog((current) => (current?.kind === "detail" && current.slot.id === slot.id ? { ...current, slot } : current));
          show({ text: "Perubahan diurungkan" });
          board.reload();
        },
      });
    } catch (caught) {
      show({ text: errorMessage(caught), tone: "error" });
    }
  }

  if (brands.error) return <FormAlert tone="error">{brands.error}</FormAlert>;
  if (brands.data && activeBrands.length === 0) {
    return <FormAlert tone="warning">Belum ada brand yang aktif. Admin dapat membuatnya di halaman Brand.</FormAlert>;
  }

  return (
    <div className="space-y-4">
      {/* Brand, week, add */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-60">
          <SearchableSelect
            value={brandId}
            onChange={(value) => {
              setChosenBrandId(value);
              rememberBrand(value);
            }}
            options={activeBrands.map((brand) => ({ value: brand.id, label: brand.name }))}
            placeholder={brands.data ? "Pilih brand…" : "Memuat brand…"}
          />
        </div>

        <ToggleGroup
          label="Tampilan jadwal"
          options={[
            ["month", "Bulan"],
            ["week", "Minggu"],
          ] as const}
          value={view}
          onChange={switchView}
        />

        <div className="flex items-center gap-0.5 rounded-lg border border-input bg-card p-0.5 shadow-xs">
          <IconButton
            label={view === "week" ? "Minggu sebelumnya" : "Bulan sebelumnya"}
            onClick={() => (view === "week" ? goToWeek(addDays(week, -7)) : setMonth(addMonths(month, -1)))}
          >
            <ChevronLeft />
          </IconButton>
          <span className="min-w-36 px-2 text-center text-sm font-medium text-foreground tabular-nums capitalize sm:min-w-44">
            {view === "week" ? formatWeekRange(week) : formatMonth(month)}
          </span>
          <IconButton
            label={view === "week" ? "Minggu berikutnya" : "Bulan berikutnya"}
            onClick={() => (view === "week" ? goToWeek(addDays(week, 7)) : setMonth(addMonths(month, 1)))}
          >
            <ChevronRight />
          </IconButton>
          <span className="relative">
            <IconButton label="Pilih tanggal di kalender" onClick={() => openPicker(pickerRef.current)}>
              <CalendarDays />
            </IconButton>
            <input
              ref={pickerRef}
              type="date"
              tabIndex={-1}
              aria-hidden="true"
              value={view === "week" ? week : month}
              onChange={(event) => {
                if (!event.target.value) return;
                if (view === "week") goToWeek(weekStart(event.target.value));
                else setMonth(monthStart(event.target.value));
              }}
              className="pointer-events-none absolute inset-0 opacity-0"
            />
          </span>
        </div>

        {(view === "week" ? !isThisWeek : !isThisMonth) && (
          <Button
            type="button"
            variant="outline"
            onClick={() => (view === "week" ? goToWeek(weekStart()) : setMonth(monthStart()))}
            className="text-brand"
          >
            {view === "week" ? "Minggu ini" : "Bulan ini"}
          </Button>
        )}

        <Button type="button" onClick={() => setDialog({ kind: "slot", day: mobileDay })} disabled={!brandId} className="ml-auto">
          <Plus aria-hidden="true" />
          Tambah slot
        </Button>
      </div>

      {board.error && <FormAlert tone="error">{board.error}</FormAlert>}

      {view === "month" && (!brandId || (board.loading && slots.length === 0)) ? (
        // Nothing to count yet: no zeros that read like an empty month
        <div className="space-y-4" aria-busy="true" aria-label="Memuat jadwal">
          <Skeleton className="h-[74px] rounded-xl" />
          <Skeleton className="h-[34rem] rounded-xl" />
        </div>
      ) : view === "month" ? (
        <ScheduleMonth
          key={month}
          month={month}
          gridStart={grid.start}
          gridDays={grid.days}
          today={today}
          slots={slots}
          backups={backups}
          events={events}
          hosts={hosts.data?.assignments ?? []}
          loading={board.loading}
          onOpenSlot={(slot, date) => setDialog({ kind: "detail", slot, date })}
          onAddSlot={(day, date) => setDialog({ kind: "slot", day, week: weekStart(date) })}
        />
      ) : (
        <>
          {/* What needs attention this week */}
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{isThisWeek ? "Minggu ini" : "Minggu tersebut"}:</span>
            <span className="tabular-nums">{sessions} slot</span>
            {uncovered > 0 && <span className="font-medium text-warning">· {uncovered} belum ada host pengganti</span>}
            {events.length > 0 && <span className="font-medium text-warning">· {events.length} event</span>}
            {board.loading && <span className="text-faint">· memuat…</span>}
          </p>

          {/* Phones: one day at a time, tabs on top (swipe to move) */}
          <div className="lg:hidden grid grid-cols-7 gap-1" role="tablist" aria-label="Hari">
            {days.map((day) => (
              <button
                key={day.value}
                type="button"
                role="tab"
                aria-selected={mobileDay === day.value}
                onClick={() => setMobileDay(day.value)}
                className={cn(
                  "rounded-lg border px-0.5 py-1.5 text-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  mobileDay === day.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : day.date === today
                      ? "border-primary/50 bg-primary/5 text-brand"
                      : "border-border bg-card text-body"
                )}
              >
                <span className="block text-[11px]">{day.short}</span>
                <span className="block text-sm font-semibold tabular-nums">{Number(day.date.slice(8))}</span>
                <span
                  aria-hidden="true"
                  className={cn("mx-auto mt-0.5 block size-1 rounded-full", day.event ? "bg-warning" : day.slots.length > 0 ? "bg-current" : "bg-transparent")}
                />
              </button>
            ))}
          </div>

          <div
            className={`grid grid-cols-1 lg:grid-cols-7 gap-2 transition-opacity ${board.loading ? "opacity-60" : ""}`}
            onTouchStart={(event) => (swipeFrom.current = event.touches[0].clientX)}
            onTouchEnd={(event) => {
              if (swipeFrom.current === null) return;
              const moved = event.changedTouches[0].clientX - swipeFrom.current;
              swipeFrom.current = null;
              if (Math.abs(moved) > 60) setMobileDay((day) => Math.min(7, Math.max(1, day + (moved < 0 ? 1 : -1))));
            }}
          >
            {days.map((day) => {
              const isToday = day.date === today;
              const empty = day.slots.length === 0 && day.carried.length === 0;

              return (
                <section
                  key={day.value}
                  aria-label={`${day.long} ${formatLongDate(day.date)}`}
                  className={cn(
                    mobileDay === day.value ? "flex" : "hidden",
                    "min-h-40 flex-col gap-1.5 rounded-xl border p-2 shadow-xs lg:flex dark:shadow-none",
                    isToday ? "border-primary/50 bg-primary/[0.04] ring-1 ring-primary/15" : "border-border bg-card"
                  )}
                >
                  <header className="flex items-center justify-between gap-1 px-0.5">
                    <h3 className="text-sm font-semibold text-foreground">
                      <span className="lg:hidden">{day.long}</span>
                      <span className="hidden lg:inline">{day.short}</span>
                      <span className={cn("ml-1 text-xs font-normal", isToday ? "text-brand" : "text-muted-foreground")}>{formatShortDate(day.date)}</span>
                    </h3>
                    {isToday && <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground lg:hidden 2xl:inline">Hari ini</span>}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setDialog({ kind: "slot", day: day.value })}
                      aria-label={`Tambah slot hari ${day.long}`}
                      title={`Tambah slot hari ${day.long}`}
                      className="text-muted-foreground"
                    >
                      <Plus />
                    </Button>
                  </header>

                  {day.event && (
                    <div className="rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
                      <span className="flex items-center gap-1 font-semibold">
                        <Ticket className="size-3 shrink-0" aria-hidden="true" />
                        {day.event.name}
                      </span>
                      <span className="block opacity-80">Slot reguler diganti blok event</span>
                    </div>
                  )}

                  {day.carried.map((slot) => (
                    <button
                      key={`carry-${slot.id}`}
                      type="button"
                      onClick={() => setDialog({ kind: "detail", slot, date: addDays(day.date, -1) })}
                      className={cn(
                        "w-full rounded-lg border border-dashed border-input px-2 py-1.5 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                        day.eventDayBefore && "opacity-40"
                      )}
                    >
                      <span className="block text-[11px] text-muted-foreground">
                        Lanjutan dari {dayLong(slot.day_of_week)}, {slot.start_time}
                      </span>
                      <span className="block text-xs text-body truncate">
                        s.d. {slot.end_time} · {coverName(slot, backups, addDays(day.date, -1))}
                      </span>
                    </button>
                  ))}

                  {day.slots.map((slot) => (
                    <SlotCard
                      key={slot.id}
                      slot={slot}
                      backup={markerOn(backups, slot.id, day.date)}
                      replaced={Boolean(day.event)}
                      onOpen={() => setDialog({ kind: "detail", slot, date: day.date })}
                    />
                  ))}

                  {empty && !day.event && (
                    <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border px-2 py-4 text-center">
                      <p className="text-xs text-muted-foreground">Belum ada jadwal</p>
                      <button
                        type="button"
                        onClick={() => setDialog({ kind: "slot", day: day.value })}
                        className="inline-flex items-center gap-1 rounded text-xs font-medium text-brand outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <Plus className="size-3" aria-hidden="true" />
                        Tambah slot
                      </button>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}

      {dialog?.kind === "detail" && (
        <SlotDetailDialog
          key={dialog.slot.id}
          slot={dialog.slot}
          date={dialog.date}
          backup={markerOn(backups, dialog.slot.id, dialog.date)}
          isAdmin={isAdmin}
          onClose={() => setDialog(null)}
          onEdit={() => setDialog({ kind: "slot", slot: dialog.slot, week: weekStart(dialog.date) })}
          onBackup={() => setDialog({ kind: "backup", slot: dialog.slot, date: dialog.date })}
          onStop={() => setDialog({ kind: "stop", slot: dialog.slot, week: weekStart(dialog.date) })}
          onToggleLock={() => toggleLock(dialog.slot, dialog.date)}
        />
      )}
      {dialog?.kind === "slot" && hosts.data && (
        <SlotDialog
          hosts={hosts.data.assignments}
          slot={dialog.slot}
          day={dialog.day}
          week={dialog.week ?? week}
          isAdmin={isAdmin}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {dialog?.kind === "backup" && (
        <BackupDialog slot={dialog.slot} date={dialog.date} markers={backups} onClose={() => setDialog(null)} onSaved={saved} />
      )}
      {dialog?.kind === "stop" && <StopSlotDialog slot={dialog.slot} week={dialog.week ?? week} onClose={() => setDialog(null)} onSaved={saved} />}

    </div>
  );
}

function SlotCard({ slot, backup, replaced, onOpen }: { slot: ScheduleSlot; backup?: SlotBackupMarker; replaced: boolean; onOpen: () => void }) {
  const pd = slot.slot_type === "pd";
  const hostName = slot.assignment.host?.user.name ?? "Host";
  const covered = backup?.status === "filled";

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "w-full rounded-md border-l-[3px] px-2 py-1.5 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        pd ? "border-warning bg-warning/10 hover:bg-warning/15" : "border-primary bg-primary/[0.07] hover:bg-primary/[0.12]",
        replaced && "opacity-45"
      )}
    >
      <span className="flex items-start justify-between gap-1">
        <span className={cn("text-xs font-semibold tabular-nums", pd ? "text-warning" : "text-brand")}>
          {slot.start_time}–{slot.end_time}
          {slot.crosses_midnight && <span className="text-[10px] text-muted-foreground"> +1</span>}
        </span>
        <span className="flex items-center gap-0.5 text-muted-foreground">
          {slot.is_locked && (
            <Hint text="Dikunci oleh admin">
              <Lock className="size-3" />
            </Hint>
          )}
          {slot.effective_to && (
            <Hint text={`Sementara, sampai ${formatShortDate(slot.effective_to)}`}>
              <Clock className="size-3" />
            </Hint>
          )}
          {backup && (
            <Hint
              text={
                covered
                  ? `Backup: ${backup.filler_name} menggantikan ${hostName}`
                  : backup.status === "pending"
                    ? "Ada pelamar backup, menunggu persetujuan"
                    : "Butuh backup, belum ada host pengganti"
              }
            >
              <ArrowLeftRight className={cn("size-3", covered ? "text-success" : "text-warning")} />
            </Hint>
          )}
        </span>
      </span>
      <span className={cn("block truncate text-sm font-medium", covered ? "text-success" : "text-foreground")}>{covered ? backup.filler_name : hostName}</span>
      <span className="flex items-center justify-between gap-1 text-[10px]">
        <span className={pd ? "font-medium text-warning" : "text-muted-foreground"}>{pd ? "PD" : "Reguler"}</span>
        {covered && <span className="truncate text-muted-foreground">ganti {hostName}</span>}
      </span>
      {replaced && <span className="block text-[10px] text-warning">Diganti blok event</span>}
    </button>
  );
}

/** A small icon with a tooltip on hover (and its text for screen readers). */
function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex" aria-label={text} role="img">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{text}</TooltipContent>
    </Tooltip>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" onClick={onClick} aria-label={label} title={label} className="text-body">
      {children}
    </Button>
  );
}

function openPicker(input: HTMLInputElement | null) {
  if (!input) return;
  try {
    input.showPicker();
  } catch {
    input.focus();
  }
}

function eventOn(events: ReplacingEvent[], date: string) {
  return events.find((event) => event.start_date <= date && event.end_date >= date);
}

function markerOn(markers: SlotBackupMarker[], slotId: string, date: string) {
  return markers.find((marker) => marker.slot_id === slotId && marker.backup_date === date);
}

/** Who's live in the slot's session on a date: the cover if there is one. */
function coverName(slot: ScheduleSlot, markers: SlotBackupMarker[], date: string) {
  const marker = markerOn(markers, slot.id, date);
  return marker?.status === "filled" ? `${marker.filler_name} (backup)` : (slot.assignment.host?.user.name ?? "Host");
}

