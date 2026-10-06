"use client";

import { useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";

interface RupiahInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "name"> {
  /** The form field; it carries the plain number ("15000"). */
  name: string;
  defaultValue?: number | string | null;
}

const thousands = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

/** "15000" → "15.000" */
function withDots(digits: string): string {
  return digits === "" ? "" : thousands.format(Number(digits));
}

/**
 * A money amount typed with "Rp" in the box and dots between thousands ("Rp 15.000"),
 * so nobody counts zeros. Only digits are taken.
 */
export default function RupiahInput({ name, defaultValue, className = "", ...props }: RupiahInputProps) {
  const start = defaultValue === null || defaultValue === undefined || defaultValue === "" ? "" : String(Math.round(Number(defaultValue)));
  const [digits, setDigits] = useState(start);
  const inputRef = useRef<HTMLInputElement>(null);
  // Where the caret goes after the dots move: after this many digits
  const caretAfterDigits = useRef<number | null>(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const wanted = caretAfterDigits.current;
    if (!input || wanted === null) return;
    caretAfterDigits.current = null;

    let position = 0;
    for (let seen = 0; position < input.value.length && seen < wanted; position++) {
      if (/\d/.test(input.value[position])) seen++;
    }
    input.setSelectionRange(position, position);
  }, [digits]);

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">Rp</span>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={withDots(digits)}
        onChange={(event) => {
          const { value, selectionStart } = event.target;
          caretAfterDigits.current = value.slice(0, selectionStart ?? value.length).replace(/\D/g, "").length;
          // Drop leading zeros so "0" then "5" reads "5", not "05"
          setDigits(value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 12));
        }}
        className={`pl-10 tabular-nums ${className}`}
        {...props}
      />
      <input type="hidden" name={name} value={digits} />
    </div>
  );
}
