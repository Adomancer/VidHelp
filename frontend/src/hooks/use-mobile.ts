import { useSyncExternalStore } from "react";

const MOBILE_BREAKPOINT = 768;
const LAPTOP_BREAKPOINT = 1024;

/** Whether a CSS media query matches, kept up to date. False while rendering on the server. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** Phones (below `md`). */
export function useIsMobile() {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
}

/** Tablets (`md` up to `lg`), where the sidebar starts as an icon rail. */
export function useIsTablet() {
  return useMediaQuery(`(min-width: ${MOBILE_BREAKPOINT}px) and (max-width: ${LAPTOP_BREAKPOINT - 1}px)`);
}
