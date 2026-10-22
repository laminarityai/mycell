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
import { joinPrompts } from "@/lib/prompts";
import { toolPrompts } from "./prompts";
import type { ToolDefinition } from "./tools";

const apps = joinPrompts(
  registeredApps.map((app) => toolPrompts.app({ id: app.id, name: app.name })),
  ", ",
);

export const lookUpAppApiTool: ToolDefinition<ApiLookupInput, ApiLookupResult> = {
  description: toolPrompts.lookUpAppApi({ apps }),
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
