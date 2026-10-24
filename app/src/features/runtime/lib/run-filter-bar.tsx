// The Runs page's filter bar and paging. Filters and the page live in the address, so the bar is
// a plain GET form and paging plain links.
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { RunFilterOptions, RunFilters, RunPage, RunStatus } from "../types";
import { inboxLabel, RUN_STATUS_LABELS } from "./runs-table";

/** The status filter's choices, in the order the spec lists them. */
const FILTER_STATUSES = Object.keys(RUN_STATUS_LABELS) as RunStatus[];

/** Whether any filter is set. */
export function isFiltered(filters: RunFilters): boolean {
  return [filters.workflowId, filters.status, filters.connectionId].some(
    (value) => value !== undefined,
  );
}

/** The Runs page's address for these filters and, optionally, a page. */
export function runsHref(filters: RunFilters, page: { older?: string; newer?: string } = {}) {
  const query = new URLSearchParams();
  if (filters.workflowId !== undefined) query.set("workflow", filters.workflowId);
  if (filters.status !== undefined) query.set("status", filters.status);
  if (filters.connectionId !== undefined) query.set("connection", filters.connectionId);
  if (page.older !== undefined) query.set("older", page.older);
  if (page.newer !== undefined) query.set("newer", page.newer);
  const text = query.toString();
  return text === "" ? "/runs" : `/runs?${text}`;
}

/**
 * The filters, as a GET form so they stay in the address. The inbox filter is for admins, who
 * see more than their own.
 */
export function RunFilterBar({
  filters,
  options,
  showInbox,
}: {
  filters: RunFilters;
  options: RunFilterOptions;
  showInbox: boolean;
}) {
  const filtered = isFiltered(filters);
  return (
    <form
      method="get"
      action="/runs"
      aria-label="Filter runs"
      className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3"
    >
      <Filter
        name="workflow"
        label="Workflow"
        value={filters.workflowId}
        any="All workflows"
        options={options.workflows.map((workflow) => ({ id: workflow.id, label: workflow.name }))}
      />
      <Filter
        name="status"
        label="Status"
        value={filters.status}
        any="Any status"
        options={FILTER_STATUSES.map((status) => ({
          id: status,
          label: RUN_STATUS_LABELS[status],
        }))}
      />
      {showInbox ? (
        <Filter
          name="connection"
          label="Inbox"
          value={filters.connectionId}
          any="Every inbox"
          options={options.connections.map((connection) => ({
            id: connection.id,
            label: inboxLabel(connection.inbox),
          }))}
        />
      ) : null}
      <Button type="submit" size="sm">
        Filter
      </Button>
      {filtered ? (
        <Button asChild variant="ghost" size="sm">
          <Link href="/runs">Clear filters</Link>
        </Button>
      ) : null}
    </form>
  );
}

function Filter({
  name,
  label,
  value,
  any,
  options,
}: {
  name: string;
  label: string;
  value: string | undefined;
  any: string;
  options: { id: string; label: string }[];
}) {
  const id = `runs-filter-${name}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {/* Keyed by its value, so following a link resets it to the address's choice. */}
      <NativeSelect key={value ?? ""} id={id} name={name} size="sm" defaultValue={value ?? ""}>
        <NativeSelectOption value="">{any}</NativeSelectOption>
        {options.map((option) => (
          <NativeSelectOption key={option.id} value={option.id}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

/** Newer and Older, keeping the filters. */
export function RunPager({ filters, page }: { filters: RunFilters; page: RunPage }) {
  return (
    <nav aria-label="Pages of runs" className="flex items-center justify-between">
      <PageLink
        label="Newer"
        href={page.newer === null ? null : runsHref(filters, { newer: page.newer })}
      />
      <PageLink
        label="Older"
        href={page.older === null ? null : runsHref(filters, { older: page.older })}
      />
    </nav>
  );
}

function PageLink({ label, href }: { label: string; href: string | null }) {
  if (href === null) {
    return (
      <Button variant="outline" size="sm" disabled>
        {label}
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={href}>{label}</Link>
    </Button>
  );
}
