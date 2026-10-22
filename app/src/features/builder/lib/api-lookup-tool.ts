// look_up_app_api: before describing a custom action, the agent finds the real call in the
// registered app's published API description rather than guessing it (ADR-0018). It reads only
// that public description, never customer data. The model reads every match in full; the
// conversation keeps only which operations it found, so it searches again when it needs more.
import { registeredApps } from "@/features/connections/registered-apps";
import { lookUpAppApi } from "@/features/custom-actions/server";
import {
  apiLookupInputSchema,
  type ApiLookupInput,
  type ApiLookupResult,
} from "@/features/custom-actions/types";
import type { ToolDefinition } from "./tools";

const appIds = registeredApps.map((app) => `"${app.id}" (${app.name})`).join(", ");

export const lookUpAppApiTool: ToolDefinition<ApiLookupInput, ApiLookupResult> = {
  description:
    `Search a registered app's published API description: app is one of ${appIds}. Pass ` +
    'search, a few plain words for what the call does ("outlook message", "append rows ' +
    'spreadsheet"), and optionally method ("GET" for reads) to get the best matching ' +
    "operations: each one's method and path (the path a custom action calls, its " +
    "{placeholders} already named as inputs), summary, path and query parameters, the fields " +
    "of its request body and response, and what Mycel's fixed rule makes of it (a read, a " +
    "write that waits for approval every time, or refused). Query parameters starting with $ " +
    "are Microsoft Graph's OData options ($select, $filter, $top, …). A field whose type names " +
    "another type is described by passing type (its name) instead of search. Use it before " +
    "describe_custom_action, so the call you describe is real. It reads only the vendor's " +
    "public description, never anyone's data.",
  inputSchema: apiLookupInputSchema,
  execute: (ctx, input) => lookUpAppApi(ctx, input),
  stored: (result) =>
    "operations" in result
      ? {
          app: result.app,
          search: result.search,
          operations: result.operations.map(({ method, path, summary, rule }) => ({
            method,
            path,
            summary,
            rule,
          })),
        }
      : { app: result.app, type: result.type?.type ?? null },
};
