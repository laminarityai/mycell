// The token Pub/Sub's authenticated push carries (ADR-0026): an OpenID Connect token Google
// signs as the push subscription's service account, for the subscription's audience. A push is
// Google's only if the token checks out against Google's published key set.
import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import { z } from "zod";

const GOOGLE_KEY_SET = new URL("https://www.googleapis.com/oauth2/v3/certs");
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

const pushClaims = z.object({ email: z.string(), email_verified: z.literal(true) });

// Fetched on first use and cached, refetched when a token names a key it doesn't hold.
let googleKeys: ReturnType<typeof createRemoteJWKSet> | undefined;

/**
 * Whether `authorization` is `Bearer <token>` with a token Google signed (a key from its
 * published key set, Google as issuer, unexpired) for `audience`, as `serviceAccount`, whose
 * email Google verified.
 */
export async function isGooglePush(
  authorization: string | null,
  expected: { audience: string; serviceAccount: string },
): Promise<boolean> {
  const token = /^Bearer (\S+)$/.exec(authorization ?? "")?.[1];
  if (token === undefined) return false;
  googleKeys ??= createRemoteJWKSet(GOOGLE_KEY_SET);
  try {
    const { payload } = await jwtVerify(token, googleKeys, {
      issuer: GOOGLE_ISSUERS,
      audience: expected.audience,
      algorithms: ["RS256"],
    });
    const claims = pushClaims.safeParse(payload);
    return (
      claims.success && claims.data.email.toLowerCase() === expected.serviceAccount.toLowerCase()
    );
  } catch (error) {
    // Anything but a token jose refused (Google's key set unreachable, say) is thrown: the
    // route answers 500, and Pub/Sub delivers the push again.
    if (error instanceof errors.JOSEError) return false;
    throw error;
  }
}
