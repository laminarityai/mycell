import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccessLogLink, CompanyWideLists, ForgetPerson, Retention } from "./retention-panel";
import { AddExclusionForm, BudgetForm, RemoveExclusionButton } from "./settings-controls";
import { EXCLUSION_KIND_NAMES, type MemorySettings } from "../types";

const credits = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const day = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

/**
 * The admin's memory screen: the estimate and the start, the monthly budget and this month's
 * spending, the company-wide exclusions and lists, the retention window, forgetting a person,
 * and the way to the access log.
 */
export function MemorySettingsPanel({ settings }: { settings: MemorySettings }) {
  return (
    <div className="flex flex-col gap-8">
      <Learning settings={settings} />
      <Exclusions settings={settings} />
      <CompanyWideLists settings={settings} />
      <Retention settings={settings} />
      <ForgetPerson settings={settings} />
      <AccessLogLink />
    </div>
  );
}

function Learning({ settings }: { settings: MemorySettings }) {
  const { started, estimate } = settings;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="memory-learning">
      <h2 id="memory-learning" className="text-lg font-medium">
        Learning
      </h2>
      {started === null ? (
        <>
          <p className="text-sm text-muted-foreground">
            Memory learns about your customers, suppliers and deals from your team&apos;s business
            email and Google Docs. It hasn&apos;t started yet.
          </p>
          <p className="text-sm" data-testid="memory-estimate">
            Your connected accounts hold {credits.format(estimate.items)} emails and doc versions so
            far. Learning from all of them costs at most {credits.format(estimate.credits)} credits
            (up to {credits.format(estimate.creditsPerItem)} each; newsletters and other items that
            aren&apos;t business cost less). Each new version of a doc is learned again. Choose a
            monthly budget and start: learning pauses when a month&apos;s budget is spent, and
            carries on the next month.
          </p>
          <BudgetForm started={false} budget={Math.max(1, Math.ceil(estimate.credits))} />
        </>
      ) : (
        <>
          <p className="text-sm">
            Started {day.format(started.startedAt)}. This month memory has spent{" "}
            {credits.format(settings.spentThisMonth)} of its {credits.format(started.monthlyBudget)}{" "}
            credits.
            {settings.postponedItems > 0
              ? ` The budget is spent: ${credits.format(settings.postponedItems)} items wait for next month.`
              : ""}
          </p>
          <BudgetForm started budget={started.monthlyBudget} />
        </>
      )}
    </section>
  );
}

function Exclusions({ settings }: { settings: MemorySettings }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="memory-exclusions">
      <h2 id="memory-exclusions" className="text-lg font-medium">
        Exclusions
      </h2>
      <p className="text-sm text-muted-foreground">
        Memory never learns from emails with an excluded label, docs in an excluded Drive folder (or
        a folder inside it), or anything an excluded address or domain is on, in anyone&apos;s
        account. Excluding something also deletes what memory already learned from it.
      </p>
      <AddExclusionForm />
      {settings.exclusions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing is excluded.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kind</TableHead>
              <TableHead>Excluded</TableHead>
              <TableHead className="sr-only">Remove</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {settings.exclusions.map((exclusion) => (
              <TableRow key={exclusion.id}>
                <TableCell>{EXCLUSION_KIND_NAMES[exclusion.kind]}</TableCell>
                <TableCell className="font-medium">{exclusion.value}</TableCell>
                <TableCell className="text-right">
                  <RemoveExclusionButton id={exclusion.id} name={exclusion.value} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
