// Screening what a tool hands the model for prompt injection (ADR-0023; Google's user data
// policy for restricted scopes), metered as the agent's (invariant 7). A result is screened as
// one text, so a clear result costs one call. When it's flagged, each item is screened alone
// and the flagged ones are dropped; if no single item is flagged (the injection spans several),
// every item is dropped. With no screen configured, or a screen that fails, nothing is handed
// on: the tool says memory is unavailable.
import { screenForInjection } from "@/features/models/server";
import { InjectionScreenError } from "@/features/models/types";
import type { Ctx } from "@/lib/ctx";
import { toolPrompts } from "./prompts";

export type Screened<T> = { ok: true; kept: T[]; dropped: number } | { ok: false };

/** What a tool tells the model beside its result when the screen dropped items. */
export function noteFor(screenedOut: number): { note?: string } {
  return screenedOut === 0 ? {} : { note: toolPrompts.screenedOut({ count: String(screenedOut) }) };
}

const AGENT = { purpose: "agent" } as const;

export async function screenItems<T>(
  ctx: Ctx,
  items: T[],
  textOf: (item: T) => string,
): Promise<Screened<T>> {
  if (items.length === 0) return { ok: true, kept: [], dropped: 0 };
  const whole = await screen(ctx, items.map(textOf).join("\n\n"));
  if (whole === "unavailable") return { ok: false };
  if (whole === "clear") return { ok: true, kept: items, dropped: 0 };
  const verdicts = await Promise.all(items.map((item) => screen(ctx, textOf(item))));
  if (verdicts.includes("unavailable")) return { ok: false };
  const kept = items.filter((_, i) => verdicts[i] === "clear");
  // Flagged together but never alone: nothing can be told apart, so nothing is handed on.
  const shown = kept.length === items.length ? [] : kept;
  return { ok: true, kept: shown, dropped: items.length - shown.length };
}

async function screen(ctx: Ctx, text: string): Promise<"clear" | "flagged" | "unavailable"> {
  try {
    return (await screenForInjection(ctx, { text, ...AGENT })).verdict;
  } catch (error) {
    // A screen that failed screened nothing, so no model may read the text.
    if (error instanceof InjectionScreenError) return "unavailable";
    throw error;
  }
}
