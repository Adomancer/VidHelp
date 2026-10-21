"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface ToggleOption<T extends string> {
  value: T;
  /** Text, or text with a count badge */
  label: React.ReactNode;
}

interface ToggleGroupProps<T extends string> {
  options: readonly ToggleOption<T>[] | readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Accessible name for the group. */
  label?: string;
  /** On phones, stretch to the full width and share it evenly instead of scrolling sideways. */
  fill?: boolean;
  /** On phones, lay the options out two per row (for labels too long to share one row). */
  grid?: boolean;
}

/**
 * A segmented control: exactly one option is active, and the white indicator
 * slides to it.
 */
export default function ToggleGroup<T extends string>({ options, value, onChange, className, label, fill, grid }: ToggleGroupProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const items: ToggleOption<T>[] = options.map((option) =>
    Array.isArray(option) ? { value: option[0] as T, label: option[1] as string } : (option as ToggleOption<T>)
  );

  const measure = useCallback(() => {
    const container = containerRef.current;
    const active = container?.querySelector<HTMLButtonElement>("[data-active='true']");
    if (!container || !active) return;
    setPill({ left: active.offsetLeft, top: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight });
    // When the row still scrolls sideways, keep the active option in view (scrollIntoView would also move the page)
    if (active.offsetLeft < container.scrollLeft) container.scrollLeft = active.offsetLeft - 4;
    else if (active.offsetLeft + active.offsetWidth > container.scrollLeft + container.clientWidth)
      container.scrollLeft = active.offsetLeft + active.offsetWidth - container.clientWidth + 4;
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
      className={cn(
        "relative inline-flex max-w-full [scrollbar-width:none] gap-1 overflow-x-auto rounded-lg bg-muted p-1",
        fill && "flex w-full gap-0.5 sm:inline-flex sm:w-auto sm:gap-1",
        grid && "grid w-full grid-cols-2 sm:inline-flex sm:w-auto",
        className
      )}
    >
      {pill && (
        <span
          aria-hidden="true"
          className="absolute rounded-md bg-card shadow-xs ring-1 ring-foreground/5 transition-all duration-200 ease-out dark:bg-secondary"
          style={{ left: pill.left, top: pill.top, width: pill.width, height: pill.height }}
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
              fill && "min-w-0 flex-1 px-2 sm:flex-none sm:px-3",
              grid && "min-w-0 px-2 sm:px-3",
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

/** A shorter label on phones, where the full ones can't share one row; screen readers always get the full one. */
export function ShortLabel({ short, full }: { short: string; full: string }) {
  return (
    <>
      <span aria-hidden="true" className="sm:hidden">
        {short}
      </span>
      <span className="sr-only sm:not-sr-only">{full}</span>
    </>
  );
}
