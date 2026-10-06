"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

interface DigitsFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "maxLength"> {
  label: string;
  name: string;
  defaultValue?: string | null;
  error?: string;
  maxLength?: number;
  /** Show a "12/16 digit" counter for numbers of a fixed length (e.g. NIK). */
  exactLength?: number;
}

const WARNING_MS = 3000;

/**
 * Labelled input for numbers like phone, NIK and bank account: only digits get in.
 * Typing or pasting a letter or symbol leaves the field as it was and says why.
 */
export default function DigitsField({ label, name, defaultValue, error, maxLength, exactLength, className = "", ...props }: DigitsFieldProps) {
  const limit = exactLength ?? maxLength;
  const initial = (defaultValue ?? "").replace(/\D/g, "").slice(0, limit);
  const [value, setValue] = useState(initial);
  const [warning, setWarning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // form.reset() doesn't reach controlled inputs: go back to the starting value with the form
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const reset = () => setValue(initial);
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [initial]);

  useEffect(() => () => clearTimeout(timer.current), []);

  /** Keep only the digits: a typed letter changes nothing, a pasted "0812-345" keeps its numbers. */
  function change(raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (digits !== raw) {
      setWarning(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setWarning(false), WARNING_MS);
    }
    setValue(digits.slice(0, limit));
  }

  const invalid = Boolean(error) || warning;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={name} className="block text-sm font-medium text-body">
          {label}
        </label>
        {exactLength && (
          <span className={`text-xs tabular-nums ${value.length === exactLength ? "text-success" : "text-faint"}`}>
            {value.length}/{exactLength} digit
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        id={name}
        name={name}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(event) => change(event.target.value)}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={warning ? `${name}-warning` : undefined}
        className={`w-full px-4 py-2.5 rounded-xl bg-surface-2 border text-heading tabular-nums placeholder-faint outline-none focus:ring-2 focus:ring-primary transition-colors ${
          invalid ? "border-red-400" : "border-stroke-strong"
        } ${className}`}
        {...props}
      />
      {warning && (
        <p id={`${name}-warning`} role="alert" className="flex items-center gap-1.5 text-sm text-warning">
          <span aria-hidden="true">⚠</span> {label} hanya boleh diisi angka (0–9).
        </p>
      )}
      {error && !warning && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
