// PROTOTYPE, never merge. A guess at the "v2" spec shape from ADR-0015: branches hold nested
// paths, each path has a condition, and every branch has an otherwise path. Nothing here is the
// real `features/spec` contract.

export type ModelRole = "classify" | "fast" | "smart" | "judge";
export type RiskLevel =
  "read" | "internal_reversible" | "external_send" | "financial" | "destructive";

export type Trigger = { type: "gmail.message_received"; labelIds: string[] };

export type ClassifyStep = {
  id: string;
  type: "classify";
  role: ModelRole;
  question: string;
  labels: string[];
};

export type ExtractField = {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
};

export type ExtractStep = {
  id: string;
  type: "extract";
  role: ModelRole;
  fields: ExtractField[];
};

export type ToolStep = {
  id: string;
  type: "tool";
  action: string;
  input: Record<string, string>;
};

export type DraftStep = {
  id: string;
  type: "draft";
  role: ModelRole;
  instructions: string;
  context: string[];
  output: "google-mail.create-draft";
};

export type ApprovalStep = { id: string; type: "approval"; channel: "gmail_drafts" };

export type EscalateStep = { id: string; type: "escalate"; reason: string };

/** A check's operator, in the words admins see. */
export type Operator =
  "is" | "is_not" | "more_than" | "less_than" | "contains" | "filled" | "empty";

/** One typed check. A condition combines several with all-of or any-of, one level deep. */
export type Check =
  | { kind: "classify"; step: string; label: string; minP: number }
  | { kind: "value"; step: string; field: string; op: Operator; value: string }
  | { kind: "fact"; fact: FactName; op: Operator; value: string }
  | { kind: "tool"; step: string; field: string; op: Operator; value: string };

export type FactName = "sender_domain" | "subject" | "has_attachment" | "is_reply";

export type Condition = { combine: "all" | "any"; checks: Check[] };

export type Path = {
  id: string;
  name: string;
  condition: Condition;
  steps: Step[];
};

/** The otherwise path: no condition, and it stops unless it has steps. */
export type OtherwisePath = { id: string; steps: Step[] };

export type BranchStep = {
  id: string;
  type: "branch";
  mode: "first" | "every";
  paths: Path[];
  otherwise: OtherwisePath;
};

export type Step =
  ClassifyStep | ExtractStep | ToolStep | DraftStep | ApprovalStep | EscalateStep | BranchStep;

export type StepType = Step["type"];

export type SpecV2 = {
  specVersion: 2;
  id: string;
  name: string;
  credentials: "member" | "org";
  trigger: Trigger;
  /** A branch, if any, is always the last step of its list: paths never join. */
  steps: Step[];
};

export type ShapeId = "sorting" | "every" | "nested" | "empty";

/** A sample message for Try it, with what each model and catalog step would have answered. */
export type SampleMessage = {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  facts: Record<FactName, string>;
  classify: Record<string, { label: string; p: number }>;
  extract: Record<string, Record<string, string>>;
  tool: Record<string, Record<string, string>>;
};

export type ChatMessage =
  { id: string; role: "user"; text: string } | { id: string; role: "assistant"; parts: ChatPart[] };

export type ChatPart =
  { type: "text"; text: string } | { type: "tool"; label: string } | { type: "proposal" };

export type ProposalStatus = "proposed" | "accepted" | "rejected";

export type MockProposal = {
  /** The working spec the builder proposed against; the graph shows changes from it. */
  base: SpecV2 | null;
  name: string;
  summary: string;
  spec: SpecV2;
  status: ProposalStatus;
};

/** What is selected for editing. */
export type Selection =
  { kind: "trigger" } | { kind: "step"; id: string } | { kind: "path"; id: string } | null;
