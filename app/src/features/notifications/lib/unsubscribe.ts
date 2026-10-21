// The signed unsubscribe link in the digest email. It works without signing in, so the link
// itself vouches for the person: its token names the org and the user, signed with a key
// derived from the app's secret, and nothing unsigned is trusted. It never expires, as an
// unsubscribe link shouldn't.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "@/env";
import { findCtx } from "@/features/orgs/server";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { setReviewDigest } from "./settings";

const signed = z.object({ orgId: z.string().min(1), userId: z.string().min(1) });

// Its own key, derived from the app's secret, so an unsubscribe signature is good for nothing
// else and nothing else's signature is good for it.
const key = createHmac("sha256", env.BETTER_AUTH_SECRET)
  .update("mycel/review-digest-unsubscribe")
  .digest();

function sign(payload: string): Buffer {
  return createHmac("sha256", key).update(payload).digest();
}

/**
 * The link that turns `userId`'s review digest off, for the digest email. Made only by the
 * digest job, as the org's system ctx: ForbiddenError for anyone else.
 */
export function unsubscribeLink(ctx: Ctx, userId: string): string {
  if (ctx.role !== "system") throw new ForbiddenError();
  const payload = Buffer.from(JSON.stringify({ orgId: ctx.orgId, userId })).toString("base64url");
  const token = `${payload}.${sign(payload).toString("base64url")}`;
  const url = new URL("/unsubscribe", env.BETTER_AUTH_URL);
  url.searchParams.set("token", token);
  return url.toString();
}

/**
 * Turns the review digest off for the person an unsubscribe link was made for. Like orgs'
 * `findCtx`, it takes no ctx: the signed token vouches for the person, whose ctx is then read
 * fresh. ValidationError for a token Mycel didn't sign, or a person no longer in its org.
 */
export async function unsubscribeWithLink(token: string): Promise<void> {
  const person = verified(token);
  const ctx = person === undefined ? undefined : await findCtx(person.userId);
  if (person === undefined || ctx === undefined || ctx.orgId !== person.orgId) {
    throw new ValidationError("This unsubscribe link isn't valid.");
  }
  await setReviewDigest(ctx, false);
}

function verified(token: string): z.infer<typeof signed> | undefined {
  const parts = token.split(".");
  if (parts.length !== 2) return undefined;
  const [payload = "", signature = ""] = parts;
  const given = Buffer.from(signature, "base64url");
  const expected = sign(payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  try {
    return signed.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  } catch {
    return undefined;
  }
}
