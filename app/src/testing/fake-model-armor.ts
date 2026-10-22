// The fake Google Cloud Model Armor, the injection screen, behind msw's fetch interception, with
// the two Google token endpoints Mycel calls first to reach it from Vercel: Security Token
// Service, which swaps the Vercel OIDC token for a federated one, and IAM Credentials, which
// swaps that for the service account's access token. Each checks what the real one would.
// Model Armor answers `sanitizeUserPrompt` in its documented shape: a prompt-injection match for
// text holding a phrase a test flagged, no match otherwise; or the error a test scripted.
import { http, HttpResponse } from "msw";
import { env } from "@/env";

const STS_URL = "https://sts.googleapis.com/v1/token";
const IAM_CREDENTIALS_URL =
  /^https:\/\/iamcredentials\.googleapis\.com\/v1\/projects\/-\/serviceAccounts\/([^/:]+):generateAccessToken$/;
const SANITIZE_URL =
  /^https:\/\/modelarmor\.([a-z0-9-]+)\.rep\.googleapis\.com\/v1\/(projects\/[^/]+\/locations\/[a-z0-9-]+\/templates\/[^/:]+):sanitizeUserPrompt$/;

const FEDERATED_TOKEN = "fake-federated-access-token";
const SERVICE_ACCOUNT_TOKEN = "fake-service-account-access-token";

type Answer =
  | { kind: "error"; status: number }
  | { kind: "pi_filter"; executionState: string; matchState: string };

class FakeModelArmor {
  private phrases: string[] = [];
  private answers: Answer[] = [];
  private texts: string[] = [];

  reset(): void {
    this.phrases = [];
    this.answers = [];
    this.texts = [];
  }

  /** Text holding `phrase` is a prompt-injection match, from now until the test ends. */
  flagText(phrase: string): void {
    this.phrases.push(phrase);
  }

  /** The next screen fails with `status`, as Google reports errors. */
  fail(status = 500): void {
    this.answers.push({ kind: "error", status });
  }

  /** The next screen's prompt-injection filter didn't run (a template without it, say). */
  skipFilter(): void {
    this.answers.push({
      kind: "pi_filter",
      executionState: "EXECUTION_SKIPPED",
      matchState: "MATCH_STATE_UNSPECIFIED",
    });
  }

  /** The texts screened so far, oldest first. */
  screened(): string[] {
    return this.texts;
  }

  readonly handlers = [
    http.post(STS_URL, async ({ request }) => {
      const form = new URLSearchParams(await request.text());
      const valid =
        form.get("grant_type") === "urn:ietf:params:oauth:grant-type:token-exchange" &&
        form.get("audience") ===
          `//iam.googleapis.com/${env.GCP_WORKLOAD_IDENTITY_PROVIDER ?? ""}` &&
        form.get("subject_token_type") === "urn:ietf:params:oauth:token-type:jwt" &&
        // A JWT: Vitest's config sets the Vercel OIDC token the real client reads.
        form.get("subject_token")?.split(".").length === 3 &&
        form.get("requested_token_type") === "urn:ietf:params:oauth:token-type:access_token";
      if (!valid) return googleError(400, "INVALID_ARGUMENT");
      return HttpResponse.json({
        access_token: FEDERATED_TOKEN,
        issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
        token_type: "Bearer",
        expires_in: 3600,
      });
    }),
    http.post(IAM_CREDENTIALS_URL, ({ request }) => {
      const email = decodeURIComponent(IAM_CREDENTIALS_URL.exec(request.url)?.[1] ?? "");
      if (request.headers.get("authorization") !== `Bearer ${FEDERATED_TOKEN}`) {
        return googleError(401, "UNAUTHENTICATED");
      }
      if (email !== env.GCP_SERVICE_ACCOUNT_EMAIL) return googleError(403, "PERMISSION_DENIED");
      return HttpResponse.json({
        accessToken: SERVICE_ACCOUNT_TOKEN,
        expireTime: new Date(Date.now() + 3_600_000).toISOString(),
      });
    }),
    http.post(SANITIZE_URL, async ({ request }) => {
      const [, location, template] = SANITIZE_URL.exec(request.url) ?? [];
      if (request.headers.get("authorization") !== `Bearer ${SERVICE_ACCOUNT_TOKEN}`) {
        return googleError(401, "UNAUTHENTICATED");
      }
      if (template !== env.MODEL_ARMOR_TEMPLATE || !template.includes(`/locations/${location}/`)) {
        return googleError(404, "NOT_FOUND");
      }
      const body = (await request.json()) as { userPromptData?: { text?: unknown } };
      const text = body.userPromptData?.text;
      if (typeof text !== "string") return googleError(400, "INVALID_ARGUMENT");
      this.texts.push(text);
      const answer = this.answers.shift() ?? {
        kind: "pi_filter",
        executionState: "EXECUTION_SUCCESS",
        matchState: this.phrases.some((phrase) => text.includes(phrase))
          ? "MATCH_FOUND"
          : "NO_MATCH_FOUND",
      };
      if (answer.kind === "error") return googleError(answer.status, "INTERNAL");
      return HttpResponse.json(sanitizeResult(answer.executionState, answer.matchState));
    }),
  ];
}

function sanitizeResult(executionState: string, matchState: string) {
  return {
    sanitizationResult: {
      filterMatchState: matchState === "MATCH_FOUND" ? "MATCH_FOUND" : "NO_MATCH_FOUND",
      invocationResult: "SUCCESS",
      filterResults: {
        pi_and_jailbreak: {
          piAndJailbreakFilterResult: {
            executionState,
            matchState,
            ...(matchState === "MATCH_FOUND" ? { confidenceLevel: "HIGH" } : {}),
          },
        },
      },
    },
  };
}

function googleError(code: number, status: string): Response {
  return HttpResponse.json({ error: { code, message: status, status } }, { status: code });
}

export const fakeModelArmor = new FakeModelArmor();
