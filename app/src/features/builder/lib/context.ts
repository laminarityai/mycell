// Context providers: what the agent knows about the org when a turn starts. Each is a function
// of the admin's ctx (and the turn) returning one titled section of the agent's instructions,
// worded in builder/prompts/context.prompt.yml, so a new source of context (company memory;
// discovery's suggestions in M2) is one more entry in `contextProviders`, and the turn loop
// doesn't change. Each reads through another feature's entry functions with the admin's ctx, so
// it sees only what the admin may.
import { z } from "zod";
import { registeredAppOf, registeredApps } from "@/features/connections/registered-apps";
import { gmailConnections, listConnections } from "@/features/connections/server";
import { getActionSet } from "@/features/custom-actions/server";
import type { ConnectionSummary } from "@/features/connections/types";
import { getOrgSettings } from "@/features/orgs/server";
import type { ActionSet } from "@/features/policy/types";
import { operatorsFor, type ValueType } from "@/features/spec/conditions";
import { formatSpec } from "@/features/spec/format";
import type { Step } from "@/features/spec/types";
import { listTags } from "@/features/tags/server";
import { getWorkflow, listWorkflows } from "@/features/workflows/server";
import type { Ctx } from "@/lib/ctx";
import { joinPrompts, type PromptText } from "@/lib/prompts";
import type { ProposalStatus } from "../types";
import { declaredFieldLines } from "./condition-fields-context";
import { contextPrompts } from "./prompts";
import { listProposals } from "./proposals";
import { memorySection } from "./search-memory";
import type { TurnInfo } from "./tools";

export type ContextSection = { title: PromptText; content: PromptText };

/**
 * One section of context, from the admin's ctx, the turn and the company's action set, which
 * `gatherContext` resolves once for every provider.
 */
export type ContextProvider = (
  ctx: Ctx,
  turn: TurnInfo,
  actions: ActionSet,
) => Promise<ContextSection>;

/** Every action a spec may use, catalog and custom: its app, what it does, its fixed risk and its pending form. */
const actionCatalog: ContextProvider = (_ctx, _turn, actions) => {
  const lines = actions.actions.map((action) =>
    (action.kind === "custom" ? contextPrompts.customAction : contextPrompts.action)({
      name: action.name,
      app: action.app,
      description: action.description,
      risk: action.risk,
      runs:
        action.pendingForm === undefined
          ? contextPrompts.runsOnItsOwn()
          : contextPrompts.waitsAsPendingForm({ pendingForm: action.pendingForm }),
      inputs: JSON.stringify(z.toJSONSchema(action.input)),
      outputs: JSON.stringify(z.toJSONSchema(action.output)),
    }),
  );
  return Promise.resolve({
    title: contextPrompts.actionCatalogTitle(),
    content: joinPrompts(lines, "\n"),
  });
};

/** The checks a value of the type allows, as a check names them. */
const checksFor = (type: ValueType) => operatorsFor(type).join(", ");

/**
 * Every kind of value a path's condition may test, and the checks each allows: classify answers,
 * extract fields, the trigger's declared facts and catalog actions' declared result fields.
 */
const conditionFields: ContextProvider = (_ctx, _turn, actions) => {
  const checks = contextPrompts.conditionChecks({
    textChecks: checksFor("text"),
    numberChecks: checksFor("number"),
    yesNoChecks: checksFor("yesNo"),
  });
  return Promise.resolve({
    title: contextPrompts.conditionFieldsTitle(),
    content: joinPrompts([checks, ...declaredFieldLines(actions)], "\n"),
  });
};

/** The org's workflows with a summary of each working spec; the whole one for this turn's. */
const workflows: ContextProvider = async (ctx, turn, actions) => {
  const title = contextPrompts.workflowsTitle();
  const summaries = await listWorkflows(ctx);
  if (summaries.length === 0) return { title, content: contextPrompts.noWorkflows() };
  const lines: PromptText[] = [];
  for (const summary of summaries) {
    const workflow = await getWorkflow(ctx, summary.id, actions);
    const line = {
      name: workflow.name,
      id: workflow.id,
      state:
        summary.latestVersion === null
          ? contextPrompts.notPublished()
          : contextPrompts.published({ version: String(summary.latestVersion.number) }),
      credentials: workflow.workingSpec.credentials,
      steps: listOf(workflow.workingSpec.steps),
    };
    lines.push(
      workflow.id === turn.workflowId
        ? contextPrompts.conversationWorkflow({ ...line, spec: formatSpec(workflow.workingSpec) })
        : contextPrompts.workflow(line),
    );
  }
  return { title, content: joinPrompts(lines, "\n") };
};

/** A list of steps in order, each branch with its paths' steps in turn. */
function listOf(steps: Step[]): PromptText {
  return steps.length === 0 ? contextPrompts.noSteps() : joinPrompts(steps.map(stepOf), ", ");
}

