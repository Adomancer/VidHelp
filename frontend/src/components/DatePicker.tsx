"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { Matcher } from "react-day-picker";
import { id as indonesian } from "react-day-picker/locale";
import { toDateInput } from "@/lib/format";
import { inputClass } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** "2026-10-11" → that day at local midnight (`new Date("2026-10-11")` is UTC and can land a day off). */
export function parseDateInput(value: string | null | undefined): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : undefined;
}

interface DatePickerProps {
  /** "YYYY-MM-DD". Set it (with `onChange`) to control the field; otherwise use `defaultValue`. */
  value?: string;
  defaultValue?: string | null;
  onChange?: (value: string) => void;
  /** Sends the picked day with the form as "YYYY-MM-DD", like a native date input. */
  name?: string;
  /** Earliest and latest day that can be picked, "YYYY-MM-DD". */
  min?: string;
  max?: string;
  id?: string;
  placeholder?: string;
  /** Adds "Kosongkan" under the calendar, for optional fields and filters. */
  clearable?: boolean;
  /** Month and year dropdowns, for days far back (e.g. a join date). */
  captionLayout?: "label" | "dropdown";
  disabled?: boolean;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-label"?: string;
}

/** A date field that opens a calendar (Indonesian, weeks from Monday). Works in forms through a hidden input. */
export default function DatePicker({
  value,
  defaultValue,
  onChange,
  name,
  min,
  max,
  id,
  placeholder = "Pilih tanggal",
  clearable = false,
  captionLayout = "label",
  disabled = false,
  className,
  "aria-label": label,
  ...aria
}: DatePickerProps) {
  const initial = defaultValue ?? "";
  const [inner, setInner] = useState(initial);
  const [open, setOpen] = useState(false);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const current = value ?? inner;
  const date = parseDateInput(current);
  const minDate = parseDateInput(min);
  const maxDate = parseDateInput(max);

  // form.reset() doesn't reach the hidden input: go back to the starting value with the form
  useEffect(() => {
    const form = hiddenRef.current?.form;
    if (!form || value !== undefined) return;
    const reset = () => setInner(initial);
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [initial, value]);

  function pick(next: string) {
    setInner(next);
    onChange?.(next);
    setOpen(false);
  }

  const shown = date ? date.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : placeholder;
  const outOfRange: Matcher[] = [];
  if (minDate) outOfRange.push({ before: minDate });
  if (maxDate) outOfRange.push({ after: maxDate });

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            disabled={disabled}
            className={cn(inputClass, "flex items-center gap-2 text-left tabular-nums", !date && "text-muted-foreground", className)}
            // A label alone would hide the picked day from screen readers
            aria-label={label && `${label}, ${shown}`}
            {...aria}
          >
            <span className="min-w-0 flex-1 truncate">{shown}</span>
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            required
            selected={date}
            onSelect={(day) => pick(toDateInput(day))}
            defaultMonth={date ?? maxDate ?? minDate}
            disabled={outOfRange}
            locale={indonesian}
            weekStartsOn={1}
            captionLayout={captionLayout}
            startMonth={captionLayout === "dropdown" ? (minDate ?? new Date(new Date().getFullYear() - 30, 0)) : undefined}
            endMonth={captionLayout === "dropdown" ? (maxDate ?? new Date(new Date().getFullYear() + 5, 11)) : undefined}
            autoFocus
          />
          {clearable && current && (
            <div className="border-t border-border p-2">
              <Button type="button" variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => pick("")}>
                Kosongkan
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      {name && <input ref={hiddenRef} type="hidden" name={name} value={current} />}
    </>
  );
}

const monthNames = Array.from({ length: 12 }, (_, index) => new Date(2000, index, 1).toLocaleDateString("id-ID", { month: "short" }));

interface MonthPickerProps {
  /** "YYYY-MM" */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  className?: string;
  "aria-label"?: string;
}

/** A month field: year arrows over a grid of twelve months. Unlike `<input type="month">`, it works in every browser. */
export function MonthPicker({ value, onChange, min, max, className, "aria-label": label }: MonthPickerProps) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(value.slice(0, 4)));
  const shown = new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, 1);
  const shownText = shown.toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setYear(shown.getFullYear());
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(inputClass, "flex w-auto items-center gap-2 text-left tabular-nums", className)}
          aria-label={label && `${label}, ${shownText}`}
        >
          <span className="flex-1">{shownText}</span>
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setYear(year - 1)}
            disabled={Boolean(min) && `${year - 1}-12` < min!}
            aria-label="Tahun sebelumnya"
          >
            <ChevronLeft />
          </Button>
          <span className="text-sm font-medium tabular-nums">{year}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setYear(year + 1)}
            disabled={Boolean(max) && `${year + 1}-01` > max!}
            aria-label="Tahun berikutnya"
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {monthNames.map((label, index) => {
            const month = `${year}-${String(index + 1).padStart(2, "0")}`;
            return (
              <Button
                key={month}
                type="button"
                size="sm"
                variant={month === value ? "default" : "ghost"}
                disabled={(Boolean(min) && month < min!) || (Boolean(max) && month > max!)}
                aria-pressed={month === value}
                onClick={() => {
                  onChange(month);
                  setOpen(false);
                }}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
