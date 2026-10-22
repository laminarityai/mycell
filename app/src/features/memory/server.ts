// The memory feature (ADR-0022, ADR-0023): objects and short facts learned from the company's
// apps, each fact visible to whoever can see one of its sources. Discovery tells memory what it
// stored through Inngest events and never imports it.

// Called only by memory's job (and tests), as the org's system ctx.
export { learnFromItem } from "./lib/learn";
export { readObject } from "./lib/read";
// Ranks what the caller can see by keywords, keys, links and stored embeddings, with no model
// call: the query itself is never embedded.
export { searchMemory } from "./lib/search";
