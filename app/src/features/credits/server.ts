// The credits feature (ADR-0010): the ledger, the balance and the pre-flight check every model
// call passes. Workflow budgets, pausing and the credit UI are M7; a budget of another feature's
// own (memory's) reads its purpose's spending here.
import "server-only";
export {
  checkCredits,
  getBalance,
  getSpending,
  grantCredits,
  listLedger,
  recordUsage,
} from "./lib/ledger";
