// The memory feature (ADR-0022, ADR-0023): objects and short facts learned from the company's
// apps, each fact visible to whoever can see one of its sources. Discovery tells memory what it
// stored through Inngest events and never imports it.

// Called only by memory's job (and tests), as the org's system ctx.
export { learnFromItem } from "./lib/learn";
// Every read is logged (ADR-0024), as the reader its caller names: the person by default, the
// builder chat, or a workflow run.
export { readObject } from "./lib/logged-reads";
// Ranks what the caller can see by keywords, keys, links and stored embeddings, with no model
// call: the query itself is never embedded.
export { searchMemory } from "./lib/logged-reads";
// The access log: admins see the company's, members the reads of facts from their own sources.
// Pruned nightly, as the org's system ctx.
export { listAccessLog, pruneAccessLog } from "./lib/access-log";
// Our staff read memory only under an admin's consent for one case, logged in the same log.
export {
  grantStaffConsent,
  listStaffConsents,
  revokeStaffConsent,
  staffReadObject,
  staffSearchMemory,
} from "./lib/staff-consent";

// Admins' control of what memory costs and learns from: the estimate, starting memory with a
// monthly budget, changing it, and company-wide exclusions. Members get ForbiddenError.
export { getMemorySettings } from "./lib/settings";
export { setMemoryBudget, startMemory } from "./lib/budget";
export { addExclusion, removeExclusion } from "./lib/exclusions";
// Called only by memory's jobs (and tests), as the org's system ctx: queueing what discovery
// stored once memory starts, the items postponed for the budget when they're due again, and
// forgetting what a new exclusion covers.
export { queueStoredItems, resumePostponed } from "./lib/budget";
export { forgetExcluded } from "./lib/exclusions";
// Group addresses an admin marks company-wide. Admins only.
export {
  listCompanyWideLists,
  markCompanyWideList,
  unmarkCompanyWideList,
} from "./lib/company-wide-lists";
