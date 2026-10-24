// A Google Cloud access token for a service account, reached from Vercel with no stored key
// (Workload Identity Federation, https://vercel.com/docs/oidc/gcp): the deployment's Vercel OIDC
// token is swapped at Google's Security Token Service for a federated token, which IAM
// Credentials swaps for a short-lived token of the service account. That token is kept until a
// few minutes before it expires. Locally, `vercel env pull` provides the OIDC token.
import { getVercelOidcToken } from "@vercel/oidc";
import { z } from "zod";
import { now } from "@/lib/time";

const STS_URL = "https://sts.googleapis.com/v1/token";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60_000;

/** The pool provider that trusts the Vercel project, and the service account it acts as. */
export type GoogleCloudIdentity = { workloadIdentityProvider: string; serviceAccountEmail: string };

/** Getting the token failed at `stage`. No `cause`: the answers may echo the tokens. */
export class GoogleCloudTokenError extends Error {
  readonly status: number | undefined;

  constructor(stage: "oidc" | "sts" | "iam_credentials", status?: number) {
    super(
      `Getting a Google Cloud token failed at ${stage}` +
        (status === undefined ? "." : ` (${String(status)}).`),
    );
    this.name = "GoogleCloudTokenError";
    this.status = status;
  }
}

const stsAnswerSchema = z.object({ access_token: z.string().min(1) });
const iamAnswerSchema = z.object({ accessToken: z.string().min(1), expireTime: z.iso.datetime() });

let cached: { key: string; token: string; refreshAt: number } | undefined;

/** An access token of the identity's service account, for the cloud-platform scope. */
export async function googleCloudAccessToken(identity: GoogleCloudIdentity): Promise<string> {
  const key = `${identity.workloadIdentityProvider} ${identity.serviceAccountEmail}`;
  if (cached?.key === key && now().getTime() < cached.refreshAt) return cached.token;

  const federated = await exchangeOidcToken(identity.workloadIdentityProvider);
  const response = await post(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(
      identity.serviceAccountEmail,
    )}:generateAccessToken`,
    {
      headers: { authorization: `Bearer ${federated}`, "content-type": "application/json" },
      body: JSON.stringify({ scope: [CLOUD_PLATFORM_SCOPE] }),
    },
    "iam_credentials",
  );
  const answer = await parsed(response, iamAnswerSchema, "iam_credentials");
  cached = {
    key,
    token: answer.accessToken,
    refreshAt: new Date(answer.expireTime).getTime() - REFRESH_BEFORE_EXPIRY_MS,
  };
  return answer.accessToken;
}

async function exchangeOidcToken(workloadIdentityProvider: string): Promise<string> {
  let subjectToken: string;
  try {
    subjectToken = await getVercelOidcToken();
  } catch {
    throw new GoogleCloudTokenError("oidc");
  }
  const response = await post(
    STS_URL,
    {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        audience: `//iam.googleapis.com/${workloadIdentityProvider}`,
        scope: CLOUD_PLATFORM_SCOPE,
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        subject_token: subjectToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      }).toString(),
    },
    "sts",
  );
  return (await parsed(response, stsAnswerSchema, "sts")).access_token;
}

async function post(
  url: string,
  init: { headers: Record<string, string>; body: string },
  stage: "sts" | "iam_credentials",
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", ...init });
  } catch {
    throw new GoogleCloudTokenError(stage);
  }
  if (!response.ok) throw new GoogleCloudTokenError(stage, response.status);
  return response;
}

async function parsed<T>(
  response: Response,
  schema: z.ZodType<T>,
  stage: "sts" | "iam_credentials",
): Promise<T> {
  const answer = schema.safeParse(await response.json().catch(() => null));
  if (!answer.success) throw new GoogleCloudTokenError(stage, response.status);
  return answer.data;
}
