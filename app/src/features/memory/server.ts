// The memory feature (ADR-0022, ADR-0023): objects and short facts learned from the company's
// apps, each fact visible to whoever can see one of its sources. Discovery tells memory what it
// stored through Inngest events and never imports it.
import "server-only";

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
// The same search in the company-wide view only (what an org-credential run sees), whoever
// reads: the builder chat's, since builder conversations are shared among admins.
export { searchCompanyWideMemory } from "./lib/logged-reads";
// A summary of one object, from only the facts the caller can see: one metered `fast` call, its
// read logged as the reader named, and nothing stored.
export { summarizeObject } from "./lib/summarize";
// Where facts a reader already read came from, for Ask Mycel's footnotes: their sources and
// markers in the reader's view, never what they say, so not logged again.
export { citeFacts } from "./lib/cite";
// "Remember this" (M9): a person tells Mycel a fact, screened, filed by one metered `fast` call
// and embedded, all charged to the agent, and seen by them alone. Refuses the do-not-learn list
// and what isn't a work fact.
export { tellFact } from "./lib/tell";
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
// How long memory keeps things (ADR-0024): admins set the retention window, and a nightly job
// applies it as the org's system ctx.
export { applyRetention, setRetentionWindow } from "./lib/retention";
// Forgetting a person (ADR-0024): admins only; the sweep after it is the org's system ctx's.
export { forgetPerson, forgetPersonAgain } from "./lib/forget";
// Group addresses an admin marks company-wide. Admins only.
export {
  listCompanyWideLists,
  markCompanyWideList,
  unmarkCompanyWideList,
} from "./lib/company-wide-lists";
