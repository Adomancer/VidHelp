"use client";

import { useSyncExternalStore } from "react";

export type TableDensity = "comfortable" | "compact";

const STORAGE_KEY = "vidhelp.table.density";
const listeners = new Set<() => void>();
let fallbackDensity: TableDensity = "comfortable";

function readDensity(): TableDensity {
  try {
    return localStorage.getItem(STORAGE_KEY) === "compact" ? "compact" : "comfortable";
  } catch {
    return fallbackDensity;
  }
}

export function setTableDensity(next: TableDensity) {
  fallbackDensity = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage blocked: keep fallback for current session
  }
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Persisted row density preference ("comfortable" | "compact"). */
export function useTableDensity(): [TableDensity, (next: TableDensity) => void] {
  const density = useSyncExternalStore<TableDensity>(subscribe, readDensity, () => "comfortable");
  return [density, setTableDensity];
}
