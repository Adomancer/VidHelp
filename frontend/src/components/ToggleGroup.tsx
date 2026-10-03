"use client";

import { useRef, useLayoutEffect, useState, useCallback } from "react";

export interface ToggleOption<T extends string> {
  value: T;
  label: string;
}

interface ToggleGroupProps<T extends string> {
  options: readonly ToggleOption<T>[] | readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * A group of buttons where exactly one is active at a time.
 *
 * Features a sliding pill indicator that smoothly animates between the active
 * button on click. Matches the project's dark theme (slate-900 inactive,
 * purple-600 active) with smooth transitions.
 */
export default function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: ToggleGroupProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  // Normalise options into { value, label } objects
  const items: ToggleOption<T>[] = options.map((opt) =>
    Array.isArray(opt) ? { value: opt[0] as T, label: opt[1] as string } : (opt as ToggleOption<T>)
  );

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLButtonElement>("[data-active='true']");
    if (!active) return;
    setPill({
      left: active.offsetLeft,
      width: active.offsetWidth,
    });
  }, []);

  // Recalculate on value or items change (useLayoutEffect to avoid flash)
  useLayoutEffect(() => {
    measure();
  }, [value, measure]);

  // Also handle resize (responsive)
  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div
      ref={containerRef}
      className="relative inline-flex gap-1 rounded-xl bg-slate-900/80 border border-slate-800 p-1"
    >
      {/* Sliding pill indicator */}
      {pill && (
        <span
          aria-hidden="true"
          className="absolute top-1 bottom-1 rounded-lg bg-purple-600 shadow-lg shadow-purple-600/25 transition-all duration-300 ease-out"
          style={{ left: pill.left, width: pill.width }}
        />
      )}

      {items.map((option) => {
        const isActive = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            data-active={isActive}
            onClick={() => onChange(option.value)}
            className={`relative z-10 px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ${
              isActive
                ? "text-white"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
