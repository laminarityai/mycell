// The credits feature (ADR-0010): the ledger, the balance and the pre-flight check every model
// call passes, and whether the org is out of credits, which pauses every workflow (M7). A
// workflow's budget counts its live runs' spending this month, and a budget of another feature's
// own (memory's) reads its purpose's spending here. The Credits page reads a range's spending,
// where the ledger starts (a range keeps inside it) and the runway; workflow names and budgets
// are joined on the page, since workflows reads credits for its pauses.
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
// For the Credits page (admins): a range's spending by kind, workflow and day, where the
// ledger starts, and the runway.
export { getLedgerStart, getRunway, getSpendingSummary } from "./lib/spending";
// What workflow budgets count: each workflow's live run usage this calendar month (UTC), for
// admins and jobs, and which workflows have reached their budget, for anyone (M7), or with the
// day each did, for admins' alerts (M8).
export {
  budgetsReached,
  budgetsReachedOn,
  nextMonthStart,
  spentThisMonthByWorkflow,
} from "./lib/workflow-spending";
// A failed call's real cost, which `models` looks up in the gateway and records as a correction.
export { findUncostedFailedCall, recordFailedCallCost } from "./lib/corrections";
