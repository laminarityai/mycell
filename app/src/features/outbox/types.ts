// What a change hands the outbox (ADR-0027).
import type { z } from "zod";

/**
 * Adds an event to those a change sends: an event type (the `eventType` a feature defines), its
 * data, checked by the type's schema there and then, and its fixed ID, derived from the change,
 * which makes every send of it one event to Inngest. Called inside `saveWithEvents`'s save.
 */
export type Emit = <S extends z.ZodType<Record<string, unknown>>>(
  type: { name: string; schema: S },
  data: z.input<S>,
  id: string,
) => void;
