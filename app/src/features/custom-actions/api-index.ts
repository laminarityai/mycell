// Building a registered app's operation index (ADR-0018): the compact form of its published API
// description that the builder chat's API lookup searches. `pnpm api-index` builds each one from
// the description copied into the repo and writes it beside it; the lookup reads only that. Pure:
// the script reads, parses and writes the files.
import { REGISTERED_APPS } from "@/features/connections/registered-apps";
import type { RegisteredAppId } from "@/features/connections/types";
import { InvariantError } from "@/lib/errors";
import type { ApiIndex } from "./lib/api-index-types";
import { indexGoogleDiscovery } from "./lib/discovery-index";
import { indexOpenApi } from "./lib/openapi-index";

export { apiIndexSchema, type ApiIndex } from "./lib/api-index-types";

/** Where an app's operation index is kept, relative to `app/`. */
export function apiIndexPath(app: RegisteredAppId): string {
  return `api-descriptions/${app}/operations.json.gz`;
}

/** One file of an app's API description: its path, its SHA-256 and its parsed content. */
export type ApiDescriptionSource = { path: string; sha256: string; content: unknown };

/** An app's operation index, from every file of its API description, parsed. */
export function buildApiIndex(app: RegisteredAppId, sources: ApiDescriptionSource[]): ApiIndex {
  const { format } = REGISTERED_APPS[app].apiDescription;
  const contents = sources.map((source) => source.content);
  const indexed =
    format === "openapi"
      ? mergeIndexes(contents.map(indexOpenApi))
      : format === "google-discovery"
        ? indexGoogleDiscovery(contents)
        : unsupported(format);
  return {
    app,
    sources: sources.map(({ path, sha256 }) => ({ path, sha256 })),
    ...indexed,
  };
}

function mergeIndexes(indexes: Pick<ApiIndex, "operations" | "types">[]) {
  return {
    operations: indexes.flatMap((index) => index.operations),
    types: Object.assign({}, ...indexes.map((index) => index.types)) as ApiIndex["types"],
  };
}

function unsupported(format: string): never {
  throw new InvariantError(`Indexing a ${format} API description isn't built yet.`);
}
