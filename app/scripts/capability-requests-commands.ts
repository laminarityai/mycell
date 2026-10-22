// What `pnpm capability-requests` does, apart from printing and exiting, so its tests can run
// it. Our team works through every company's capability requests (ADR-0018): it lists the org
// IDs (the one cross-org read) and acts inside each org as its system ctx (ADR-0009).
import { z } from "zod";
import {
  listCapabilityRequests,
  setCapabilityRequestStatus,
} from "@/features/custom-actions/server";
import {
  capabilityRequestStatusSchema,
  type CapabilityRequest,
} from "@/features/custom-actions/types";
import { listOrgIds } from "@/features/orgs/server";
import { systemCtx } from "@/lib/ctx";

export const USAGE = [
  "Usage:",
  "  pnpm capability-requests [list]                    every company's requests",
  "  pnpm capability-requests show <requestId>          one request, with its code draft",
  "  pnpm capability-requests set <requestId> <status> [note]",
  `      status: ${capabilityRequestStatusSchema.options.join(" | ")}; no note clears the old one`,
].join("\n");

const commandSchema = z.union([
  z.tuple([]).transform(() => ({ command: "list" as const })),
  z.tuple([z.literal("list")]).transform(() => ({ command: "list" as const })),
  z
    .tuple([z.literal("show"), z.string().min(1)])
    .transform(([, requestId]) => ({ command: "show" as const, requestId })),
  z
    .tuple([z.literal("set"), z.string().min(1), capabilityRequestStatusSchema], z.string())
    .transform(([, requestId, status, ...note]) => ({
      command: "set" as const,
      requestId,
      status,
      note: note.length === 0 ? undefined : note.join(" "),
    })),
]);

export type CommandResult = { exitCode: number; output: string };

type OrgRequest = { orgId: string; request: CapabilityRequest };

export async function runCapabilityRequestsCommand(args: string[]): Promise<CommandResult> {
  const parsed = commandSchema.safeParse(args);
  if (!parsed.success) return { exitCode: 1, output: USAGE };
  const command = parsed.data;
  const all = await everyRequest();
  if (command.command === "list") {
    if (all.length === 0) return { exitCode: 0, output: "No capability requests." };
    return { exitCode: 0, output: all.map(summaryOf).join("\n") };
  }
  const found = all.find(({ request }) => request.id === command.requestId);
  if (found === undefined) {
    return { exitCode: 1, output: `No company has a capability request ${command.requestId}.` };
  }
  if (command.command === "show") return { exitCode: 0, output: detailOf(found) };
  await setCapabilityRequestStatus(systemCtx(found.orgId), found.request.id, {
    status: command.status,
    ...(command.note === undefined ? {} : { note: command.note }),
  });
  return {
    exitCode: 0,
    output: `Request ${found.request.id} is now ${command.status}.`,
  };
}

async function everyRequest(): Promise<OrgRequest[]> {
  const requests: OrgRequest[] = [];
  for (const orgId of await listOrgIds()) {
    for (const request of await listCapabilityRequests(systemCtx(orgId))) {
      requests.push({ orgId, request });
    }
  }
  return requests;
}

function summaryOf({ orgId, request }: OrgRequest): string {
  const lines = [
    `${request.id}  org ${orgId}  ${request.status}  asked ${String(request.count)}x  ` +
      `${request.app.name}: ${request.operation}`,
  ];
  if (request.note !== null) lines.push(`  note: ${request.note}`);
  return lines.join("\n");
}

function detailOf(found: OrgRequest): string {
  const { request } = found;
  const fields = (fields: CapabilityRequest["inputs"]) =>
    fields.length === 0
      ? ["  (none)"]
      : fields.map((field) => `  ${field.name}: ${field.description}`);
  return [
    summaryOf(found),
    `app id: ${request.app.id ?? "(not registered)"}`,
    `reason: ${request.reason}`,
    "inputs:",
    ...fields(request.inputs),
    "outputs:",
    ...fields(request.outputs),
    `asked in conversations: ${request.conversationIds.join(", ")}`,
    "code draft:",
    request.codeDraft ?? "(none)",
  ].join("\n");
}
