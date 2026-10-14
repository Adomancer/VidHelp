"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Moon } from "lucide-react";
import { errorMessage, fieldErrors, scheduleApi, type BrandHost, type ScheduleSlot, type SlotConflict, type SlotInput } from "@/lib/api";
import { DAYS, isoWeekday, nextDay, previousDay, toDateInput } from "@/lib/format";
import {
  addDays,
  dayLong,
  describeDays,
  describePlan,
  describeWeekly,
  durationMinutes,
  formatDayDate,
  formatLongDate,
  formatMinutes,
  fromMinutes,
  HALF_HOURS,
  inEffectOn,
  laterDate,
  normalizeTime,
  toMinutes,
} from "@/lib/schedule";
import { inputClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "./AuthProvider";
import Chip from "./Chip";
import DatePicker from "./DatePicker";
import Dialog from "./Dialog";
import FormAlert from "./FormAlert";
import HostDayTimeline, { type DayBlock } from "./HostDayTimeline";
import SearchableSelect from "./SearchableSelect";
import type { ToastMessage } from "./Toast";
import ToggleGroup from "./ToggleGroup";

interface SlotDialogProps {
  hosts: BrandHost[];
  /** Editing this slot; omit to add one. */
  slot?: ScheduleSlot;
  /** Prefilled day when adding from a day column. */
  day?: number;
  /** Monday of the week open on the board. */
  week: string;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (message: ToastMessage) => void;
}

/** A slot's own fields, to put it back as it was. */
function slotFields(slot: ScheduleSlot): SlotInput {
  const { assignment_id, day_of_week, start_time, end_time, slot_type, effective_from, effective_to } = slot;
  return { assignment_id, day_of_week, start_time, end_time, slot_type, effective_from, effective_to };
}

/** The first date on or after `from` that falls on `day`. */
function firstOn(day: number, from: string): string {
  return addDays(from, (day - isoWeekday(new Date(`${from}T00:00`)) + 7) % 7);
}

const EVERY_DAY = DAYS.map((option) => option.value);

/**
 * Add or edit a weekly slot, top to bottom: who, which day and hours, for how long,
 * which type. A new slot can go on several days at once (e.g. every day): one slot per day.
 * Clashes are checked while filling in; save stays off until they're fixed.
 */
export default function SlotDialog({ hosts, slot, day, week, isAdmin, onClose, onSaved }: SlotDialogProps) {
  const { token } = useAuth();
  const today = toDateInput();
  const thisWeek = laterDate(week, today);
  const readOnly = Boolean(slot?.is_locked && !isAdmin);
  // A slot that already ran: changes start from a later date, so earlier weeks (and payroll) keep theirs
  const asksWhen = Boolean(slot && slot.effective_from < thisWeek);

  const initial = {
    assignmentId: slot?.assignment_id ?? (hosts.length === 1 ? hosts[0].id : ""),
    /** The day the host's timeline shows; one of `days`. */
    day: slot?.day_of_week ?? day ?? isoWeekday(),
    days: [slot?.day_of_week ?? day ?? isoWeekday()] as number[],
    start: slot?.start_time ?? "",
    end: slot?.end_time ?? "",
    slotType: slot?.slot_type ?? "regular",
    from: slot?.effective_from ?? thisWeek,
    temporary: Boolean(slot?.effective_to),
    until: slot?.effective_to ?? addDays(thisWeek, 27),
    applyMode: "week" as "week" | "date",
    applyDate: thisWeek,
  };
  const [form, setForm] = useState(initial);
  const set = <K extends keyof typeof initial>(key: K, value: (typeof initial)[K]) =>
    !readOnly && setForm((current) => ({ ...current, [key]: value }));

  /** Adding: days toggle on and off (at least one stays). Editing: one day, as before. */
  function toggleDay(value: number) {
    if (readOnly) return;
    setForm((current) => {
      if (slot) return { ...current, day: value, days: [value] };
      if (!current.days.includes(value)) return { ...current, day: value, days: [...current.days, value].sort((a, b) => a - b) };
      if (current.days.length === 1) return current;
      const days = current.days.filter((other) => other !== value);
      return { ...current, days, day: current.day === value ? days[0] : current.day };
    });
  }
  const everyDay = form.days.length === EVERY_DAY.length;
  const toggleEveryDay = () => !readOnly && setForm((current) => ({ ...current, days: everyDay ? [current.day] : EVERY_DAY }));

  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const start = normalizeTime(form.start);
  const end = normalizeTime(form.end);
  const startsOn = asksWhen ? (form.applyMode === "week" ? thisWeek : form.applyDate) : form.from;
  const until = form.temporary ? form.until : null;

  const assignment = hosts.find((option) => option.id === form.assignmentId);
  const hostName = assignment?.host.user.name ?? slot?.assignment.host?.user.name ?? "Host";

  const problems = {
    start: form.start && !start ? "Tulis jam seperti 19:00." : null,
    end: form.end && !end ? "Tulis jam seperti 23:00." : start && end && start === end ? "Jam selesai harus berbeda dari jam mulai." : null,
    startsOn: startsOn < today && (asksWhen || !slot) ? "Tanggal mulai tidak boleh sebelum hari ini." : null,
    until: until && until < startsOn ? "Tanggal akhir harus sama atau setelah tanggal mulai." : null,
  };
  const complete = Boolean(form.assignmentId && start && end) && !Object.values(problems).some(Boolean);

  // Live clash check, a moment after the last change
  const checkParams = complete
    ? {
        assignment_id: form.assignmentId,
        ...(slot ? { day_of_week: form.day } : { days_of_week: form.days }),
        start_time: start!,
        end_time: end!,
        effective_from: startsOn,
        effective_to: until,
        ignore_id: slot?.id,
      }
    : null;
  const checkKey = checkParams && JSON.stringify(checkParams);
  const [check, setCheck] = useState<{ key: string; conflicts: SlotConflict[] } | null>(null);

  useEffect(() => {
    if (!checkKey || readOnly) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      scheduleApi
        .conflicts(token, JSON.parse(checkKey))
        .then((result) => !cancelled && setCheck({ key: checkKey, conflicts: result.conflicts }))
        .catch(() => !cancelled && setCheck({ key: checkKey, conflicts: [] }));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [checkKey, readOnly, token]);

  const conflicts = check && check.key === checkKey ? check.conflicts : null;
  const checking = Boolean(checkKey) && conflicts === null && !readOnly;

  // The host's day: what they already do (any brand) on the first date this slot runs
  const date = firstOn(form.day, startsOn);
  const hostId = assignment?.host_id;
  const hostSlots = useApiData(`host-slots-${hostId}-${date}`, () =>
    hostId ? scheduleApi.list(token, { host_id: hostId, on: addDays(date, -1), days: 2 }) : Promise.resolve(null)
  );
  const busy: DayBlock[] = (hostSlots.data?.slots ?? [])
    .filter((other) => other.id !== slot?.id)
    .flatMap((other) => {
      const label = `${other.assignment.brand.name} · ${other.start_time}–${other.end_time}`;
      const blocks: DayBlock[] = [];
      if (other.day_of_week === form.day && inEffectOn(other, date)) {
        blocks.push({ start: toMinutes(other.start_time), end: other.crosses_midnight ? 1440 : toMinutes(other.end_time), label });
      }
      if (other.crosses_midnight && other.day_of_week === previousDay(form.day) && inEffectOn(other, addDays(date, -1))) {
        blocks.push({ start: 0, end: toMinutes(other.end_time), label });
      }
      return blocks;
    });
  const available: DayBlock[] = (assignment?.host.availability ?? []).flatMap((range) => {
    const from = toMinutes(range.available_from.slice(0, 5));
    const to = toMinutes(range.available_to.slice(0, 5));
    const label = `${range.available_from.slice(0, 5)}–${range.available_to.slice(0, 5)}`;
    if (range.day_of_week === form.day) return [{ start: from, end: to > from ? to : 1440, label }];
    if (range.day_of_week === previousDay(form.day) && to <= from && to > 0) return [{ start: 0, end: to, label }];
    return [];
  });

  /** Clicked a free part of the day: start there (on the half hour), as long as before or 2 hours, up to the next busy block. */
  function pickFree(minute: number) {
    const from = Math.floor(minute / 30) * 30;
    const length = start && end ? durationMinutes(start, end) : 120;
    const nextBusy = Math.min(1440, ...busy.filter((block) => block.start > from).map((block) => block.start));
    const to = Math.min(from + length, nextBusy);
    if (to - from < 30) return;
    setForm((current) => ({ ...current, start: fromMinutes(from), end: fromMinutes(to) }));
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  async function save() {
    if (!complete || !start || !end) return;
    setSaving(true);
    setErrors({});
    setError(null);

    const input = {
      assignment_id: form.assignmentId,
      start_time: start,
      end_time: end,
      slot_type: form.slotType,
      effective_to: until,
    };
    const weekly = describeDays(form.days, start, end);

    try {
      if (!slot) {
        const { slots } = await scheduleApi.create(token, { ...input, days_of_week: form.days, effective_from: form.from });
        onSaved({
          text: `${slots.length > 1 ? `${slots.length} slot` : "Slot"} disimpan, berlaku ${weekly}`,
          undo: () => Promise.all(slots.map((created) => scheduleApi.undo(token, created.id))),
        });
      } else {
        const changes = { ...input, day_of_week: form.day };
        const result = await scheduleApi.update(token, slot.id, asksWhen ? { ...changes, apply_from: startsOn } : { ...changes, effective_from: form.from });
        onSaved({
          text: asksWhen ? `Perubahan disimpan, berlaku mulai ${formatLongDate(startsOn)}` : `Slot disimpan, berlaku ${weekly}`,
          // A continued slot is taken back as a whole; an in-place edit gets its old values back
          undo: result.previous ? () => scheduleApi.undo(token, result.slot.id) : () => scheduleApi.update(token, slot.id, slotFields(slot)),
        });
      }
    } catch (caught) {
      const fields = fieldErrors(caught);
      setErrors(fields);
      if (Object.keys(fields).length === 0) setError(errorMessage(caught));
      setSaving(false);
    }
  }

  if (hosts.length === 0 && !slot) {
    return (
      <Dialog title="Tambah slot" onClose={onClose} footer={<CloseButton onClick={onClose} />}>
        <p className="text-sm text-body">Belum ada host di brand ini. Tugaskan host di halaman Host terlebih dahulu.</p>
      </Dialog>
    );
  }

  const hostOptions = hosts.map((option) => ({ value: option.id, label: option.host.user.name }));
  if (slot && !assignment) hostOptions.unshift({ value: slot.assignment_id, label: hostName });

  const blocked = Boolean(conflicts && conflicts.length > 0);
  const hint = start && end && start !== end ? durationMinutes(start, end) : null;

  return (
    <Dialog
      title={readOnly ? "Detail slot" : slot ? "Ubah slot" : "Tambah slot"}
      description={slot ? `${hostName} · ${describeWeekly(slot.day_of_week, slot.start_time, slot.end_time)}` : undefined}
      onClose={onClose}
      dirty={dirty && !saving}
      size="lg"
      footer={
        readOnly ? (
          <CloseButton onClick={onClose} />
        ) : (
          <>
            <span className={cn("mr-auto text-xs", blocked ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
              {checking ? "Memeriksa bentrok…" : blocked ? "Perbaiki bentrok dulu untuk menyimpan." : !complete ? "Lengkapi host dan jam." : ""}
            </span>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="button" onClick={save} disabled={!complete || checking || blocked || saving}>
              {saving ? "Menyimpan…" : "Simpan"}
            </Button>
          </>
        )
      }
    >
      <fieldset disabled={readOnly || saving} className="space-y-6">
        {readOnly && <FormAlert tone="warning">Dikunci oleh admin. Hubungi admin untuk mengubah.</FormAlert>}
        {error && <FormAlert tone="error">{error}</FormAlert>}

        <Step number={1} title="Siapa yang live?">
          <SearchableSelect
            value={form.assignmentId}
            onChange={(value) => set("assignmentId", value)}
            options={hostOptions}
            placeholder="Pilih host…"
            disabled={readOnly}
          />
          <FieldError message={errors.assignment_id} />
          {assignment && (
            <div className="mt-3 space-y-2 rounded-xl border border-border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">
                Jadwal {hostName} di semua brand, {formatDayDate(date)}
                {hostSlots.loading && " · memuat…"}
              </p>
              {form.days.length > 1 && (
                <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Lihat hari">
                  {form.days.map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={form.day === value}
                      onClick={() => setForm((current) => ({ ...current, day: value }))}
                      className={cn(
                        "rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
                        form.day === value ? "bg-primary/10 text-brand" : "text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {DAYS[value - 1].short}
                    </button>
                  ))}
                </div>
              )}
              <HostDayTimeline
                busy={busy}
                available={available}
                selection={start && end ? { start: toMinutes(start), end: toMinutes(start) + durationMinutes(start, end) } : null}
                onPick={pickFree}
                disabled={readOnly}
              />
            </div>
          )}
        </Step>

        <Step number={2} title="Hari dan jam">
          {slot ? (
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Hari">
              {DAYS.map((option) => (
                <Chip
                  key={option.value}
                  role="radio"
                  aria-checked={form.day === option.value}
                  aria-pressed={undefined}
                  selected={form.day === option.value}
                  onClick={() => toggleDay(option.value)}
                  className="min-w-12 justify-center"
                >
                  {option.short}
                </Chip>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Hari">
              <Chip selected={everyDay} onClick={toggleEveryDay}>
                Setiap hari
              </Chip>
              {DAYS.map((option) => (
                <Chip key={option.value} selected={form.days.includes(option.value)} onClick={() => toggleDay(option.value)} className="min-w-12 justify-center">
                  {option.short}
                </Chip>
              ))}
            </div>
          )}
          {!slot && <p className="mt-1.5 text-xs text-muted-foreground">Pilih satu hari atau lebih; tiap hari jadi slot sendiri dengan jam yang sama.</p>}
          <FieldError message={errors.day_of_week ?? errors.days_of_week} />

          <div className="mt-3 grid grid-cols-2 gap-3 max-w-sm">
            <TimeInput label="Mulai" value={form.start} onChange={(value) => set("start", value)} error={problems.start ?? errors.start_time} />
            <TimeInput label="Selesai" value={form.end} onChange={(value) => set("end", value)} error={problems.end ?? errors.end_time} />
          </div>
          {hint !== null && start && end && (
            <p className={cn("mt-2 flex items-center gap-1.5 text-sm", toMinutes(end) < toMinutes(start) ? "text-info" : "text-muted-foreground")}>
              {toMinutes(end) < toMinutes(start) && <Moon className="size-3.5 shrink-0" aria-hidden="true" />}
              {toMinutes(end) < toMinutes(start)
                ? `Berakhir esok hari${form.days.length === 1 ? ` (${dayLong(nextDay(form.day))})` : ""} pukul ${end} · ${formatMinutes(hint)}`
                : `Durasi ${formatMinutes(hint)}`}
            </p>
          )}
          {conflicts && conflicts.length > 0 && (
            <div role="alert" className="mt-3 space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <p className="font-medium">Bentrok dengan jadwal lain:</p>
              <ul className="list-disc pl-5 space-y-0.5">
                {conflicts.map((conflict) => (
                  <li key={conflict.id}>
                    {conflict.same_host
                      ? `${hostName} sudah live di ${conflict.brand_name}`
                      : `${conflict.host_name} sudah live di brand ini`}
                    , {describeWeekly(conflict.day_of_week, conflict.start_time, conflict.end_time)}.
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Step>

        <Step number={3} title={asksWhen ? "Perubahan ini berlaku mulai kapan?" : "Berapa lama jadwal ini berlaku?"}>
          {asksWhen ? (
            <div className="space-y-2">
              <Choice checked={form.applyMode === "week"} onSelect={() => set("applyMode", "week")}>
                Mulai minggu ini dan seterusnya <span className="text-muted-foreground">({formatDayDate(thisWeek)})</span>
              </Choice>
              <Choice checked={form.applyMode === "date"} onSelect={() => set("applyMode", "date")}>
                <span className="flex flex-wrap items-center gap-2">
                  Mulai tanggal tertentu
                  {form.applyMode === "date" && (
                    <DateInput value={form.applyDate} min={today} onChange={(value) => set("applyDate", value)} label="Berlaku mulai" />
                  )}
                </span>
              </Choice>
              <p className="text-xs text-muted-foreground">Jadwal sebelum tanggal ini tidak berubah, jadi riwayat dan payroll tetap utuh.</p>
            </div>
          ) : (
            <label className="flex flex-wrap items-center gap-2 text-sm text-body">
              Mulai
              <DateInput value={form.from} min={slot ? undefined : today} onChange={(value) => set("from", value)} label="Mulai" />
            </label>
          )}
          <FieldError message={problems.startsOn ?? errors.apply_from ?? errors.effective_from} />

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Choice checked={!form.temporary} onSelect={() => set("temporary", false)}>
              Setiap minggu
              <span className="block text-xs text-muted-foreground">Tanpa batas akhir</span>
            </Choice>
            <Choice checked={form.temporary} onSelect={() => set("temporary", true)}>
              Hanya sementara
              <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                sampai
                <DateInput
                  value={form.until}
                  min={startsOn}
                  onChange={(value) => {
                    setForm((current) => ({ ...current, temporary: true, until: value }));
                  }}
                  label="Sampai tanggal"
                />
              </span>
            </Choice>
          </div>
          <FieldError message={problems.until ?? errors.effective_to} />
        </Step>

        <Step number={4} title="Tipe slot">
          <ToggleGroup
            options={[
              { value: "regular", label: "Reguler" },
              { value: "pd", label: "PD" },
            ]}
            value={form.slotType}
            onChange={(value) => set("slotType", value)}
          />
        </Step>

        {complete && start && end && !readOnly && (
          <div className="rounded-lg border border-primary/30 bg-primary/[0.06] px-4 py-3 text-sm text-body">
            {describePlan({ hostName, days: form.days, start, end, from: startsOn, until })}
          </div>
        )}
      </fieldset>
    </Dialog>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-brand tabular-nums">{number}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** A radio-like card. */
function Choice({ checked, onSelect, children }: { checked: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <div
      role="radio"
      aria-checked={checked}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => (event.key === " " || event.key === "Enter") && event.target === event.currentTarget && onSelect()}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        checked ? "border-primary bg-primary/[0.06] text-foreground" : "border-input text-body hover:bg-muted/60"
      )}
    >
      <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2", checked ? "border-primary" : "border-input")} aria-hidden="true">
        {checked && <span className="size-1.5 rounded-full bg-primary" />}
      </span>
      <span className="flex-1">{children}</span>
    </div>
  );
}

function TimeInput({ label, value, onChange, error }: { label: string; value: string; onChange: (value: string) => void; error?: string | null }) {
  const listId = useId();
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          const time = normalizeTime(value);
          if (time) onChange(time);
        }}
        list={listId}
        inputMode="numeric"
        placeholder="19:00"
        aria-invalid={error ? true : undefined}
        className={cn(inputClass, "tabular-nums")}
      />
      <datalist id={listId}>
        {HALF_HOURS.map((time) => (
          <option key={time} value={time} />
        ))}
      </datalist>
      <FieldError message={error} />
    </label>
  );
}

function DateInput({ value, min, onChange, label }: { value: string; min?: string; onChange: (value: string) => void; label: string }) {
  return (
    // Clicks stay here (the calendar's too: React events bubble out of its portal), not on the option around it
    <span onClick={(event) => event.stopPropagation()}>
      <DatePicker value={value} min={min} onChange={onChange} aria-label={label} className="h-9 w-auto px-2.5 text-sm md:h-8" />
    </span>
  );
}

function FieldError({ message }: { message?: string | null }) {
  return message ? <p className="mt-1 text-xs text-destructive">{message}</p> : null;
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="outline" onClick={onClick}>
      Tutup
    </Button>
  );
}
