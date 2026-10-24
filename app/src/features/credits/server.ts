// The credits feature (ADR-0010): the ledger, the balance and the pre-flight check every model
// call passes, and whether the org is out of credits, which pauses every workflow (M7). A
// workflow's budget counts its live runs' spending this month, and a budget of another feature's
// own (memory's) reads its purpose's spending here.
import "server-only";
export {
  checkCredits,
  getBalance,
  getSpending,
  grantCredits,
  isOutOfCredits,
  listLedger,
  recordUsage,
} from "./lib/ledger";
// What workflow budgets count: each workflow's live run usage this calendar month (UTC), for
// admins and jobs, and which workflows have reached their budget, for anyone (M7).
export { budgetsReached, nextMonthStart, spentThisMonthByWorkflow } from "./lib/workflow-spending";
// A failed call's real cost, which `models` looks up in the gateway and records as a correction.
export { findUncostedFailedCall, recordFailedCallCost } from "./lib/corrections";
