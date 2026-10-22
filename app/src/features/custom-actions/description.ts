// A custom action's description (ADR-0018): its checks, and the action it makes for an action
// set. Pure: no IO and no ctx, so the browser builds the company's action set from the same plain
// records the server stores (`ActionSetProvider` in `workflows`).
import { z } from "zod";
import { appUrl, REGISTERED_APPS } from "@/features/connections/registered-apps";
import { actionSetOf } from "@/features/policy/action-set";
import { catalogActionSet } from "@/features/policy/catalog";
import { customActionRisk } from "@/features/policy/custom-risk";
import type { ActionSet, CustomAction, CustomRequest } from "@/features/policy/types";
import type { ConditionField, ValueType } from "@/features/spec/types";
import { bodyOf, bodyPathIssues } from "./lib/body-paths";
import {
  customActionDescriptionSchema,
  type CustomActionDescription,
  type CustomActionRecord,
  type CustomActionWords,
  type CustomValueType,
} from "./types";

export type CustomActionCheck =
  { ok: true; action: CustomActionRecord } | { ok: false; issues: string[] };

/**
 * Checks a description the builder chat wrote: its shape, that its call stays on its registered
 * app and names only its own inputs, and the fixed risk rule, which sets its level (a level the
 * description proposes is dropped). Every issue comes back at once, in words the builder can fix.
 * A write is `external_send`: each time it runs, Mycel holds its request until a person approves
 * it (ADR-0020).
 */
export function checkCustomAction(input: unknown): CustomActionCheck {
  const parsed = customActionDescriptionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) =>
        issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`,
      ),
    };
  }
  const description = parsed.data;
  const issues = descriptionIssues(description);
  const risk = customActionRisk(description.call, REGISTERED_APPS[description.app]);
  if (!risk.ok) issues.push(risk.reason);
  else if (risk.risk === "read") {
    if (Object.keys(description.outputs).length === 0) {
      issues.push("outputs: Name at least one result field.");
    }
    if (description.editable.length > 0) {
      issues.push("Only a write has text a reviewer edits: a read sends nothing to review.");
    }
  }
  if (issues.length > 0 || !risk.ok) return { ok: false, issues };
  return { ok: true, action: { ...description, risk: risk.risk } };
}

const PLACEHOLDER = /\{([^{}]*)\}/g;

function descriptionIssues(description: CustomActionDescription): string[] {
  const { app: appId, call, inputs, editable } = description;
  const app = REGISTERED_APPS[appId];
  const issues: string[] = [];
  if (catalogActionSet.find(description.name) !== undefined) {
    issues.push(`"${description.name}" is a catalog action's name. Choose another.`);
  }
  const named = (where: string, input: string) => {
    if (!Object.hasOwn(inputs, input)) {
      issues.push(`${where} names "${input}", which isn't an input.`);
    }
  };
  for (const [, input] of call.path.matchAll(PLACEHOLDER)) {
    named("The path", input);
    if (Object.hasOwn(inputs, input) && inputs[input].optional) {
      issues.push(`The path names "${input}", so it can't be optional.`);
    }
  }
  const mappings = "graphql" in call ? { variables: call.variables } : call;
  for (const [field, mapping] of Object.entries({
    query: "query" in mappings ? mappings.query : {},
    body: "body" in mappings ? mappings.body : {},
    variables: "variables" in mappings ? mappings.variables : {},
  })) {
    for (const [key, input] of Object.entries(mapping)) named(`${field}.${key}`, input);
    if (field !== "query") issues.push(...bodyPathIssues(field, Object.keys(mapping)));
  }
  if (call.path.includes("?")) {
    issues.push("Put query parameters in `query`, not in the path.");
  }
  if (appUrl(app, call.path.replace(PLACEHOLDER, "x")) === undefined) {
    issues.push(
      `"${call.path}" isn't a path on ${app.name}: a custom action calls only the app's own hosts (${app.hosts.join(", ")}), and never names a host.`,
    );
  }
  if ("graphql" in call && app.apiDescription.format !== "graphql") {
    issues.push(`${app.name} has no GraphQL API: describe an HTTP call instead.`);
  }
  if ("method" in call && call.method === "GET" && Object.keys(call.body).length > 0) {
    issues.push("A GET sends no body: put its inputs in the path or the query.");
  }
  for (const [name, input] of Object.entries(inputs)) {
    if ((input.type === "choice") !== (input.choices !== undefined)) {
      issues.push(`inputs.${name}: give choices for a choice input, and only for one.`);
    }
  }
  for (const name of editable) {
    if (!Object.hasOwn(inputs, name) || inputs[name].type !== "text") {
      issues.push(`editable names "${name}", which isn't a text input.`);
    }
  }
  return issues;
}

