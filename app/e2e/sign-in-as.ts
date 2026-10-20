// Signs a browser in without Google: store a Better Auth session for the user, then set the
// session cookie exactly as Better Auth would after an OAuth callback. Better Auth names the
// cookie from its options (`better-auth.session_token` over http) and signs it the way
// better-call's setSignedCookie does: `${token}.${base64(HMAC-SHA256(secret, token))}`,
// URI-encoded. Production code has no test-only route; the app reads this cookie normally.
import type { BrowserContext } from "@playwright/test";
import { getCookies } from "better-auth/cookies";
import { makeSignature } from "better-auth/crypto";
import { seedSession } from "@/db/testing/seed-session";
import { env } from "@/env";

export async function signInAs(context: BrowserContext, userId: string): Promise<void> {
  const token = await seedSession(userId);
  const signature = await makeSignature(token, env.BETTER_AUTH_SECRET);
  const { sessionToken } = getCookies({ baseURL: env.BETTER_AUTH_URL });
  await context.addCookies([
    {
      name: sessionToken.name,
      value: encodeURIComponent(`${token}.${signature}`),
      url: env.BETTER_AUTH_URL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
