"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface ToggleOption<T extends string> {
  value: T;
  label: string;
}

interface ToggleGroupProps<T extends string> {
  options: readonly ToggleOption<T>[] | readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Accessible name for the group. */
  label?: string;
}

/**
 * A segmented control: exactly one option is active, and the white indicator
 * slides to it.
 */
export default function ToggleGroup<T extends string>({ options, value, onChange, className, label }: ToggleGroupProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  const items: ToggleOption<T>[] = options.map((option) =>
    Array.isArray(option) ? { value: option[0] as T, label: option[1] as string } : (option as ToggleOption<T>)
  );

  const measure = useCallback(() => {
    const active = containerRef.current?.querySelector<HTMLButtonElement>("[data-active='true']");
    if (active) setPill({ left: active.offsetLeft, width: active.offsetWidth });
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [value, measure]);

  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={label}
      className={cn("relative inline-flex max-w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1 [scrollbar-width:none]", className)}
    >
      {pill && (
        <span
          aria-hidden="true"
          className="absolute top-1 bottom-1 rounded-md bg-card shadow-xs ring-1 ring-foreground/5 transition-all duration-200 ease-out dark:bg-secondary"
          style={{ left: pill.left, width: pill.width }}
        />
      )}

      {items.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-active={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative z-10 h-8 shrink-0 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors duration-200 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
