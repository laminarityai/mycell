// The AI Gateway client. Every model call goes through it (#33): one gateway provider per call,
// whose fetch reads the cost and generation ID off the gateway's response, so a call that fails
// after the gateway answered (an off-schema output, a refusal, a billed error) still has them.
import { createGateway } from "ai";
import { z } from "zod";
import { env } from "@/env";

/** What the gateway reported for the call, once it answered. */
export type Metering = { costUsd: number; generationId: string | undefined };

export type MeteredGateway = {
  provider: ReturnType<typeof createGateway>;
  /** The cost and generation ID of the last response; cost 0 if none reported one. */
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

export function meteredGateway(): MeteredGateway {
  let last: Metering = { costUsd: 0, generationId: undefined };

  const meteringFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => undefined);
    const parsed = meteringSchema.safeParse(body);
    if (parsed.success) {
      const gateway = parsed.data.providerMetadata?.gateway;
      const costUsd = gateway?.cost;
      last = {
        costUsd: costUsd !== undefined && Number.isFinite(costUsd) ? costUsd : 0,
        generationId: gateway?.generationId ?? parsed.data.generationId ?? undefined,
      };
    }
    return response;
  };

  return {
    provider: createGateway({ apiKey: env.AI_GATEWAY_API_KEY, fetch: meteringFetch }),
    metering: () => last,
  };
}
