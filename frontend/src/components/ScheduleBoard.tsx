"use client";

import { useRef, useState, type ReactNode } from "react";
import { errorMessage, operatorApi, scheduleApi, type ReplacingEvent, type ScheduleSlot, type SlotBackupMarker } from "@/lib/api";
import { DAYS, formatShortDate, isoWeekday, previousDay, toDateInput } from "@/lib/format";
import { addDays, dayLong, formatLongDate, formatWeekRange, inEffectOn, weekStart } from "@/lib/schedule";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "./AuthProvider";
import BackupDialog from "./BackupDialog";
import FormAlert from "./FormAlert";
import SearchableSelect from "./SearchableSelect";
import SlotDetailDialog from "./SlotDetailDialog";
import SlotDialog from "./SlotDialog";
import StopSlotDialog from "./StopSlotDialog";
import Toast, { useToast, type ToastMessage } from "./Toast";

type OpenDialog =
  | { kind: "detail"; slot: ScheduleSlot; date: string }
  | { kind: "slot"; slot?: ScheduleSlot; day?: number }
  | { kind: "backup"; slot: ScheduleSlot; date: string }
  | { kind: "stop"; slot: ScheduleSlot }
  | null;

const BRAND_KEY = "vidhelp.schedule.brand";

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
 * One brand's week, Monday to Sunday. Every change happens in a dialog over the board:
 * click a slot to see it first, "+" to add one. Operators and admins use it; only
 * admins can lock (`isAdmin`).
 */
