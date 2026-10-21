"use client";

// PROTOTYPE, never merge. Small pieces every variant shares: badges, the prototype toolbar, the
// mock builder chat and its proposal card, the step and path editors, and the "+" menu.
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  FlaskConical,
  GitBranch,
  Hand,
  Inbox,
  ListTodo,
  Mail,
  PenLine,
  RotateCcw,
  ScanText,
  ShieldCheck,
  Table2,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ACTIONS, FACTS, ROLES, findAction } from "./catalog";
import { SHAPES } from "./mock-data";
import {
  NEW_STEP_MENU,
  OPERATOR_LABELS,
  RISK_LABELS,
  findPath,
  findStep,
  flattenPaths,
  flattenView,
  testableFields,
  type Change,
  type NewStepKind,
  type PathRun,
  type ViewStep,
} from "./model";
import { usePrototype } from "./state";
import type { Check, FactName, Operator, RiskLevel, ShapeId, Step, StepType } from "./types";

// Badges ----------------------------------------------------------------------------------------

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  return <Badge variant={risk === "read" ? "secondary" : "outline"}>{RISK_LABELS[risk]}</Badge>;
}

export function ReviewBadge({ byPolicy }: { byPolicy: boolean }) {
  return (
    <Badge variant="secondary" className="gap-1">
      <ShieldCheck className="size-3" />
      {byPolicy ? "Waits for review (added by policy)" : "Waits for review"}
    </Badge>
  );
}

const CHANGE_LABELS: Record<NonNullable<Change>, string> = {
  added: "New",
  removed: "Removed",
  changed: "Changed",
};

export function ChangeBadge({ change }: { change: Change }) {
  if (change === null) return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        change === "added" && "border-emerald-500 text-emerald-700",
        change === "removed" && "border-red-400 text-red-700",
        change === "changed" && "border-amber-500 text-amber-700",
      )}
    >
      {CHANGE_LABELS[change]}
    </Badge>
  );
}

/** Border and background for a change on the graph. */
export function changeClasses(change: Change): string {
  switch (change) {
    case "added":
      return "border-emerald-500 bg-emerald-50/60 ring-1 ring-emerald-500/30";
    case "removed":
      return "border-dashed border-red-300 bg-red-50/40 text-muted-foreground";
    case "changed":
      return "border-amber-500 bg-amber-50/60 ring-1 ring-amber-500/30";
    default:
      return "";
  }
}

const STEP_ICONS: Record<StepType, ComponentType<{ className?: string }>> = {
  classify: Tags,
  extract: ScanText,
  tool: Mail,
  draft: PenLine,
  approval: ShieldCheck,
  escalate: Hand,
  branch: GitBranch,
};

export function StepIcon({ step, className }: { step: Step; className?: string }) {
  let Icon = STEP_ICONS[step.type];
  if (step.type === "tool") {
    const app = findAction(step.action)?.app;
    if (app === "Sheets") Icon = Table2;
    if (app === "Tasks") Icon = ListTodo;
  }
  return <Icon className={cn("size-3.5 shrink-0", className)} />;
}

export function TriggerIcon({ className }: { className?: string }) {
  return <Inbox className={cn("size-3.5 shrink-0", className)} />;
}

export function PrototypeBadge() {
  return (
    <span className="rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-amber-950 uppercase">
      Prototype
    </span>
  );
}

// Try it ----------------------------------------------------------------------------------------

