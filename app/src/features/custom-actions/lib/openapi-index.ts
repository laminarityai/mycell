// Indexing an OpenAPI 3 description (Microsoft Graph's): every operation's method, path from the
// app's root (the server's path, `/v1.0`, then the operation's), path and query parameters, and
// the types its JSON body and response name.
import { z } from "zod";
import { httpMethodSchema } from "@/features/policy/types";
import {
  inputNameOf,
  looseSchema,
  placeholdersAsInputs,
  shortText,
  type ApiOperation,
  type ApiParameter,
  type ApiType,
  type LooseSchema,
} from "./api-index-types";
import { TypeCollector } from "./api-types";

const loose = z.record(z.string(), looseSchema).catch({});

const openApiSchema = z.object({
  openapi: z.string().startsWith("3."),
  servers: z.array(z.object({ url: z.url() })).min(1),
  paths: z.record(z.string(), looseSchema),
  components: z
    .object({
      schemas: loose,
      parameters: loose,
      requestBodies: loose,
      responses: loose,
    })
    .partial()
    .default({}),
});

const parameterSchema = z.object({
  name: z.string(),
  in: z.string(),
  required: z.boolean().default(false),
  description: z.unknown().optional(),
  schema: looseSchema.default({}),
});

/** The operations and types of an OpenAPI 3 description. */
export function indexOpenApi(description: unknown): {
  operations: ApiOperation[];
  types: Record<string, ApiType>;
} {
  const doc = openApiSchema.parse(description);
  const components = doc.components;
  const root = new URL(doc.servers[0]?.url ?? "/").pathname.replace(/\/$/, "");
  const types: Record<string, ApiType> = {};
  const collector = new TypeCollector(types, (ref) => {
    const name = /^#\/components\/schemas\/(.+)$/.exec(ref)?.[1];
    const schema = name === undefined ? undefined : components.schemas?.[name];
    return name === undefined || schema === undefined ? undefined : { name, schema };
  });
  const resolve = (value: LooseSchema, kind: "parameters" | "requestBodies" | "responses") => {
    if (typeof value.$ref !== "string") return value;
    const name = value.$ref.split("/").at(-1) ?? "";
    return components[kind]?.[name] ?? {};
  };
  const operations: ApiOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    // OData's count of a list: the list itself says as much.
    if (path.endsWith("/$count")) continue;
    const shared = z.array(looseSchema).catch([]).parse(item.parameters);
    for (const method of httpMethodSchema.options) {
      const operation = looseSchema.safeParse(item[method.toLowerCase()]);
      if (!operation.success) continue;
      const op = operation.data;
      const id = typeof op.operationId === "string" ? op.operationId : `${method} ${path}`;
      const parameters = [...shared, ...z.array(looseSchema).catch([]).parse(op.parameters)]
        .map((parameter) => parameterSchema.safeParse(resolve(parameter, "parameters")))
        .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
        .filter((parameter) => parameter.in === "path" || parameter.in === "query")
        .map((parameter): ApiParameter => ({
          name: parameter.in === "path" ? inputNameOf(parameter.name) : parameter.name,
          in: parameter.in === "path" ? "path" : "query",
          required: parameter.in === "path" || parameter.required,
          type: collector.typeOf(parameter.schema, `${id}.${parameter.name}`),
          // OData's own query options ($select, $filter, …) read the same on every operation.
          ...(parameter.name.startsWith("$") ? {} : optionalDescription(parameter.description)),
        }));
      const body = jsonSchemaOf(
        resolve(looseSchema.catch({}).parse(op.requestBody), "requestBodies"),
      );
      const response = successResponse(looseSchema.catch({}).parse(op.responses), (value) =>
        resolve(value, "responses"),
      );
      const summary = [shortText(op.summary), shortText(op.description)]
        .filter((text) => text !== undefined)
        .join(" ");
      operations.push({
        method,
        path: placeholdersAsInputs(`${root}${path}`),
        id,
        summary,
        parameters,
        ...(body === undefined ? {} : { body: collector.typeOf(body, `${id}.body`) }),
        ...(response === undefined
          ? {}
          : { response: collector.typeOf(response, `${id}.response`) }),
      });
    }
  }
  return { operations: withoutOthersCopies(operations, root), types };
}

/**
 * Without `/users/{userId}/…` where `/me/…` makes the same call: Microsoft Graph serves the
 * signed-in person's own resources under both, and every call acts as the signed-in person
 * (delegated permissions), so the `/me` one is the one to use.
 */
function withoutOthersCopies(operations: ApiOperation[], root: string): ApiOperation[] {
  const others = `${root}/users/{userId}/`;
  const own = new Set(operations.map(({ method, path }) => `${method} ${path}`));
  return operations.filter(
    ({ method, path }) =>
      !path.startsWith(others) || !own.has(`${method} ${root}/me/${path.slice(others.length)}`),
  );
}

function optionalDescription(text: unknown): { description?: string } {
  const description = shortText(text);
  return description === undefined ? {} : { description };
}

// The JSON schema a request body or response carries, if any.
function jsonSchemaOf(value: LooseSchema): LooseSchema | undefined {
  const content = loose.parse(value.content);
  if (!Object.hasOwn(content, "application/json")) return undefined;
  const schema = looseSchema.safeParse(content["application/json"].schema);
  return schema.success ? schema.data : undefined;
}

// The JSON schema of the operation's success: its 200, 201 or 2XX response.
function successResponse(
  responses: LooseSchema,
  resolve: (value: LooseSchema) => LooseSchema,
): LooseSchema | undefined {
  for (const status of ["200", "201", "2XX"]) {
    const response = looseSchema.safeParse(responses[status]);
    if (response.success) return jsonSchemaOf(resolve(response.data));
  }
  return undefined;
}
