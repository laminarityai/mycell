// The credits feature (ADR-0010): the ledger, the balance and the pre-flight check every model
// call passes, and whether the org is out of credits, which pauses every workflow (M7). Workflow
// budgets and the credit UI are M7's other tickets; a budget of another feature's own (memory's)
// reads its purpose's spending here.
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
// A failed call's real cost, which `models` looks up in the gateway and records as a correction.
export { findUncostedFailedCall, recordFailedCallCost } from "./lib/corrections";