export function PathRunSummary({
  run,
  compact = false,
  otherwise = false,
}: {
  run: PathRun | null;
  compact?: boolean;
  otherwise?: boolean;
}) {
  if (run === null) return null;
  if (run.status === "not-reached") {
    return <p className="text-xs text-muted-foreground">Not reached</p>;
  }
  if (run.status === "not-checked") {
    return (
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <CircleDashed className="size-3" />{" "}
        {otherwise ? "Not needed: another path applied" : "Not checked: an earlier path ran"}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <p
        className={cn(
          "flex items-center gap-1 text-xs font-medium",
          run.status === "taken" ? "text-emerald-700" : "text-red-700",
        )}
      >
        {run.status === "taken" ? (
          <CircleCheck className="size-3" />
        ) : (
          <CircleX className="size-3" />
        )}
        {run.status === "taken"
          ? run.checks.length === 0
            ? "Taken: nothing else applied"
            : "Taken"
          : "Didn't apply"}
      </p>
      {run.checks.map((check, index) => (
        <p
          key={index}
          className={cn(
            "text-[11px] leading-snug text-muted-foreground",
            compact && "line-clamp-2",
          )}
          title={`${check.text}: ${check.why}`}
        >
          <span className={check.passed ? "text-emerald-700" : "text-red-700"}>
            {check.passed ? "✓" : "✗"}
          </span>{" "}
          {check.text} <span className="opacity-80">({check.why})</span>
        </p>
      ))}
    </div>
  );
}

// Toolbar ---------------------------------------------------------------------------------------

/** The prototype's own controls: which mock workflow, and the Proposal and Try it toggles. */
export function PrototypeToolbar({ className }: { className?: string }) {
  const p = usePrototype();
  const proposalPending = p.proposal.status === "proposed";
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-b bg-amber-50/70 px-3 py-2 text-xs",
        className,
      )}
    >
      <PrototypeBadge />
      <label className="flex items-center gap-1">
        <span className="text-muted-foreground">Mock workflow</span>
        <select
          aria-label="Mock workflow"
          className="h-7 rounded-md border bg-background px-1.5 text-xs"
          value={p.shape}
          onChange={(event) => {
            p.setShape(event.target.value as ShapeId);
          }}
        >
          {SHAPES.map((shape) => (
            <option key={shape.id} value={shape.id}>
              {shape.label}
            </option>
          ))}
        </select>
      </label>
      <Toggle
        on={p.showingProposal}
        disabled={!proposalPending}
        onChange={p.setProposalOn}
        title={proposalPending ? "Show the pending proposal as changes" : "No pending proposal"}
      >
        Proposal
      </Toggle>
      <Toggle on={p.tryItOn} disabled={p.spec === null} onChange={p.setTryItOn}>
        <FlaskConical className="size-3" /> Try it
      </Toggle>
      {p.tryItOn ? (
        <select
          aria-label="Sample message"
          className="h-7 max-w-64 rounded-md border bg-background px-1.5 text-xs"
          value={p.sample?.id ?? ""}
          onChange={(event) => {
            p.setSample(event.target.value);
          }}
        >
          {p.samples.map((sample) => (
            <option key={sample.id} value={sample.id}>
              {sample.from}: {sample.subject}
            </option>
          ))}
        </select>
      ) : null}
      <Button size="xs" variant="ghost" className="ml-auto" onClick={p.reset}>
        <RotateCcw /> Reset
      </Button>
    </div>
  );
}

function Toggle({
  on,
  disabled,
  onChange,
  title,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      title={title}
      onClick={() => {
        onChange(!on);
      }}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md border px-2 font-medium transition-colors disabled:opacity-40",
        on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", on ? "bg-emerald-400" : "bg-muted-foreground/40")}
      />
      {children}
    </button>
  );
}

/** The sample message Try it is running, as a strip over the graph. */
export function TryItMessage({ className }: { className?: string }) {
  const p = usePrototype();
  if (p.sample === null) return null;
  return (
    <div
      className={cn("rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-sm", className)}
    >
      <p className="font-medium">
        Trying: {p.sample.subject}{" "}
        <span className="font-normal text-muted-foreground">from {p.sample.from}</span>
      </p>
      <p className="text-muted-foreground">
        Writes nothing. Lit steps ran; faded ones didn&apos;t.
      </p>
    </div>
  );
}

// Chat ------------------------------------------------------------------------------------------

