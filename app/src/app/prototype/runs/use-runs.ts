// PROTOTYPE, throwaway: the Runs page's in-memory query, filters and keyset cursor, as the
// real page would keep them in its URL and pass to `listRuns(ctx, filters, page)`.
import { useMemo, useState } from "react";
import {
  NO_FILTERS,
  filterRuns,
  pageOf,
  visibleRuns,
  type Cursor,
  type RunFilters,
} from "./run-data";

export function useRuns(as: string, size: number, initial: Partial<RunFilters> = {}) {
  const all = useMemo(() => visibleRuns(as), [as]);
  const [filters, setFilters] = useState<RunFilters>({ ...NO_FILTERS, ...initial });
  const [cursor, setCursor] = useState<Cursor>(null);
  const matching = useMemo(() => filterRuns(all, filters), [all, filters]);
  const { page, newer, older } = pageOf(matching, cursor, size);
  return {
    all,
    filters,
    matching,
    page,
    newer,
    older,
    setFilter: (key: keyof RunFilters, value: string) => {
      setFilters((current) => ({ ...current, [key]: value }));
      setCursor(null);
    },
    clear: () => {
      setFilters(NO_FILTERS);
      setCursor(null);
    },
    go: setCursor,
  };
}
