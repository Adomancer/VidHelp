"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { errorMessage, fieldErrors, scheduleApi, type BrandHost, type ScheduleSlot, type SlotConflict, type SlotInput } from "@/lib/api";
import { DAYS, isoWeekday, nextDay, previousDay, toDateInput } from "@/lib/format";
import {
  addDays,
  dayLong,
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
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "./AuthProvider";
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

/**
 * Add or edit a weekly slot, top to bottom: who, which day and hours, for how long,
 * which type. Clashes are checked while filling in; save stays off until they're fixed.
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
    day: slot?.day_of_week ?? day ?? isoWeekday(),
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
        day_of_week: form.day,
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
  const hostSlots = useApiData(`host-${hostId}-${date}`, () =>
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
      day_of_week: form.day,
      start_time: start,
      end_time: end,
      slot_type: form.slotType,
      effective_to: until,
    };
    const weekly = describeWeekly(form.day, start, end);

    try {
      if (!slot) {
        const { slot: created } = await scheduleApi.create(token, { ...input, effective_from: form.from });
        onSaved({ text: `Slot disimpan, berlaku ${weekly}`, undo: () => scheduleApi.undo(token, created.id) });
      } else {
        const result = await scheduleApi.update(token, slot.id, asksWhen ? { ...input, apply_from: startsOn } : { ...input, effective_from: form.from });
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
        <p className="text-sm text-gray-300">Belum ada host di brand ini. Tugaskan host di halaman Hosts terlebih dahulu.</p>
      </Dialog>
    );
  }

  const hostOptions = hosts.map((option) => ({ value: option.id, label: option.host.user.name }));
  if (slot && !assignment) hostOptions.unshift({ value: slot.assignment_id, label: hostName });

  const blocked = Boolean(conflicts && conflicts.length > 0);
  const hint = start && end && start !== end ? durationMinutes(start, end) : null;

  return (
    <Dialog
      title={readOnly ? "Detail slot" : slot ? "Edit slot" : "Tambah slot"}
      description={slot ? `${hostName} · ${describeWeekly(slot.day_of_week, slot.start_time, slot.end_time)}` : undefined}
      onClose={onClose}
      dirty={dirty && !saving}
      size="lg"
      footer={
        readOnly ? (
          <CloseButton onClick={onClose} />
        ) : (
          <>
            <span className="flex-1 text-xs text-gray-500">
              {checking ? "Memeriksa bentrok…" : blocked ? "Perbaiki bentrok dulu untuk menyimpan." : !complete ? "Lengkapi host dan jam." : ""}
            </span>
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:bg-slate-800">
              Batal
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!complete || checking || blocked || saving}
              className="px-5 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? "Menyimpan…" : "Simpan"}
            </button>
          </>
        )
      }
    >
      <fieldset disabled={readOnly || saving} className="space-y-6">
        {readOnly && <FormAlert tone="warning">Dikunci oleh Admin. Hubungi Admin untuk mengubah.</FormAlert>}
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
            <div className="mt-3 rounded-xl bg-slate-950/50 border border-slate-800 p-3 space-y-2">
              <p className="text-xs text-gray-400">
                Jadwal {hostName} di semua brand, {formatDayDate(date)}
                {hostSlots.loading && " · memuat…"}
              </p>
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
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Hari">
            {DAYS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={form.day === option.value}
                onClick={() => set("day", option.value)}
                className={`min-w-12 px-2.5 py-1.5 rounded-lg text-sm border transition-colors ${
                  form.day === option.value
                    ? "bg-purple-600 border-purple-500 text-white"
                    : "border-slate-700 text-gray-300 hover:bg-slate-800"
                }`}
              >
                {option.short}
              </button>
            ))}
          </div>
          <FieldError message={errors.day_of_week} />

          <div className="mt-3 grid grid-cols-2 gap-3 max-w-sm">
            <TimeInput label="Mulai" value={form.start} onChange={(value) => set("start", value)} error={problems.start ?? errors.start_time} />
            <TimeInput label="Selesai" value={form.end} onChange={(value) => set("end", value)} error={problems.end ?? errors.end_time} />
          </div>
          {hint !== null && start && end && (
            <p className={`mt-2 text-sm ${toMinutes(end) < toMinutes(start) ? "text-sky-200" : "text-gray-400"}`}>
              {toMinutes(end) < toMinutes(start)
                ? `🌙 Berakhir esok hari (${dayLong(nextDay(form.day))}) pukul ${end} · ${formatMinutes(hint)}`
                : `Durasi ${formatMinutes(hint)}`}
            </p>
          )}
          {conflicts && conflicts.length > 0 && (
            <div role="alert" className="mt-3 rounded-xl border border-red-400/50 bg-red-500/10 px-4 py-3 text-sm text-red-100 space-y-1">
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
                Mulai minggu ini dan seterusnya <span className="text-gray-400">({formatDayDate(thisWeek)})</span>
              </Choice>
              <Choice checked={form.applyMode === "date"} onSelect={() => set("applyMode", "date")}>
                <span className="flex flex-wrap items-center gap-2">
                  Mulai tanggal tertentu
                  {form.applyMode === "date" && (
                    <DateInput value={form.applyDate} min={today} onChange={(value) => set("applyDate", value)} label="Berlaku mulai" />
                  )}
                </span>
              </Choice>
              <p className="text-xs text-gray-500">Jadwal sebelum tanggal ini tidak berubah, jadi riwayat dan payroll tetap utuh.</p>
            </div>
          ) : (
            <label className="flex flex-wrap items-center gap-2 text-sm text-gray-300">
              Mulai
              <DateInput value={form.from} min={slot ? undefined : today} onChange={(value) => set("from", value)} label="Mulai" />
            </label>
          )}
          <FieldError message={problems.startsOn ?? errors.apply_from ?? errors.effective_from} />

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Choice checked={!form.temporary} onSelect={() => set("temporary", false)}>
              Setiap minggu
              <span className="block text-xs text-gray-400">Tanpa batas akhir</span>
            </Choice>
            <Choice checked={form.temporary} onSelect={() => set("temporary", true)}>
              Hanya sementara
              <span className="mt-1 flex items-center gap-2 text-xs text-gray-400">
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
          <div className="rounded-xl border border-purple-400/30 bg-purple-500/10 px-4 py-3 text-sm text-purple-50">
            {describePlan({ hostName, day: form.day, start, end, from: startsOn, until })}
          </div>
        )}
      </fieldset>
    </Dialog>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-white">
        <span className="w-5 h-5 rounded-full bg-slate-800 text-[11px] text-gray-300 flex items-center justify-center">{number}</span>
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
      className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 text-sm cursor-pointer transition-colors ${
        checked ? "border-purple-500 bg-purple-500/10 text-white" : "border-slate-700 text-gray-300 hover:bg-slate-800/60"
      }`}
    >
      <span className={`mt-0.5 w-4 h-4 shrink-0 rounded-full border-2 ${checked ? "border-purple-400 bg-purple-400 shadow-[inset_0_0_0_2px_rgb(15_23_42)]" : "border-slate-500"}`} />
      <span className="flex-1">{children}</span>
    </div>
  );
}

function TimeInput({ label, value, onChange, error }: { label: string; value: string; onChange: (value: string) => void; error?: string | null }) {
  const listId = useId();
  return (
    <label className="space-y-1">
      <span className="block text-xs text-gray-400">{label}</span>
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
        className={`w-full px-3 py-2 rounded-lg bg-slate-950/60 border text-white tabular-nums outline-none focus:ring-2 focus:ring-purple-500 ${
          error ? "border-red-400" : "border-slate-700"
        }`}
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
    <input
      type="date"
      value={value}
      min={min}
      aria-label={label}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => event.target.value && onChange(event.target.value)}
      className="px-2 py-1 rounded-md bg-slate-950/60 border border-slate-700 text-sm text-white [color-scheme:dark]"
    />
  );
}

function FieldError({ message }: { message?: string | null }) {
  return message ? <p className="mt-1 text-xs text-red-300">{message}</p> : null;
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ml-auto px-4 py-2 rounded-lg text-sm text-gray-300 hover:bg-slate-800">
      Tutup
    </button>
  );
}
