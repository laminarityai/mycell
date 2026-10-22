import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GrantStaffConsentForm, RevokeStaffConsentButton } from "./lib/staff-consent-controls";

// The admin's memory settings: the estimate and start, the budget, and the exclusions.
export { MemorySettingsPanel } from "./lib/settings-panel";
import {
  ACCESS_LOG_RETENTION_DAYS,
  type AccessLogEntry,
  type MemoryReadOperation,
  type StaffConsent,
} from "./types";

const OPERATIONS: Record<MemoryReadOperation, string> = {
  search: "Searched",
  read_object: "Read",
};

const when = (at: Date) =>
  `${at.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;

/**
 * The access log (ADR-0024): who or what read memory, when, and which objects, never what it
 * read. `workflowNames` names the workflows runs read for, by workflow ID.
 */
export function AccessLog({
  entries,
  admin,
  workflowNames,
}: {
  entries: AccessLogEntry[];
  admin: boolean;
  workflowNames: Map<string, string>;
}) {
  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {admin
          ? "Every read of your company's memory: who or what read it, when, and which objects. "
          : "Every read of facts memory learned from your own connections: who or what read them, when, and which objects. "}
        It never shows what was read. Entries are kept for {String(ACCESS_LOG_RETENTION_DAYS)} days.
      </p>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reads yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who or what</TableHead>
              <TableHead>Read</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id} className="align-top">
                <TableCell className="whitespace-nowrap">{when(entry.readAt)}</TableCell>
                <TableCell className="whitespace-normal">
                  <Reader reader={entry.reader} workflowNames={workflowNames} />
                </TableCell>
                <TableCell className="whitespace-normal">{whatWasRead(entry)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function Reader({
  reader,
  workflowNames,
}: {
  reader: AccessLogEntry["reader"];
  workflowNames: Map<string, string>;
}) {
  const name = reader.name ?? "someone no longer in the org";
  switch (reader.kind) {
    case "person":
      return <>{name}</>;
    case "builder":
      return <>The builder chat, for {name}</>;
    case "workflow_run": {
      const workflow = workflowNames.get(reader.workflowId ?? "") ?? "A workflow";
      return (
        <>
          {reader.workflowId === null ? (
            workflow
          ) : (
            <Link href={`/workflows/${reader.workflowId}`} className="underline">
              {workflow}
            </Link>
          )}{" "}
          run, {reader.userId === null ? "company-wide" : `as ${name}`}
        </>
      );
    }
    case "staff":
      return (
        <span className="flex flex-col gap-1">
          <span>
            <Badge variant="outline">Mycel staff</Badge> {reader.staff?.email ?? ""}, under {name}
            &apos;s consent
          </span>
          {reader.staff === null ? null : (
            <span className="text-muted-foreground">Case: {reader.staff.reason}</span>
          )}
        </span>
      );
    case "system":
      return <>Mycel</>;
  }
}

function whatWasRead(entry: AccessLogEntry): string {
  const named = entry.objects.flatMap((object) => object.name ?? []);
  const unseen = entry.objects.length - named.length;
  const objects = [
    ...named,
    ...(unseen === 0
      ? []
      : [`${String(unseen)} ${unseen === 1 ? "object" : "objects"} you can't see`]),
  ];
  const facts = `${String(entry.factCount)} ${entry.factCount === 1 ? "fact" : "facts"}`;
  if (objects.length === 0) return `${OPERATIONS[entry.operation]}: found nothing`;
  return `${OPERATIONS[entry.operation]} ${objects.join(", ")} (${facts})`;
}

/**
 * The org's staff consents (admins only): give one for a case, and revoke one at once. Our
 * staff read in the view of the admin who gave it.
 */
export function StaffConsents({ consents, now }: { consents: StaffConsent[]; now: Date }) {
  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Our staff can read your company&apos;s memory only with your consent for one case, and see
        only what you can see. Each read shows in the access log below.
      </p>
      <GrantStaffConsentForm />
      {consents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No consents given.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mycel staff</TableHead>
              <TableHead>Case</TableHead>
              <TableHead>Given by</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {consents.map((consent) => {
              const active = consent.revokedAt === null && consent.expiresAt > now;
              return (
                <TableRow key={consent.id} className="align-top">
                  <TableCell>{consent.staffEmail}</TableCell>
                  <TableCell className="whitespace-normal">{consent.reason}</TableCell>
                  <TableCell>{consent.grantedBy.name}</TableCell>
                  <TableCell className="whitespace-normal">
                    {consent.revokedAt !== null
                      ? `Revoked ${when(consent.revokedAt)}`
                      : active
                        ? `Until ${when(consent.expiresAt)}`
                        : `Expired ${when(consent.expiresAt)}`}
                  </TableCell>
                  <TableCell>
                    {active ? <RevokeStaffConsentButton consentId={consent.id} /> : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
