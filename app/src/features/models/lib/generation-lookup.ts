// The AI Gateway's Generation Lookup API, beside the gateway client: what a generation was
// billed, looked up by its ID after the call. A plain fetch, read down to the one field Mycel
// uses. Source, read 2026-10-22: https://vercel.com/docs/ai-gateway/sdks-and-apis/rest-api
// ("Look up a generation"); the AI SDK's `getGenerationInfo` builds the same URL.
import { z } from "zod";
import { env } from "@/env";
import { InvariantError } from "@/lib/errors";
import { GenerationLookupError } from "../types";

const DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh/v4/ai";

// `total_cost`: US dollars debited from the gateway balance. Tolerate a string, as the cost in
// a call's own metadata is one.
const generationSchema = z.object({
  data: z.object({
    total_cost: z.union([z.number(), z.string().transform(Number)]).pipe(z.number().nonnegative()),
  }),
});

/**
 * What the gateway billed for the generation, in US dollars; undefined when it can't say yet:
 * its usage events are ingested a while after the call (404 until then), or it's busy or
 * unreachable, so a later lookup may answer. Throws GenerationLookupError when it refuses.
 */
export async function lookUpGenerationCost(generationId: string): Promise<number | undefined> {
  const url = new URL("/v1/generation", new URL(env.AI_GATEWAY_BASE_URL ?? DEFAULT_BASE_URL));
  url.searchParams.set("id", generationId);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${env.AI_GATEWAY_API_KEY}` },
    });
  } catch {
    // Unreachable for now; a later lookup may answer.
    return undefined;
  }
  if (response.status === 404 || response.status === 429 || response.status >= 500) {
    return undefined;
  }
  if (!response.ok) throw new GenerationLookupError(response.status);
  const parsed = generationSchema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) {
    throw new InvariantError("The AI Gateway's generation lookup answered off its documentation.");
  }
  return parsed.data.data.total_cost;
}
