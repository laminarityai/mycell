import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { account } from "@/db/auth-schema";
import { getDb } from "@/db/client";
import type { VerifiedGoogleProfile } from "../types";

const idTokenClaimsSchema = z.object({ hd: z.string().optional() });

/**
 * The user's profile from the Google ID token Better Auth stored on this sign-in. Better Auth
 * received that token directly from Google's token endpoint during this OAuth callback, which
 * OpenID Connect treats as verified, and its Google provider reads the claims the same way.
 */
export async function verifiedGoogleProfile(userId: string): Promise<VerifiedGoogleProfile> {
  const rows = await getDb()
    .select({ idToken: account.idToken })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "google")));
  const payload = rows.at(0)?.idToken?.split(".").at(1);
  if (payload === undefined) return { userId, hd: undefined };
  const claims = idTokenClaimsSchema.parse(
    JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
  );
  return { userId, hd: claims.hd };
}