/** The custom action a checked record makes: looked up, checked and run like a catalog action. */
export function customActionOf(record: CustomActionRecord): CustomAction {
  const { call, inputs, outputs } = record;
  const request: CustomRequest =
    "graphql" in call
      ? { graphql: call.graphql, path: call.path, query: {}, body: call.variables, outputs: {} }
      : { method: call.method, path: call.path, query: call.query, body: call.body, outputs: {} };
  return {
    kind: "custom",
    name: record.name,
    app: REGISTERED_APPS[record.app].name,
    registeredApp: record.app,
    description: record.description,
    risk: record.risk,
    input: z.strictObject(
      Object.fromEntries(
        Object.entries(inputs).map(([name, input]) => {
          const value = valueSchema(input.type, input.choices);
          return [name, input.optional ? value.optional() : value];
        }),
      ),
    ),
    // A field the response leaves out is null; one of another type fails the step.
    output: z.object(
      Object.fromEntries(
        Object.entries(outputs).map(([name, output]) => [
          name,
          valueSchema(output.type).nullable(),
        ]),
      ),
    ),
    // A write's result never reaches the run (it's sent only once approved), so only a read's
    // fields can be branched on.
    conditionFields:
      record.risk === "read"
        ? Object.entries(outputs).map(([name, output]): ConditionField => ({
            name,
            type: CONDITION_TYPES[output.type],
            label: output.label,
          }))
        : [],
    request: {
      ...request,
      outputs: Object.fromEntries(Object.entries(outputs).map(([name, o]) => [name, o.path])),
    },
  };
}

const CONDITION_TYPES: Record<Exclude<CustomValueType, "choice">, ValueType> = {
  text: "text",
  number: "number",
  yes_no: "yesNo",
};

function valueSchema(type: CustomValueType, choices: readonly string[] = []): z.ZodType {
  if (type === "number") return z.number();
  if (type === "yes_no") return z.boolean();
  if (type === "choice") return z.enum(choices as [string, ...string[]]);
  return z.string().min(1);
}

/** The action in plain words: its app's name, its sentence, its call and its level. */
export function customActionWords(record: CustomActionRecord): CustomActionWords {
  const { call } = record;
  return {
    name: record.name,
    app: REGISTERED_APPS[record.app].name,
    description: record.description,
    call: "graphql" in call ? `GraphQL ${call.path}` : `${call.method} ${call.path}`,
    risk: record.risk,
  };
}

/** The catalog, then the company's custom actions: an action set. */
export function actionSetWith(records: readonly CustomActionRecord[]): ActionSet {
  return actionSetOf([...catalogActionSet.actions, ...records.map(customActionOf)]);
}

/** A value a custom action's input takes: text, a number, yes/no, or a choice's text. */
export type CustomValue = string | number | boolean;

/** A custom action's call with its inputs filled in: what the executor sends. */
export type RenderedRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH";
  /** The path on the app with its query string. */
  path: string;
  /** The URL it reaches, on one of the app's hosts. */
  url: string;
  body: Record<string, unknown> | undefined;
};

/**
 * Fills the action's path (each value URL-encoded), query and body from its checked input, the
 * body nested as its dotted paths say. Undefined when the filled path would leave the app's
 * hosts: it's never sent.
 */
export function renderRequest(
  action: CustomAction,
  input: Readonly<Record<string, CustomValue | undefined>>,
): RenderedRequest | undefined {
  const { request } = action;
  const path = request.path.replace(PLACEHOLDER, (_match, name: string) =>
    encodeURIComponent(String(input[name])),
  );
  const query = new URLSearchParams();
  for (const [param, name] of Object.entries(request.query)) {
    if (input[name] !== undefined) query.set(param, String(input[name]));
  }
  const withQuery = query.size === 0 ? path : `${path}?${query.toString()}`;
  const app = REGISTERED_APPS[action.registeredApp as keyof typeof REGISTERED_APPS];
  const url = appUrl(app, withQuery);
  if (url === undefined) return undefined;
  const fields = Object.entries(request.body).flatMap(([field, name]) =>
    input[name] === undefined ? [] : [[field, input[name]] as const],
  );
  if ("graphql" in request) {
    const variables = bodyOf(fields);
    return { method: "POST", path: withQuery, url, body: { query: request.graphql, variables } };
  }
  if (request.method === "DELETE") return undefined;
  const body = request.method === "GET" ? undefined : bodyOf(fields);
  return { method: request.method, path: withQuery, url, body };
}

/**
 * Each result field from the response, by the dotted path its description gives: property names,
 * and indexes into lists. A field the response hasn't got is null.
 */
export function pickOutputs(action: CustomAction, response: unknown): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(action.request.outputs).map(([name, path]) => [name, at(response, path)]),
  );
}

function at(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, key)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current ?? null;
}
