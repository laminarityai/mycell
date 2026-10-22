// The memory feature (ADR-0022, ADR-0023): objects and short facts learned from the company's
// apps, each fact visible to whoever can see one of its sources. Discovery tells memory what it
// stored through Inngest events and never imports it.

// Called only by memory's job (and tests), as the org's system ctx.
export { learnFromItem } from "./lib/learn";
// Following the apps, as the org's system ctx: an item deleted there, a Drive file's sharing
// changed, and the nightly re-read of every Drive file's sharing.
export { deleteRemovedItem, rereadAccess, rereadDriveAccess } from "./lib/source-changes";
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
// Admins only.
export {
  listCompanyWideLists,
  markCompanyWideList,
  unmarkCompanyWideList,
} from "./lib/company-wide-lists";
