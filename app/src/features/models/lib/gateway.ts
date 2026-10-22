// The AI Gateway client. Every model call goes through it (#33): one gateway provider per call,
// whose fetch reads the cost and generation ID off the gateway's responses, so a call that fails
// after the gateway answered (an off-schema output, a refusal, a billed error) still has them. A
// call that takes several requests (embedding more texts than one request holds) adds up their
// costs.
import { createGateway } from "ai";
import { z } from "zod";
import { env } from "@/env";

/** What the gateway reported for the call, once it answered. */
export type Metering = { costUsd: number; generationId: string | undefined };

export type MeteredGateway = {
  provider: ReturnType<typeof createGateway>;
  /**
   * The summed cost of the call's responses so far (0 if none reported one), and the last
   * generation ID one reported.
   */
  metering(): Metering;
};

// `providerMetadata.gateway.cost` is a string of US dollars; tolerate a number too.
const meteringSchema = z.object({
  generationId: z.string().nullish(),
  providerMetadata: z
    .object({
      gateway: z
        .object({
          cost: z.union([z.string(), z.number()]).pipe(z.coerce.number()).optional(),
          generationId: z.string().optional(),
        })
        .optional(),
    })
    .nullish(),
});

/**
 * The cost and generation ID in a gateway answer, or in a streamed step's
 * `{ providerMetadata }`; cost 0 when it reports none.
 */
export function meteringOf(answer: unknown): Metering {
  return parseMetering(answer) ?? { costUsd: 0, generationId: undefined };
}

// The metering in an answer, or undefined when it isn't one the gateway's shape fits.
function parseMetering(answer: unknown): Metering | undefined {
  const parsed = meteringSchema.safeParse(answer);
  if (!parsed.success) return undefined;
  const gateway = parsed.data.providerMetadata?.gateway;
  const costUsd = gateway?.cost;
  return {
    costUsd: costUsd !== undefined && Number.isFinite(costUsd) ? costUsd : 0,
    generationId: gateway?.generationId ?? parsed.data.generationId ?? undefined,
  };
}

export function meteredGateway(): MeteredGateway {
  const total: Metering = { costUsd: 0, generationId: undefined };

  const meteringFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => undefined);
    const metering = parseMetering(body);
    if (metering !== undefined) {
      total.costUsd += metering.costUsd;
      total.generationId = metering.generationId ?? total.generationId;
    }
    return response;
  };

  return {
    provider: createGateway({
      apiKey: env.AI_GATEWAY_API_KEY,
      baseURL: env.AI_GATEWAY_BASE_URL,
      fetch: meteringFetch,
    }),
    metering: () => ({ ...total }),
  };
}