function stepOf(step: Step): PromptText {
  if (step.type === "tool") return contextPrompts.toolStep({ id: step.id, action: step.action });
  if (step.type !== "branch") return contextPrompts.step({ id: step.id, type: step.type });
  const paths = step.paths.map((path) =>
    contextPrompts.branchPath({ id: path.id, name: path.name, steps: listOf(path.steps) }),
  );
  const otherwise = contextPrompts.otherwisePath({
    id: step.otherwise.id,
    steps: listOf(step.otherwise.steps),
  });
  return contextPrompts.branchStep({
    id: step.id,
    mode: step.mode,
    paths: joinPrompts([...paths, otherwise], "; "),
  });
}

/**
 * The connections the admin may build on: their own and the org's, with the apps each was
 * granted (ADR-0014). Other members' connections are only counted (ADR-0001).
 */
const connections: ContextProvider = async (ctx) => {
  const listing = await listConnections(ctx);
  const line = (connection: ConnectionSummary) => ({
    email: connection.accountEmail,
    id: connection.id,
    apps:
      connection.apps.length === 0
        ? contextPrompts.noAppsGranted()
        : contextPrompts.appsGranted({ apps: connection.apps.join(", ") }),
    notGranted:
      connection.missingApps.length === 0
        ? ""
        : contextPrompts.notGranted({ apps: connection.missingApps.join(", ") }),
  });
  const members = listing.memberConnections.length;
  // Exactly the connections read_examples accepts.
  const searchable = gmailConnections({
    own: listing.connections,
    org: listing.orgConnections,
  }).map((connection) => connection.id);
  const lines = [
    ...listing.connections.map((connection) => contextPrompts.ownConnection(line(connection))),
    ...listing.orgConnections.map((connection) => contextPrompts.orgConnection(line(connection))),
    members === 1
      ? contextPrompts.memberConnection()
      : contextPrompts.memberConnections({ count: String(members) }),
    searchable.length === 0
      ? contextPrompts.noSearchableMail()
      : contextPrompts.searchableMail({ connectionIds: searchable.join(", ") }),
  ];
  return { title: contextPrompts.connectionsTitle(), content: joinPrompts(lines, "\n") };
};

/**
 * The apps Mycel's team registered, which a custom action may call, each with the admin's own
 * and the org's connections to it. Other members' connections are never listed (ADR-0001).
 */
const registeredAppsContext: ContextProvider = async (ctx) => {
  const listing = await listConnections(ctx);
  const lines = registeredApps.map((app) => {
    const to = (connection: ConnectionSummary) => registeredAppOf(connection.source) === app.id;
    const connected = [
      ...listing.connections
        .filter(to)
        .map(({ accountEmail, id }) =>
          contextPrompts.appOwnConnection({ email: accountEmail, id }),
        ),
      ...listing.orgConnections
        .filter(to)
        .map(({ accountEmail, id }) =>
          contextPrompts.appOrgConnection({ email: accountEmail, id }),
        ),
    ];
    return connected.length === 0
      ? contextPrompts.appNotConnected({ id: app.id, name: app.name })
      : contextPrompts.appConnected({
          id: app.id,
          name: app.name,
          connections: joinPrompts(connected, "; "),
        });
  });
  return {
    title: contextPrompts.registeredAppsTitle(),
    content: joinPrompts([contextPrompts.registeredApps(), ...lines], "\n"),
  };
};

const tags: ContextProvider = async (ctx) => {
  const all = await listTags(ctx);
  const lines = all.map((tag) =>
    contextPrompts.tag({ name: tag.name, count: String(tag.userIds.length) }),
  );
  return {
    title: contextPrompts.tagsTitle(),
    content: all.length === 0 ? contextPrompts.noTags() : joinPrompts(lines, "\n"),
  };
};

const orgSettings: ContextProvider = async (ctx) => {
  const settings = await getOrgSettings(ctx);
  return {
    title: contextPrompts.organizationTitle(),
    content: contextPrompts.organization({
      name: settings.name,
      domain: settings.workspaceDomain,
    }),
  };
};

const PROPOSAL_STATES: Record<ProposalStatus, PromptText> = {
  proposed: contextPrompts.proposalProposed(),
  accepted: contextPrompts.proposalAccepted(),
  rejected: contextPrompts.proposalRejected(),
  stale: contextPrompts.proposalStale(),
};

/** What became of this conversation's proposals, so the agent knows what was saved. */
const proposals: ContextProvider = async (ctx, turn) => {
  const all = await listProposals(ctx, turn.conversationId);
  const lines = all.map((p) =>
    contextPrompts.proposal({
      id: p.id,
      status: p.status,
      name: p.name,
      state: PROPOSAL_STATES[p.status],
    }),
  );
  return {
    title: contextPrompts.proposalsTitle(),
    content: all.length === 0 ? contextPrompts.noProposals() : joinPrompts(lines, "\n"),
  };
};

export const contextProviders: ContextProvider[] = [
  orgSettings,
  actionCatalog,
  conditionFields,
  workflows,
  connections,
  registeredAppsContext,
  tags,
  proposals,
  memorySection,
];

/** Every provider's section, in order. */
export async function gatherContext(ctx: Ctx, turn: TurnInfo): Promise<ContextSection[]> {
  const actions = await getActionSet(ctx);
  return Promise.all(contextProviders.map((provider) => provider(ctx, turn, actions)));
}
