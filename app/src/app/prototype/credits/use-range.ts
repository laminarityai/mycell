"use client";

// PROTOTYPE, throwaway: variant E2's range lives in the URL (`?range=&from=&to=`), so it survives
// a reload and leaves `variant` and the toggles alone. The control and the page both read it.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { readRange, type DayRange } from "./range";

export function useRange(): {
  range: DayRange;
  update: (changes: Record<string, string | null>) => void;
} {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const range = readRange((name) => params.get(name));
  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [name, value] of Object.entries(changes)) {
      if (value === null) next.delete(name);
      else next.set(name, value);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }
  return { range, update };
}
