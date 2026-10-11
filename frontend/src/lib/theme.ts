"use client";

import { useSyncExternalStore } from "react";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "vidhelp-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Runs in <head> before the first paint so a saved dark theme doesn't flash light.
 * Light is the default; the choice is per device (localStorage).
 */
export const themeInitScript = `try{var m=localStorage.getItem("${STORAGE_KEY}");if(m==="dark"||(m==="system"&&matchMedia("${DARK_QUERY}").matches))document.documentElement.classList.add("dark")}catch(e){}`;

function readMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "dark" || saved === "system" ? saved : "light";
  } catch {
    return "light";
  }
}

function apply(mode: ThemeMode) {
  const dark = mode === "dark" || (mode === "system" && matchMedia(DARK_QUERY).matches);
  document.documentElement.classList.toggle("dark", dark);
}

const listeners = new Set<() => void>();

export function setThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Storage blocked: the theme still switches for this visit
  }
  apply(mode);
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // "Sistem" follows the OS while the page is open
  const media = matchMedia(DARK_QUERY);
  const onSystemChange = () => {
    if (readMode() === "system") apply("system");
    onChange();
  };
  media.addEventListener("change", onSystemChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  return () => {
    listeners.delete(onChange);
    media.removeEventListener("change", onSystemChange);
    observer.disconnect();
  };
}

/** The saved choice: light, dark or system. */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, readMode, () => "light");
}

/** What is showing right now. */
export function useResolvedTheme(): "light" | "dark" {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
    () => "light"
  );
}
