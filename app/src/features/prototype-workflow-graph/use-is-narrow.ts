"use client";

// PROTOTYPE, never merge.
import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 767px)";

export function useIsNarrow(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(QUERY);
      media.addEventListener("change", onChange);
      return () => {
        media.removeEventListener("change", onChange);
      };
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
