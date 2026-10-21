// The workflows feature: specs saved as workflows, published as immutable workflow versions.
// Admin-only in M3; members get ForbiddenError.
export { getWorkflowVersion, publishWorkflow } from "./lib/versions";
export { getWorkflow, listWorkflows, saveWorkflow } from "./lib/workflows";
export { switchWorkflowOff, switchWorkflowOn } from "./lib/switches";
export { runnableConnections } from "./lib/runnable-connections";
// Save-time validation without saving: every issue, or what the policy engine made of the spec.
export { checkWorkflowSpec } from "./lib/validation";
// Called by the trigger's fan-out, as the system ctx: what's switched on for one connection.
export { listSwitchedOn } from "./lib/switches";
