// Delegated connection access (ADR-0016): a ctx that may reach one connection its user couldn't
// read themselves, because another feature already decided they may act on something waiting
// in it. Nothing outside this module can make one: the record of which ctx reaches which
// connection is private here, so a ctx built by hand reaches nothing more than its user can.
import type { Ctx } from "@/lib/ctx";

const delegated = new WeakMap<Ctx, string>();

/**
 * A copy of `ctx` that may also read and write `connectionId` through `getConnection` and the
 * proxy calls, and nothing else more than `ctx` may. The connection must still be in the
 * caller's org.
 */
export function delegatedCtx(ctx: Ctx, connectionId: string): Ctx {
  const copy = { ...ctx };
  delegated.set(copy, connectionId);
  return copy;
}

/** Whether `ctx` was delegated `connectionId` by delegatedCtx. */
export function isDelegated(ctx: Ctx, connectionId: string): boolean {
  return delegated.get(ctx) === connectionId;
}
