"use client";

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

  const set = (nextH: number, nextM: number) =>
    onChange(Math.round(((Math.max(0, nextH) * 60 + Math.min(59, Math.max(0, nextM))) / 60) * 100) / 100);

  const input = compact
    ? "w-16 px-2 py-2 rounded-lg bg-surface-2 border border-stroke-strong text-heading text-sm"
    : "w-full px-3 py-2.5 rounded-xl bg-surface-2 border border-stroke-strong text-heading outline-none focus:ring-2 focus:ring-primary";

  return (
    <fieldset className="space-y-1">
      <legend className={compact ? "block text-xs text-muted" : "block text-sm font-medium text-body"}>{label}</legend>
      <div className="flex items-center gap-2">
        <input type="number" min={0} max={24} value={h} onChange={(event) => set(Number(event.target.value), m)} aria-label={`${label} jam`} className={input} />
        <span className="text-sm text-muted">jam</span>
        <input type="number" min={0} max={59} step={5} value={m} onChange={(event) => set(h, Number(event.target.value))} aria-label={`${label} menit`} className={input} />
        <span className="text-sm text-muted">menit</span>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </fieldset>
  );
}
