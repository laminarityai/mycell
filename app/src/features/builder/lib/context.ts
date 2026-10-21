// Context providers: what the agent knows about the org when a turn starts. Each is a function
// of the admin's ctx (and the turn) returning one titled section of the agent's instructions,
// so a new source of context (discovery's suggestions in M2, org memory in M9) is one more
// entry in `contextProviders`, and the turn loop doesn't change. Each reads through another
// feature's entry functions with the admin's ctx, so it sees only what the admin may.
import { z } from "zod";
import { gmailConnections, listConnections } from "@/features/connections/server";
import type { ConnectionSummary } from "@/features/connections/types";
import { getOrgSettings } from "@/features/orgs/server";
import { catalog } from "@/features/policy/catalog";
import { operatorsFor, type ValueType } from "@/features/spec/conditions";
import { formatSpec } from "@/features/spec/format";
import type { Spec, Step } from "@/features/spec/types";
import { listTags } from "@/features/tags/server";
import { getWorkflow, listWorkflows } from "@/features/workflows/server";
import type { Ctx } from "@/lib/ctx";
import type { ProposalStatus } from "../types";
import { conditionFieldsSection } from "./condition-fields-context";
import { listProposals } from "./proposals";
import type { TurnInfo } from "./tools";

export type ContextSection = { title: string; content: string };

export type ContextProvider = (ctx: Ctx, turn: TurnInfo) => Promise<ContextSection>;

/** Every action a spec may use: its app, what it does, its fixed risk and its pending form. */
const actionCatalog: ContextProvider = () => {
  const lines = Object.values(catalog).map((action) =>
    [
      `- ${action.name} (${action.app}): ${action.description}`,
      `  Risk level: ${action.risk}.` +
        (action.pendingForm === undefined
          ? " Runs on its own."
          : ` Never sends: it waits as ${action.pendingForm} for a person's review.`),
      `  Inputs: ${JSON.stringify(z.toJSONSchema(action.input))}`,
      `  Outputs: ${JSON.stringify(z.toJSONSchema(action.output))}`,
    ].join("\n"),
  );
  return Promise.resolve({ title: "Action catalog", content: lines.join("\n") });
};

/** How an extract field's declared type reads, and the type of value a check sees. */
const FIELD_TYPES: { reads: string; type: ValueType }[] = [
  { reads: "string field (text)", type: "text" },
  { reads: "number field", type: "number" },
  { reads: "boolean field (yes/no)", type: "yesNo" },
];

/**
 * Every kind of value a path's condition may test, and the checks each allows. Facts about the
 * trigger's message and catalog actions' result fields join this list as they're declared.
 */
const conditionFields: ContextProvider = () => {
  const lines = [
    "A path's condition tests values from the steps above its branch on its own path. Each check is one of:",
    '- A classify step\'s answer: { "classify": "<classify step id>", "is": "<label>", "minP": 0.85 }. ' +
      "It holds when the step picked that label with at least that probability.",
    '- An extract step\'s field: { "subject": { "from": "<extract step id>.<field>" }, "op": "<check>", "value": <value> }. ' +
      "The checks a field allows come from the type it declares. Text checks ignore upper and lower " +
      "case and take a string, number checks take a number, and is_yes, is_no, is_empty and " +
      "is_not_empty take no value.",
    ...FIELD_TYPES.map(({ reads, type }) => `  - ${reads}: ${operatorsFor(type).join(", ")}`),
    "Facts about the message, such as its sender or subject, and what a catalog action returned " +
      "can't be tested yet.",
  ];
  return Promise.resolve({ title: "Fields a condition may test", content: lines.join("\n") });
};

/** The org's workflows with a summary of each working spec; the whole one for this turn's. */
const workflows: ContextProvider = async (ctx, turn) => {
  const summaries = await listWorkflows(ctx);
  if (summaries.length === 0) return { title: "Workflows", content: "The org has none yet." };
  const lines: string[] = [];
  for (const summary of summaries) {
    const workflow = await getWorkflow(ctx, summary.id);
    const state =
      summary.latestVersion === null
        ? "not published"
        : `published, version ${String(summary.latestVersion.number)}`;
    lines.push(
      `- "${workflow.name}" (workflow ID ${workflow.id}, ${state}): ${stepsOf(workflow.workingSpec)}`,
    );
    if (workflow.id === turn.workflowId) {
      lines.push(
        `  This conversation is about it. Its working spec:\n${formatSpec(workflow.workingSpec)}`,
      );
    }
  }
  return { title: "Workflows", content: lines.join("\n") };
};

