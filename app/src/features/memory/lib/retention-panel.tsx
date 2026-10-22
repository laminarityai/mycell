// The settings page's sections on who sees what and how long it's kept: company-wide lists, the
// retention window, forgetting a person, and the way to the access log.
import Link from "next/link";
import { DateTime } from "@/components/date-time";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MAX_RETENTION_MONTHS, type MemorySettings } from "../types";
import {
  ForgetPersonForm,
  MarkCompanyWideListForm,
  RetentionForm,
  UnmarkCompanyWideListButton,
} from "./retention-controls";

export function CompanyWideLists({ settings }: { settings: MemorySettings }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="memory-company-wide-lists">
      <h2 id="memory-company-wide-lists" className="text-lg font-medium">
        Company-wide lists
      </h2>
      <p className="text-sm text-muted-foreground">
        Memory shows what it learned from an email only to the people the email reached. Mark a
        group address everyone is on, such as all@{settings.workspaceDomain}, and what memory learns
        from email sent to it is visible to everyone in the company.
      </p>
      <MarkCompanyWideListForm domain={settings.workspaceDomain} />
      {settings.companyWideLists.length === 0 ? (
        <p className="text-sm text-muted-foreground">No lists are marked company-wide.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>List</TableHead>
              <TableHead>Marked</TableHead>
              <TableHead className="sr-only">Remove</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {settings.companyWideLists.map((list) => (
              <TableRow key={list.address}>
                <TableCell className="font-medium">{list.address}</TableCell>
                <TableCell>
                  <DateTime value={list.markedAt} day />
                </TableCell>
                <TableCell className="text-right">
                  <UnmarkCompanyWideListButton address={list.address} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

export function Retention({ settings }: { settings: MemorySettings }) {
  const months = settings.started?.retentionMonths ?? MAX_RETENTION_MONTHS;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="memory-retention">
      <h2 id="memory-retention" className="text-lg font-medium">
        How long memory keeps things
      </h2>
      <p className="text-sm text-muted-foreground" data-testid="memory-retention">
        Memory keeps what it learned from an email or doc version for {String(months)} months after
        it was sent or saved. Each night it deletes the items past that window, with every fact no
        newer item still supports. Deleting an item in Gmail or Drive, or removing a connection,
        deletes what it taught at once.
        {settings.started === null
          ? ` You can shorten the window from ${String(MAX_RETENTION_MONTHS)} months once memory starts.`
          : ""}
      </p>
      {settings.started === null ? null : <RetentionForm months={months} />}
    </section>
  );
}

export function ForgetPerson({ settings }: { settings: MemorySettings }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="memory-forget">
      <h2 id="memory-forget" className="text-lg font-medium">
        Forget a person
      </h2>
      <p className="text-sm text-muted-foreground">
        For an erasure request, or anyone who asks: memory deletes the person with this email
        address and every fact about them or linking to them, and never learns about them from new
        email. It keeps only a code made from the address, never the address itself, so it
        can&apos;t show who was forgotten.
        {settings.forgottenPeople === 0
          ? ""
          : ` ${String(settings.forgottenPeople)} ${settings.forgottenPeople === 1 ? "person has" : "people have"} been forgotten.`}
      </p>
      <ForgetPersonForm />
    </section>
  );
}

export function AccessLogLink() {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="memory-access-log">
      <h2 id="memory-access-log" className="text-lg font-medium">
        Access log
      </h2>
      <p className="text-sm text-muted-foreground">
        Every read of memory, by a person, the builder chat, a workflow or our staff, is logged.{" "}
        <Link href="/memory/access-log" className="text-foreground underline">
          See the access log and staff access
        </Link>
      </p>
    </section>
  );
}