export function MockChat({ className }: { className?: string }) {
  const p = usePrototype();
  const [input, setInput] = useState("");
  const list = useRef<HTMLOListElement>(null);
  // Like a chat: open at the newest message, where the proposal card waits.
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [p.chat.length, p.shape]);
  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <ol
        ref={list}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1"
        aria-label="Messages"
      >
        {p.chat.map((message) => (
          <li
            key={message.id}
            className={
              message.role === "user"
                ? "max-w-[85%] self-end rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                : "flex flex-col gap-1 text-sm"
            }
          >
            {message.role === "user"
              ? message.text
              : message.parts.map((part, index) =>
                  part.type === "text" ? (
                    <p key={index} className="whitespace-pre-wrap">
                      {part.text}
                    </p>
                  ) : part.type === "tool" ? (
                    <p key={index} className="text-xs text-muted-foreground">
                      {part.label}
                    </p>
                  ) : (
                    <ProposalCard key={index} />
                  ),
                )}
          </li>
        ))}
      </ol>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const text = input.trim();
          if (text === "") return;
          p.send(text);
          setInput("");
        }}
      >
        <Textarea
          aria-label="Message"
          value={input}
          className="min-h-14"
          placeholder="Draft replies to pricing questions using our price sheet…"
          onChange={(event) => {
            setInput(event.target.value);
          }}
        />
        <Button type="submit" className="self-end" disabled={input.trim() === ""}>
          Send
        </Button>
      </form>
    </div>
  );
}

const STATUS_LABELS = {
  proposed: "Waiting for your decision",
  accepted: "Accepted",
  rejected: "Rejected",
} as const;

/** Styled like the real `ProposalCard`, with a "Show on graph" toggle added. */
export function ProposalCard() {
  const p = usePrototype();
  const { proposal } = p;
  const view = p.proposalView;
  const steps = view === null ? [] : flattenView(view.steps);
  const paths =
    view === null ? [] : flattenPaths(view.steps).filter((path) => path.change === "changed");
  return (
    <article
      aria-label={`Proposal: ${proposal.name}`}
      className="flex flex-col gap-3 rounded-lg border p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">
          {p.shape === "empty" ? "New workflow" : "Change to"} “{proposal.name}”
        </h3>
        <Badge variant={proposal.status === "proposed" ? "default" : "secondary"}>
          {STATUS_LABELS[proposal.status]}
        </Badge>
      </header>
      <p>{proposal.summary}</p>
      {proposal.status === "proposed" ? (
        <>
          <ol className="flex flex-col gap-2" aria-label="Changes">
            {paths.map((path) => (
              <li key={`path:${path.id}`} className="flex flex-col gap-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <ChangeBadge change="changed" />
                  <span>
                    Path “{path.name}” runs when {path.condition}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">Before: {path.before}</p>
              </li>
            ))}
            {steps
              .filter((step) => step.change !== null || p.shape === "empty")
              .filter((step) => !(step.byPolicy && p.shape !== "empty" && step.change === null))
              .map((step) => (
                <CardStepRow key={`${step.change ?? ""}:${step.id}`} step={step} />
              ))}
          </ol>
          {p.editedSinceProposal ? (
            <p className="text-xs text-amber-700">
              You edited the workflow after this was proposed. Accepting replaces those edits.
            </p>
          ) : null}
          <button
            type="button"
            className="self-start text-xs underline underline-offset-2"
            onClick={() => {
              p.setProposalOn(!p.showingProposal);
            }}
          >
            {p.showingProposal ? "Hide it on the graph" : "Show it on the graph"}
          </button>
          <div className="flex gap-2">
            <Button onClick={p.accept}>Accept</Button>
            <Button variant="outline" onClick={p.reject}>
              Reject
            </Button>
          </div>
        </>
      ) : null}
    </article>
  );
}