function stepsOf(spec: Spec): string {
  return `${spec.credentials} credentials, steps ${listOf(spec.steps)}`;
}

/** A list of steps in order, each branch with its paths' steps in turn. */
function listOf(steps: Step[]): string {
  return steps.length === 0 ? "stops" : steps.map(stepOf).join(", ");
}

function stepOf(step: Step): string {
  if (step.type === "tool") return `${step.id} (tool ${step.action})`;
  if (step.type !== "branch") return `${step.id} (${step.type})`;
  const paths = step.paths.map((path) => `path ${path.id} "${path.name}": ${listOf(path.steps)}`);
  const otherwise = `otherwise ${step.otherwise.id}: ${listOf(step.otherwise.steps)}`;
  return `${step.id} (branch, ${step.mode} match: ${[...paths, otherwise].join("; ")})`;
}

/**
 * The connections the admin may build on: their own and the org's, with the apps each was
 * granted (ADR-0014). Other members' connections are only counted (ADR-0001).
 */
const connections: ContextProvider = async (ctx) => {
  const listing = await listConnections(ctx);
  const line = (connection: ConnectionSummary, whose: string) =>
    `- ${connection.accountEmail}, ${whose} (connection ID ${connection.id}): ` +
    (connection.apps.length === 0 ? "no apps granted" : `apps ${connection.apps.join(", ")}`) +
    (connection.missingApps.length === 0
      ? ""
      : `; not granted ${connection.missingApps.join(", ")}`);
  const members = listing.memberConnections.length;
  // Exactly the connections read_examples accepts.
  const searchable = gmailConnections({
    own: listing.connections,
    org: listing.orgConnections,
  }).map((connection) => connection.id);
  const lines = [
    ...listing.connections.map((connection) => line(connection, "your own connection")),
    ...listing.orgConnections.map((connection) => line(connection, "an org connection")),
    `Other members have ${String(members)} member connection${members === 1 ? "" : "s"}, ` +
      "which you can't read.",
    searchable.length === 0
      ? "read_examples can search none of them: none was granted Gmail."
      : `read_examples can search the mail of: ${searchable.join(", ")}.`,
  ];
  return { title: "Connections", content: lines.join("\n") };
};

const tags: ContextProvider = async (ctx) => {
  const all = await listTags(ctx);
  return {
    title: "Tags",
    content:
      all.length === 0
        ? "The org has none yet."
        : all.map((tag) => `- ${tag.name} (${String(tag.userIds.length)} people)`).join("\n"),
  };
};

const orgSettings: ContextProvider = async (ctx) => {
  const settings = await getOrgSettings(ctx);
  return {
    title: "Organization",
    content: `Name: ${settings.name}\nWorkspace domain: ${settings.workspaceDomain}`,
  };
};

const PROPOSAL_STATES: Record<ProposalStatus, string> = {
  proposed: "waiting for the admin to accept or reject it",
  accepted: "accepted: it is now the workflow's working spec",
  rejected: "rejected by the admin",
  stale:
    "the workflow's working spec changed after it was made, so accepting it was refused and " +
    "nothing was saved; read the current spec with get_workflow and propose again if it's still wanted",
};

/** What became of this conversation's proposals, so the agent knows what was saved. */
const proposals: ContextProvider = async (ctx, turn) => {
  const all = await listProposals(ctx, turn.conversationId);
  return {
    title: "Proposals in this conversation",
    content:
      all.length === 0
        ? "None yet."
        : all
            .map((p) => `- ${p.id} (${p.status}, "${p.name}"): ${PROPOSAL_STATES[p.status]}`)
            .join("\n"),
  };
};

const conditionFields: ContextProvider = () => Promise.resolve(conditionFieldsSection());

export const contextProviders: ContextProvider[] = [
  orgSettings,
  actionCatalog,
  conditionFields,
  workflows,
  connections,
  tags,
  proposals,
];

/** Every provider's section, in order. */
export async function gatherContext(ctx: Ctx, turn: TurnInfo): Promise<ContextSection[]> {
  return Promise.all(contextProviders.map((provider) => provider(ctx, turn)));
}
