// Google Cloud Model Armor as the injection screen (docs/architecture.md, "Memory"): one
// `sanitizeUserPrompt` call per text, on the template MODEL_ARMOR_TEMPLATE names, read for its
// prompt-injection and jailbreak filter only. The text goes in the request and nowhere else;
// the template must have logging off, or Google would write it to Cloud Logging.
// https://docs.cloud.google.com/security-command-center/docs/sanitize-prompts-responses
import { z } from "zod";
import { InjectionScreenError, type InjectionScreen } from "../types";
import { googleCloudAccessToken, type GoogleCloudIdentity } from "./google-cloud-token";

const SERVICE = "google/model-armor";

// List price after the free 2 million tokens a month, which belong to Mycel's Google Cloud
// project rather than any one org (cloud.google.com/security/products/model-armor#pricing,
// read 2026-10-21). Model Armor reports no token count, so a text's tokens are estimated at
// four characters each.
const USD_PER_MILLION_TOKENS = 0.1;
const CHARS_PER_TOKEN = 4;

const sanitizeAnswerSchema = z.object({
  sanitizationResult: z.object({
    // One entry per filter the template turns on; only prompt injection is read.
    filterResults: z
      .looseObject({
        pi_and_jailbreak: z
          .object({
            piAndJailbreakFilterResult: z
              .object({
                executionState: z.string().optional(),
                matchState: z.string().optional(),
              })
              .optional(),
          })
          .optional(),
      })
      .optional(),
  }),
});

export type ModelArmorConfig = GoogleCloudIdentity & {
  /** projects/<project>/locations/<location>/templates/<template> */
  template: string;
};

export function modelArmorScreen(config: ModelArmorConfig): InjectionScreen {
  const location = config.template.split("/")[3] ?? "";
  const url = `https://modelarmor.${location}.rep.googleapis.com/v1/${config.template}:sanitizeUserPrompt`;
  return {
    service: SERVICE,
    costUsd: (text) =>
      (Math.ceil(text.length / CHARS_PER_TOKEN) * USD_PER_MILLION_TOKENS) / 1_000_000,
    async isInjection(text) {
      let token: string;
      try {
        token = await googleCloudAccessToken(config);
      } catch {
        throw new InjectionScreenError("auth_error", SERVICE);
      }
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ userPromptData: { text } }),
        });
      } catch {
        throw new InjectionScreenError("service_error", SERVICE);
      }
      if (!response.ok) throw new InjectionScreenError("service_error", SERVICE, response.status);
      const answer = sanitizeAnswerSchema.safeParse(await response.json().catch(() => null));
      const filter = answer.success
        ? answer.data.sanitizationResult.filterResults?.pi_and_jailbreak?.piAndJailbreakFilterResult
        : undefined;
      if (filter?.executionState !== "EXECUTION_SUCCESS") {
        throw new InjectionScreenError("no_verdict", SERVICE);
      }
      return filter.matchState === "MATCH_FOUND";
    },
  };
}