function CardStepRow({ step }: { step: ViewStep & { pathName: string | null } }) {
  return (
    <li
      className={cn(
        "flex flex-col gap-1 text-sm",
        step.change === "removed" && "text-muted-foreground line-through",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ChangeBadge change={step.change} />
        <span>
          {step.pathName === null ? (
            ""
          ) : (
            <span className="text-muted-foreground">{step.pathName}: </span>
          )}
          {step.text}
        </span>
        {step.risk === null ? null : <RiskBadge risk={step.risk} />}
        {step.type === "approval" ? <ReviewBadge byPolicy={step.byPolicy} /> : null}
      </div>
      {step.before === null ? null : (
        <p className="text-xs text-muted-foreground">Before: {step.before}</p>
      )}
    </li>
  );
}

// "+" menu --------------------------------------------------------------------------------------

export function AddStepMenu({
  onPick,
  onClose,
  className,
  style,
}: {
  onPick: (kind: NewStepKind) => void;
  onClose: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      role="menu"
      style={style}
      aria-label="Add a step"
      className={cn(
        "nodrag nopan nowheel w-60 rounded-lg border bg-popover p-1 text-sm shadow-lg",
        className,
      )}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-xs font-medium text-muted-foreground">Add a step</span>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="rounded p-0.5 hover:bg-muted"
        >
          <X className="size-3" />
        </button>
      </div>
      {NEW_STEP_MENU.map((item) => (
        <button
          key={item.kind}
          type="button"
          role="menuitem"
          className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left hover:bg-muted"
          onClick={() => {
            onPick(item.kind);
          }}
        >
          <span className="truncate">{item.label}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{item.hint}</span>
        </button>
      ))}
    </div>
  );
}

// Editors ---------------------------------------------------------------------------------------

const fieldClass = "flex flex-col gap-1 text-xs font-medium";
const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm font-normal";

/** Whatever is selected, as a form. Edits go straight to the in-memory spec. */
export function SelectionEditor({ onDone }: { onDone?: () => void }) {
  const p = usePrototype();
  const { selection, spec } = p;
  if (selection === null || spec === null) return null;
  if (selection.kind === "trigger") {
    return (
      <EditorShell title="Trigger" subtitle="When a message arrives in Gmail" onDone={onDone}>
        <label className={fieldClass}>
          Labels to watch
          <Input value={spec.trigger.labelIds.join(", ")} readOnly className="font-normal" />
        </label>
        <p className="text-xs text-muted-foreground">
          Facts a condition may test: {Object.values(FACTS).join(", ")}.
        </p>
      </EditorShell>
    );
  }
  if (selection.kind === "path") return <PathEditor id={selection.id} onDone={onDone} />;
  const step = findStep(spec, selection.id);
  if (step === undefined) {
    // An approval the policy engine inserted: it isn't in the spec, and can't be changed.
    return (
      <EditorShell title="Waits for review" subtitle="Added by policy" onDone={onDone}>
        <p className="text-sm">
          The catalog says a Gmail draft is an <strong>external send</strong>, so the policy engine
          adds this review after every draft. A person sends or deletes the draft in Gmail.
        </p>
        <p className="text-xs text-muted-foreground">
          It can&apos;t be removed here, or by the builder. A branch chooses a path but never
          removes a review.
        </p>
      </EditorShell>
    );
  }
  return <StepEditor step={step} onDone={onDone} />;
}

function EditorShell({
  title,
  subtitle,
  onDone,
  onDelete,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onDone?: () => void;
  onDelete?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle === undefined ? null : (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {onDone === undefined ? null : (
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onDone}>
            <X />
          </Button>
        )}
      </header>
      {children}
      {onDelete === undefined ? null : (
        <Button variant="destructive" size="sm" className="self-start" onClick={onDelete}>
          <Trash2 /> Remove
        </Button>
      )}
    </div>
  );
}

export function StepEditor({ step, onDone }: { step: Step; onDone?: () => void }) {
  const p = usePrototype();
  const update = (change: (step: Step) => void) => {
    p.updateStep(step.id, change);
  };
  const action = step.type === "tool" ? findAction(step.action) : undefined;
  const risk = step.type === "draft" ? "external_send" : action?.risk;
  return (
    <EditorShell
      title={
        step.type === "tool"
          ? `${action?.app ?? ""} · ${action?.label ?? step.action}`
          : titleFor(step.type)
      }
      subtitle={
        <span className="flex flex-wrap items-center gap-1">
          <code className="font-mono">{step.id}</code>
          {risk === undefined ? null : (
            <>
              · <RiskBadge risk={risk} /> <span>from the catalog</span>
            </>
          )}
        </span>
      }
      onDone={onDone}
      onDelete={() => {
        p.removeStep(step.id);
      }}
    >
      {step.type === "classify" ? (
        <>
          <label className={fieldClass}>
            Question
            <Textarea
              value={step.question}
              className="min-h-14 font-normal"
              onChange={(event) => {
                update((s) => {
                  if (s.type === "classify") s.question = event.target.value;
                });
              }}
            />
          </label>
          <label className={fieldClass}>
            Answers (comma separated)
            <Input
              value={step.labels.join(", ")}
              className="font-normal"
              onChange={(event) => {
                update((s) => {
                  if (s.type === "classify") s.labels = event.target.value.split(/,\s*/);
                });
              }}
            />
          </label>
          <RoleField step={step} update={update} />
        </>
      ) : null}
      {step.type === "extract" ? (
        <>
          <p className="text-xs font-medium">Fields to read</p>
          {step.fields.map((field, index) => (
            <div key={index} className="flex flex-col gap-1 rounded-md border p-2">
              <div className="flex gap-1">
                <Input
                  aria-label="Field name"
                  value={field.name}
                  className="font-mono text-xs"
                  onChange={(event) => {
                    update((s) => {
                      if (s.type === "extract") s.fields[index].name = event.target.value;
                    });
                  }}
                />
                <select
                  aria-label="Field type"
                  className={cn(selectClass, "w-24")}
                  value={field.type}
                  onChange={(event) => {
                    update((s) => {
                      if (s.type === "extract")
                        s.fields[index].type = event.target.value as
                          "string" | "number" | "boolean";
                    });
                  }}
                >
                  <option value="string">text</option>
                  <option value="number">number</option>
                  <option value="boolean">yes/no</option>
                </select>
              </div>
              <Input
                aria-label="Field description"
                value={field.description}
                className="text-xs"
                onChange={(event) => {
                  update((s) => {
                    if (s.type === "extract") s.fields[index].description = event.target.value;
                  });
                }}
              />
            </div>
          ))}
          <Button
            size="xs"
            variant="outline"
            className="self-start"
            onClick={() => {
              update((s) => {
                if (s.type === "extract")
                  s.fields.push({ name: "newField", type: "string", description: "" });
              });
            }}
          >
            Add a field
          </Button>
          <RoleField step={step} update={update} />
        </>
      ) : null}
      {step.type === "tool" ? (
        <>
          <label className={fieldClass}>
            Action
            <select
              className={selectClass}
              value={step.action}
              onChange={(event) => {
                update((s) => {
                  if (s.type !== "tool") return;
                  s.action = event.target.value;
                  const input: Record<string, string> = {};
                  for (const name of findAction(s.action)?.inputs ?? [])
                    input[name] = s.input[name] ?? "";
                  s.input = input;
                });
              }}
            >
              {ACTIONS.filter((a) => a.name !== "google-mail.create-draft").map((a) => (
                <option key={a.name} value={a.name}>
                  {a.app} · {a.label} ({RISK_LABELS[a.risk]})
                </option>
              ))}
            </select>
          </label>
          {Object.entries(step.input).map(([key, value]) => (
            <label key={key} className={fieldClass}>
              <span className="font-mono">{key}</span>
              <Input
                value={value}
                className="font-normal"
                onChange={(event) => {
                  update((s) => {
                    if (s.type === "tool") s.input[key] = event.target.value;
                  });
                }}
              />
            </label>
          ))}
          <p className="text-xs text-muted-foreground">
            Returns, for later conditions:{" "}
            {(action?.returns ?? []).map((r) => r.name).join(", ") || "nothing"}.
          </p>
        </>
      ) : null}
      {step.type === "draft" ? (
        <>
          <label className={fieldClass}>
            Instructions
            <Textarea
              value={step.instructions}
              className="min-h-20 font-normal"
              onChange={(event) => {
                update((s) => {
                  if (s.type === "draft") s.instructions = event.target.value;
                });
              }}
            />
          </label>
          <label className={fieldClass}>
            Reads (context)
            <Input
              value={step.context.join(", ")}
              className="font-mono text-xs"
              onChange={(event) => {
                update((s) => {
                  if (s.type === "draft") s.context = event.target.value.split(/,\s*/);
                });
              }}
            />
          </label>
          <RoleField step={step} update={update} />
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldCheck className="size-3" /> A review follows this step: policy adds it for every
            external send.
          </p>
        </>
      ) : null}
      {step.type === "escalate" ? (
        <label className={fieldClass}>
          Why a person should look
          <Textarea
            value={step.reason}
            className="min-h-16 font-normal"
            onChange={(event) => {
              update((s) => {
                if (s.type === "escalate") s.reason = event.target.value;
              });
            }}
          />
        </label>
      ) : null}
      {step.type === "branch" ? (
        <>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-xs font-medium">When several paths apply</legend>
            {(
              [
                [
                  "first",
                  "First match",
                  "Check paths left to right; run only the first that applies.",
                ],
                [
                  "every",
                  "Every match",
                  "Run every path that applies, one after another, left to right.",
                ],
              ] as const
            ).map(([mode, label, hint]) => (
              <label key={mode} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                <input
                  type="radio"
                  name={`mode-${step.id}`}
                  checked={step.mode === mode}
                  onChange={() => {
                    update((s) => {
                      if (s.type === "branch") s.mode = mode;
                    });
                  }}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium">Paths, in the order they&apos;re checked</p>
            {step.paths.map((path, index) => (
              <div
                key={path.id}
                className="flex items-center gap-1 rounded-md border px-2 py-1 text-sm"
              >
                <button
                  type="button"
                  className="flex-1 truncate text-left hover:underline"
                  onClick={() => {
                    p.select({ kind: "path", id: path.id });
                  }}
                >
                  {path.name}
                </button>
                <MoveButtons id={path.id} index={index} count={step.paths.length} />
              </div>
            ))}
            <div className="rounded-md border border-dashed px-2 py-1 text-sm text-muted-foreground">
              Otherwise (
              {step.otherwise.steps.length === 0
                ? "stops"
                : `${String(step.otherwise.steps.length)} steps`}
              )
            </div>
            <Button
              size="xs"
              variant="outline"
              className="self-start"
              onClick={() => {
                p.addPath(step.id);
              }}
            >
              Add a path
            </Button>
          </div>
        </>
      ) : null}
    </EditorShell>
  );
}

function titleFor(type: StepType): string {
  return {
    classify: "Classify",
    extract: "Extract",
    tool: "Action",
    draft: "Draft a reply",
    approval: "Waits for review",
    escalate: "Hand to a person",
    branch: "Branch",
  }[type];
}

function RoleField({
  step,
  update,
}: {
  step: Step;
  update: (change: (step: Step) => void) => void;
}) {
  if (!("role" in step)) return null;
  return (
    <label className={fieldClass}>
      Model role
      <select
        className={selectClass}
        value={step.role}
        onChange={(event) => {
          update((s) => {
            if ("role" in s) s.role = event.target.value as (typeof ROLES)[number];
          });
        }}
      >
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
    </label>
  );
}

export function MoveButtons({ id, index, count }: { id: string; index: number; count: number }) {
  const p = usePrototype();
  return (
    <span className="nodrag inline-flex shrink-0 gap-0.5">
      <button
        type="button"
        aria-label="Move left"
        title="Move left"
        disabled={!p.editable || index === 0}
        className="rounded px-1 text-xs hover:bg-muted disabled:opacity-30"
        onClick={(event) => {
          event.stopPropagation();
          p.movePath(id, -1);
        }}
      >
        ←
      </button>
      <button
        type="button"
        aria-label="Move right"
        title="Move right"
        disabled={!p.editable || index === count - 1}
        className="rounded px-1 text-xs hover:bg-muted disabled:opacity-30"
        onClick={(event) => {
          event.stopPropagation();
          p.movePath(id, 1);
        }}
      >
        →
      </button>
    </span>
  );
}

export function PathEditor({ id, onDone }: { id: string; onDone?: () => void }) {
  const p = usePrototype();
  const spec = p.spec;
  if (spec === null) return null;
  const found = findPath(spec, id);
  if (found === undefined) {
    return (
      <EditorShell title="Otherwise" subtitle="Runs when no other path applies" onDone={onDone}>
        <p className="text-sm">
          The otherwise path has no condition. With no steps, it stops the run. Use “+” on the graph
          to give it steps.
        </p>
      </EditorShell>
    );
  }
  const { path, branch, index } = found;
  const fields = testableFields(spec, path.id);
  const update = (change: (checks: Check[]) => void) => {
    p.updatePath(path.id, (draft) => {
      change(draft.condition.checks);
    });
  };
  return (
    <EditorShell
      title={`Path: ${path.name}`}
      subtitle={`${branch.mode === "first" ? "First match" : "Every match"} · path ${String(index + 1)} of ${String(branch.paths.length)}`}
      onDone={onDone}
      onDelete={() => {
        p.removePath(path.id);
      }}
    >
      <label className={fieldClass}>
        Name
        <Input
          value={path.name}
          className="font-normal"
          onChange={(event) => {
            p.updatePath(path.id, (draft) => {
              draft.name = event.target.value;
            });
          }}
        />
      </label>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">Order</span>
        <MoveButtons id={path.id} index={index} count={branch.paths.length} />
      </div>
      <label className={fieldClass}>
        Runs when
        <select
          className={selectClass}
          value={path.condition.combine}
          onChange={(event) => {
            p.updatePath(path.id, (draft) => {
              draft.condition.combine = event.target.value as "all" | "any";
            });
          }}
        >
          <option value="all">all of these hold</option>
          <option value="any">any of these holds</option>
        </select>
      </label>
      {path.condition.checks.map((check, i) => (
        <CheckEditor
          key={i}
          check={check}
          fields={fields}
          onChange={(next) => {
            update((checks) => {
              checks[i] = next;
            });
          }}
          onRemove={() => {
            update((checks) => {
              checks.splice(i, 1);
            });
          }}
        />
      ))}
      <Button
        size="xs"
        variant="outline"
        className="self-start"
        onClick={() => {
          const first = fields[0];
          update((checks) => {
            checks.push(
              first?.kind === "classify"
                ? { kind: "classify", step: first.step, label: first.labels[0] ?? "", minP: 0.8 }
                : first !== undefined
                  ? { kind: first.kind, step: first.step, field: first.field, op: "is", value: "" }
                  : { kind: "fact", fact: "subject", op: "contains", value: "" },
            );
          });
        }}
      >
        Add a check
      </Button>
    </EditorShell>
  );
}

const KIND_LABELS: Record<Check["kind"], string> = {
  classify: "Classify answer",
  value: "Extracted value",
  fact: "Message fact",
  tool: "Action result",
};

function CheckEditor({
  check,
  fields,
  onChange,
  onRemove,
}: {
  check: Check;
  fields: ReturnType<typeof testableFields>;
  onChange: (check: Check) => void;
  onRemove: () => void;
}) {
  const classifySteps = fields.filter((f) => f.kind === "classify");
  const valueFields = fields.filter((f) => f.kind === "value");
  const toolFields = fields.filter((f) => f.kind === "tool");
  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-muted/30 p-2">
      <div className="flex items-center gap-1">
        <select
          aria-label="What to test"
          className={selectClass}
          value={check.kind}
          onChange={(event) => {
            const kind = event.target.value as Check["kind"];
            if (kind === "classify") {
              const f = classifySteps[0];
              onChange({ kind, step: f?.step ?? "", label: f?.labels[0] ?? "", minP: 0.8 });
            } else if (kind === "fact") {
              onChange({ kind, fact: "subject", op: "contains", value: "" });
            } else {
              const f = (kind === "value" ? valueFields : toolFields)[0];
              onChange({ kind, step: f?.step ?? "", field: f?.field ?? "", op: "is", value: "" });
            }
          }}
        >
          {(Object.keys(KIND_LABELS) as Check["kind"][]).map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </option>
          ))}
        </select>
        <Button size="icon-sm" variant="ghost" aria-label="Remove check" onClick={onRemove}>
          <X />
        </Button>
      </div>
      {check.kind === "classify" ? (
        <div className="flex items-center gap-1 text-xs">
          <select
            aria-label="Answer"
            className={selectClass}
            value={`${check.step}|${check.label}`}
            onChange={(event) => {
              const [step, label] = event.target.value.split("|");
              onChange({ ...check, step, label });
            }}
          >
            {classifySteps.flatMap((f) =>
              f.labels.map((label) => (
                <option key={`${f.step}|${label}`} value={`${f.step}|${label}`}>
                  {f.step} says {label}
                </option>
              )),
            )}
          </select>
          <span className="shrink-0">at least</span>
          <Input
            aria-label="Minimum confidence"
            type="number"
            min={0}
            max={100}
            value={Math.round(check.minP * 100)}
            className="w-16"
            onChange={(event) => {
              onChange({ ...check, minP: Number(event.target.value) / 100 });
            }}
          />
          <span>%</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          {check.kind === "fact" ? (
            <select
              aria-label="Fact"
              className={cn(selectClass, "w-auto flex-1")}
              value={check.fact}
              onChange={(event) => {
                onChange({ ...check, fact: event.target.value as FactName });
              }}
            >
              {(Object.keys(FACTS) as FactName[]).map((fact) => (
                <option key={fact} value={fact}>
                  {FACTS[fact]}
                </option>
              ))}
            </select>
          ) : (
            <select
              aria-label="Field"
              className={cn(selectClass, "w-auto flex-1")}
              value={`${check.step}|${check.field}`}
              onChange={(event) => {
                const [step, field] = event.target.value.split("|");
                onChange({ ...check, step, field });
              }}
            >
              {(check.kind === "value" ? valueFields : toolFields).map((f) => (
                <option key={`${f.step}|${f.field}`} value={`${f.step}|${f.field}`}>
                  {check.kind === "tool" ? `${f.step}'s ${f.field}` : f.field}
                </option>
              ))}
              {(check.kind === "value" ? valueFields : toolFields).length === 0 ? (
                <option value={`${check.step}|${check.field}`}>No fields above this path</option>
              ) : null}
            </select>
          )}
          <select
            aria-label="Operator"
            className={cn(selectClass, "w-auto")}
            value={check.op}
            onChange={(event) => {
              onChange({ ...check, op: event.target.value as Operator });
            }}
          >
            {(Object.keys(OPERATOR_LABELS) as Operator[]).map((op) => (
              <option key={op} value={op}>
                {OPERATOR_LABELS[op]}
              </option>
            ))}
          </select>
          {check.op === "filled" || check.op === "empty" ? null : (
            <Input
              aria-label="Value"
              value={check.value}
              className="w-24 flex-1"
              onChange={(event) => {
                onChange({ ...check, value: event.target.value });
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Watches the viewport width: the split becomes two tabs below 768px. */
export { useIsNarrow } from "./use-is-narrow";
