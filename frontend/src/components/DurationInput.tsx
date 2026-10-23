"use client";

import { inputClass, inputSmClass } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { FieldError } from "./FieldMessage";

interface DurationInputProps {
  label: string;
  /** Duration in hours (the API unit); edited as hours + minutes. */
  hours: number;
  onChange: (hours: number) => void;
  error?: string;
  compact?: boolean;
}

/** Hours + minutes fields for a duration, so nobody has to type 0.33. */
export default function DurationInput({ label, hours, onChange, error, compact = false }: DurationInputProps) {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;

  const set = (nextH: number, nextM: number) => onChange(Math.round(((Math.max(0, nextH) * 60 + Math.min(59, Math.max(0, nextM))) / 60) * 100) / 100);

  const input = compact ? cn(inputSmClass, "w-16 tabular-nums") : cn(inputClass, "tabular-nums");

  return (
    <fieldset className="space-y-1.5">
      <legend className={compact ? "mb-1 block text-xs text-muted-foreground" : "mb-1.5 block text-sm font-medium text-foreground"}>{label}</legend>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={24}
          value={h}
          onChange={(event) => set(Number(event.target.value), m)}
          aria-label={`${label} jam`}
          className={input}
        />
        <span className="text-sm text-muted-foreground">jam</span>
        <input
          type="number"
          min={0}
          max={59}
          step={5}
          value={m}
          onChange={(event) => set(h, Number(event.target.value))}
          aria-label={`${label} menit`}
          className={input}
        />
        <span className="text-sm text-muted-foreground">menit</span>
      </div>
      <FieldError>{error}</FieldError>
    </fieldset>
  );
}
