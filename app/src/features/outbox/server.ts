// The outbox (ADR-0027): the one way a Server Action or server function sends Inngest events. A
// change emits its events inside `saveWithEvents`, which saves them with it and sends them right
// after the commit; the outbox job sends whatever that left.
import "server-only";
export { saveWithEvents, sendWaitingEvents } from "./lib/outbox";
export { listOrgsWithWaitingEvents } from "./lib/waiting-orgs";