export default function ScheduleBoard({ isAdmin = false }: { isAdmin?: boolean }) {
  const { token } = useAuth();
  const today = toDateInput();
  const [chosenBrandId, setChosenBrandId] = useState("");
  const [week, setWeek] = useState(() => weekStart());
  const [mobileDay, setMobileDay] = useState(() => isoWeekday());
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const { toast, show, dismiss } = useToast();
  const pickerRef = useRef<HTMLInputElement>(null);
  const swipeFrom = useRef<number | null>(null);

  const brands = useApiData("brands", () => operatorApi.brands(token));
  const activeBrands = brands.data?.brands.filter((brand) => brand.status === "active") ?? [];
  const brandId =
    chosenBrandId || (activeBrands.length > 0 ? rememberedBrand(activeBrands.map((brand) => brand.id)) ?? activeBrands[0].id : "");

  const board = useApiData(`${brandId}|${week}`, () =>
    brandId
      ? scheduleApi.list(token, { brand_id: brandId, on: week, days: 7 })
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
    return <FormAlert tone="warning">Belum ada brand yang aktif. Admin dapat membuatnya di halaman Brands.</FormAlert>;
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

        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
          <IconButton label="Minggu sebelumnya" onClick={() => goToWeek(addDays(week, -7))}>
            ‹
          </IconButton>
          <span className="px-2 min-w-44 text-center text-sm font-medium text-white tabular-nums">{formatWeekRange(week)}</span>
          <IconButton label="Minggu berikutnya" onClick={() => goToWeek(addDays(week, 7))}>
            ›
          </IconButton>
          <span className="relative">
            <IconButton label="Pilih tanggal di kalender" onClick={() => openPicker(pickerRef.current)}>
              <CalendarIcon />
            </IconButton>
            <input
              ref={pickerRef}
              type="date"
              tabIndex={-1}
              aria-hidden="true"
              value={week}
              onChange={(event) => event.target.value && goToWeek(weekStart(event.target.value))}
              className="absolute inset-0 opacity-0 pointer-events-none [color-scheme:dark]"
            />
          </span>
        </div>

        {!isThisWeek && (
          <button
            type="button"
            onClick={() => goToWeek(weekStart())}
            className="px-3 py-2 rounded-lg text-sm text-purple-300 border border-purple-500/40 hover:bg-purple-500/10"
          >
            Minggu ini
          </button>
        )}

        <button
          type="button"
          onClick={() => setDialog({ kind: "slot", day: mobileDay })}
          disabled={!brandId}
          className="ml-auto px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-500 disabled:opacity-50"
        >
          + Tambah slot
        </button>
      </div>

      {/* What needs attention this week */}
      <p className="text-sm text-gray-400">
        <span className="text-gray-300">{isThisWeek ? "Minggu ini" : "Minggu tersebut"}:</span> {sessions} slot
        {uncovered > 0 && <span className="text-amber-300"> · {uncovered} belum ada host pengganti</span>}
        {events.length > 0 && <span className="text-yellow-200"> · {events.length} event</span>}
        {board.loading && <span className="text-gray-500"> · memuat…</span>}
      </p>

      {board.error && <FormAlert tone="error">{board.error}</FormAlert>}

      {/* Phones: one day at a time, tabs on top (swipe to move) */}
      <div className="lg:hidden grid grid-cols-7 gap-1" role="tablist" aria-label="Hari">
        {days.map((day) => (
          <button
            key={day.value}
            type="button"
            role="tab"
            aria-selected={mobileDay === day.value}
            onClick={() => setMobileDay(day.value)}
            className={`rounded-lg px-0.5 py-1.5 text-center border ${
              mobileDay === day.value
                ? "bg-purple-600 border-purple-500 text-white"
                : day.date === today
                  ? "border-purple-500/60 text-purple-200"
                  : "border-slate-800 text-gray-300"
            }`}
          >
            <span className="block text-xs">{day.short}</span>
            <span className="block text-sm font-medium tabular-nums">{Number(day.date.slice(8))}</span>
            <span
              aria-hidden="true"
              className={`mx-auto mt-0.5 block w-1 h-1 rounded-full ${day.event ? "bg-yellow-300" : day.slots.length > 0 ? "bg-current" : "bg-transparent"}`}
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
              className={`${mobileDay === day.value ? "flex" : "hidden"} lg:flex flex-col gap-1.5 min-h-40 rounded-xl border p-2 ${
                isToday ? "border-purple-500 bg-purple-500/5" : "border-slate-800 bg-slate-900"
              }`}
            >
              <header className="flex items-center justify-between gap-1 px-0.5">
                <h3 className="text-sm font-medium text-white">
                  <span className="lg:hidden">{day.long}</span>
                  <span className="hidden lg:inline">{day.short}</span>
                  <span className={`ml-1 text-xs font-normal ${isToday ? "text-purple-300" : "text-gray-500"}`}>{formatShortDate(day.date)}</span>
                </h3>
                {isToday && <span className="lg:hidden xl:inline text-[10px] rounded bg-purple-600 px-1.5 py-0.5 text-white">Hari ini</span>}
                <button
                  type="button"
                  onClick={() => setDialog({ kind: "slot", day: day.value })}
                  aria-label={`Tambah slot hari ${day.long}`}
                  title={`Tambah slot hari ${day.long}`}
                  className="w-6 h-6 shrink-0 rounded-md text-gray-400 hover:bg-slate-800 hover:text-white"
                >
                  +
                </button>
              </header>

              {day.event && (
                <div className="rounded-md bg-yellow-400/15 border border-yellow-400/30 px-2 py-1 text-[11px] text-yellow-100">
                  <span className="font-medium">★ {day.event.name}</span>
                  <span className="block text-yellow-200/70">Slot reguler diganti blok event</span>
                </div>
              )}

              {day.carried.map((slot) => (
                <button
                  key={`carry-${slot.id}`}
                  type="button"
                  onClick={() => setDialog({ kind: "detail", slot, date: addDays(day.date, -1) })}
                  className={`w-full text-left rounded-lg border border-dashed border-slate-600 hover:bg-slate-800 px-2 py-1.5 ${
                    day.eventDayBefore ? "opacity-40" : ""
                  }`}
                >
                  <span className="block text-[11px] text-gray-400">
                    Lanjutan dari {dayLong(slot.day_of_week)}, {slot.start_time}
                  </span>
                  <span className="block text-xs text-gray-300 truncate">
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
                <div className="flex-1 flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-800 px-2 py-4 text-center">
                  <p className="text-xs text-gray-500">Belum ada jadwal.</p>
                  <button
                    type="button"
                    onClick={() => setDialog({ kind: "slot", day: day.value })}
                    className="text-xs text-purple-300 hover:text-white"
                  >
                    Tambah slot
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {dialog?.kind === "detail" && (
        <SlotDetailDialog
          key={dialog.slot.id}
          slot={dialog.slot}
          date={dialog.date}
          backup={markerOn(backups, dialog.slot.id, dialog.date)}
          isAdmin={isAdmin}
          onClose={() => setDialog(null)}
          onEdit={() => setDialog({ kind: "slot", slot: dialog.slot })}
          onBackup={() => setDialog({ kind: "backup", slot: dialog.slot, date: dialog.date })}
          onStop={() => setDialog({ kind: "stop", slot: dialog.slot })}
          onToggleLock={() => toggleLock(dialog.slot, dialog.date)}
        />
      )}
      {dialog?.kind === "slot" && hosts.data && (
        <SlotDialog
          hosts={hosts.data.assignments}
          slot={dialog.slot}
          day={dialog.day}
          week={week}
          isAdmin={isAdmin}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {dialog?.kind === "backup" && (
        <BackupDialog slot={dialog.slot} date={dialog.date} markers={backups} onClose={() => setDialog(null)} onSaved={saved} />
      )}
      {dialog?.kind === "stop" && <StopSlotDialog slot={dialog.slot} week={week} onClose={() => setDialog(null)} onSaved={saved} />}

      <Toast toast={toast} onDismiss={dismiss} />
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
      className={`w-full text-left rounded-lg border-l-[3px] px-2 py-1.5 transition-colors ${
        pd ? "border-amber-400 bg-amber-500/10 hover:bg-amber-500/20" : "border-purple-400 bg-purple-500/10 hover:bg-purple-500/20"
      } ${replaced ? "opacity-45" : ""}`}
    >
      <span className="flex items-start justify-between gap-1">
        <span className={`text-xs font-medium tabular-nums ${pd ? "text-amber-100" : "text-purple-100"}`}>
          {slot.start_time}–{slot.end_time}
          {slot.crosses_midnight && <span className="text-[10px] text-gray-400"> +1</span>}
        </span>
        <span className="flex items-center gap-0.5 text-gray-400">
          {slot.is_locked && (
            <Hint text="Dikunci oleh Admin">
              <LockIcon />
            </Hint>
          )}
          {slot.effective_to && (
            <Hint text={`Sementara, sampai ${formatShortDate(slot.effective_to)}`}>
              <ClockIcon />
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
              <SwapIcon className={covered ? "text-green-300" : "text-amber-300"} />
            </Hint>
          )}
        </span>
      </span>
      <span className={`block text-sm truncate ${covered ? "text-green-200" : "text-white"}`}>{covered ? backup.filler_name : hostName}</span>
      <span className="flex items-center justify-between gap-1 text-[10px]">
        <span className={pd ? "text-amber-300/80" : "text-purple-300/70"}>{pd ? "PD" : "Reguler"}</span>
        {covered && <span className="text-gray-500 truncate">ganti {hostName}</span>}
      </span>
      {replaced && <span className="block text-[10px] text-yellow-200/80">Diganti blok event</span>}
    </button>
  );
}

/** A small icon with a tooltip on hover (and its text for screen readers). */
function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="group/hint relative inline-flex" aria-label={text} role="img">
      {children}
      <span className="pointer-events-none absolute right-0 top-full z-20 mt-1 hidden whitespace-nowrap rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-gray-100 shadow-lg group-hover/hint:block">
        {text}
      </span>
    </span>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="w-8 h-8 flex items-center justify-center rounded-md text-lg text-gray-300 hover:bg-slate-800 hover:text-white"
    >
      {children}
    </button>
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

const iconProps = { width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function LockIcon() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function SwapIcon({ className }: { className: string }) {
  return (
    <svg {...iconProps} className={className} aria-hidden="true">
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg {...iconProps} width={16} height={16} aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
