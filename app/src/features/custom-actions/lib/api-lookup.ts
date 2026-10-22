// The builder chat's API lookup (ADR-0018): searching a registered app's published API
// description, through the operation index `pnpm api-index` built from it, so the call a custom
// action describes is real. It reads only those public files, never customer data. Each app's
// index is read and made searchable once per server process (Graph's: about 1 MB gzipped).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { REGISTERED_APPS } from "@/features/connections/registered-apps";
import type { RegisteredAppId } from "@/features/connections/types";
import { customActionRisk } from "@/features/policy/custom-risk";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { apiIndexPath } from "../api-index";
import {
  apiLookupInputSchema,
  type ApiLookupInput,
  type ApiLookupResult,
  type ApiTypeShown,
  type FoundOperation,
} from "../types";
import { apiIndexSchema } from "./api-index-types";
import { searchable, searchOperations, type SearchableIndex } from "./api-search";

/**
 * How many operations a search returns, how many fields each of their types shows (by name and
 * type only), and how many a type looked up by name shows (with what each holds).
 */
const OPERATIONS = 8;
const FOUND_FIELDS = 30;
const FIELDS = 60;

const loaded = new Map<RegisteredAppId, Promise<SearchableIndex>>();

// The app's index, read, checked and made searchable on first use.
function indexOf(app: RegisteredAppId): Promise<SearchableIndex> {
  let index = loaded.get(app);
  if (index === undefined) {
    index = readFile(join(process.cwd(), apiIndexPath(app))).then((bytes) =>
      searchable(apiIndexSchema.parse(JSON.parse(gunzipSync(bytes).toString("utf8")))),
    );
    // A failed read is tried again next time rather than kept.
    void index.catch(() => loaded.delete(app));
    loaded.set(app, index);
  }
  return index;
}

/**
 * Searches a registered app's API description by plain words (optionally one HTTP method), or
 * shows one of its types by name. Admins only, as the builder chat is.
 */
export async function lookUpAppApi(ctx: Ctx, input: ApiLookupInput): Promise<ApiLookupResult> {
  requireAdmin(ctx);
  const { app, search, method, type } = apiLookupInputSchema.parse(input);
  const searchableIndex = await indexOf(app);
  const show = (name: string, brief = false) => shownType(searchableIndex, name, brief);
  if (type !== undefined) {
    const shown = show(type);
    return shown === undefined
      ? { app, type: null, message: `${REGISTERED_APPS[app].name}'s API has no type "${type}".` }
      : { app, type: shown };
  }
  const operations = searchOperations(searchableIndex, search ?? "", {
    method,
    limit: OPERATIONS,
  }).map((operation): FoundOperation => {
    const { body, response, ...rest } = operation;
    const risk = customActionRisk(
      { method: operation.method, path: operation.path },
      REGISTERED_APPS[app],
    );
    const responseType = response === undefined ? undefined : show(response, true);
    const item = response === undefined ? undefined : listItemType(searchableIndex, response);
    const eachItem = item === undefined ? undefined : show(item, true);
    const bodyType = body === undefined ? undefined : show(body, true);
    return {
      ...rest,
      rule: !risk.ok
        ? `refused: ${risk.reason}`
        : risk.risk === "read"
          ? "a read: runs on its own"
          : "a write: waits for a person's approval every time it runs",
      ...(bodyType === undefined ? {} : { body: bodyType }),
      ...(responseType === undefined ? {} : { response: responseType }),
      ...(eachItem === undefined ? {} : { eachItem }),
    };
  });
  return { app, search: search ?? "", operations };
}

// The type of each item of a list response (Graph's `value`), if it is one.
function listItemType({ index }: SearchableIndex, name: string): string | undefined {
  if (!Object.hasOwn(index.types, name)) return undefined;
  const value = index.types[name].fields.find((field) => field.name === "value");
  return value?.type.match(/^list of (.+)$/)?.[1];
}

// A type as shown: in brief (for a found operation), its first fields by name and type only;
// otherwise, more of them, with what each holds.
function shownType(
  { index }: SearchableIndex,
  name: string,
  brief: boolean,
): ApiTypeShown | undefined {
  const type = Object.hasOwn(index.types, name) ? index.types[name] : undefined;
  if (type === undefined) return undefined;
  const limit = brief ? FOUND_FIELDS : FIELDS;
  const more = type.fields.length - limit;
  return {
    type: name,
    ...(type.description === undefined ? {} : { description: type.description }),
    fields: type.fields
      .slice(0, limit)
      .map((field) => (brief ? { name: field.name, type: field.type } : field)),
    ...(more > 0 ? { moreFields: more } : {}),
  };
}
