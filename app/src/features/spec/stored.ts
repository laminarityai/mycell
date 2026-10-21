// Specs as tables hold them. A stored spec keeps the specVersion it was saved under: working
// specs and proposals until they're saved again, workflow versions for good, since a version is
// immutable. Every read of a stored spec goes through `readStoredSpec`, so code past the read
// only ever sees the current version's shape. Pure, so client code may import it.
import type { Spec } from "./types";

/**
 * A spec as a jsonb column holds it: a workflow's working spec or version, or a proposal's spec
 * and the working spec it was made against. Read it with `readStoredSpec`.
 */
export type StoredSpec = Spec;

/**
 * A stored spec in the current version's shape. Every stored spec is the current version
 * today, so it comes back as it is.
 */
export function readStoredSpec(stored: StoredSpec): Spec {
  return stored;
}
