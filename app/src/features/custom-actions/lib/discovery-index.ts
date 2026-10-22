// Indexing Google's Discovery documents, which Google publishes instead of OpenAPI: every
// method's HTTP method, path from its API's root (the service path, then the method's), path
// and query parameters, and the types its request and response name. Each API's types are named
// after it (`gmail.Message`), since two APIs may name different types alike.
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
} from "./api-index-types";
import { TypeCollector } from "./api-types";

const loose = z.record(z.string(), looseSchema).catch({});

const discoverySchema = z.object({
  kind: z.literal("discovery#restDescription"),
  name: z.string(),
  servicePath: z.string(),
  resources: loose,
  schemas: loose,
});

const methodSchema = z.object({
  id: z.string(),
  httpMethod: httpMethodSchema,
  path: z.string(),
  flatPath: z.string().optional(),
  description: z.unknown().optional(),
  parameters: loose,
  request: looseSchema.optional(),
  response: looseSchema.optional(),
});

/** The operations and types of one or more Discovery documents. */
export function indexGoogleDiscovery(descriptions: unknown[]): {
  operations: ApiOperation[];
  types: Record<string, ApiType>;
} {
  const operations: ApiOperation[] = [];
  const types: Record<string, ApiType> = {};
  for (const description of descriptions) {
    const doc = discoverySchema.parse(description);
    const collector = new TypeCollector(types, (ref) => {
      if (!Object.hasOwn(doc.schemas, ref)) return undefined;
      return { name: `${doc.name}.${ref}`, schema: doc.schemas[ref] };
    });
    for (const method of methodsOf(doc.resources)) {
      // A `{+name}` path expands to several segments; its flat path names each one.
      const path = method.path.includes("{+") ? (method.flatPath ?? method.path) : method.path;
      const parameters = Object.entries(method.parameters).flatMap(
        ([name, parameter]): ApiParameter[] => {
          if (parameter.location !== "path" && parameter.location !== "query") return [];
          const type = collector.typeOf(parameter, `${method.id}.${name}`);
          const description = shortText(parameter.description);
          return [
            {
              name: parameter.location === "path" ? inputNameOf(name) : name,
              in: parameter.location,
              required: parameter.location === "path" || parameter.required === true,
              type: parameter.repeated === true ? `list of ${type}` : type,
              ...(description === undefined ? {} : { description }),
            },
          ];
        },
      );
      operations.push({
        method: method.httpMethod,
        path: placeholdersAsInputs(`/${doc.servicePath}${path}`),
        id: method.id,
        summary: shortText(method.description) ?? method.id,
        parameters,
        ...(method.request === undefined
          ? {}
          : { body: collector.typeOf(method.request, `${method.id}.body`) }),
        ...(method.response === undefined
          ? {}
          : { response: collector.typeOf(method.response, `${method.id}.response`) }),
      });
    }
  }
  return { operations, types };
}

// Every method of a resource tree, depth first.
function methodsOf(resources: Record<string, Record<string, unknown>>) {
  const methods: z.infer<typeof methodSchema>[] = [];
  for (const resource of Object.values(resources)) {
    for (const method of Object.values(loose.parse(resource.methods))) {
      const parsed = methodSchema.safeParse(method);
      if (parsed.success) methods.push(parsed.data);
    }
    methods.push(...methodsOf(loose.parse(resource.resources)));
  }
  return methods;
}
