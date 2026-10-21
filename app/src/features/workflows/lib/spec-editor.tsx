"use client";

// The workflow editor: a workflow's name and working spec, shown as a graph with its settings
// or edited as JSON (the same spec, switchable at any time), validated live as saving would,
// and saved over the revision it was opened at. Editing on the graph comes later; until then
// the steps are edited in the JSON view.
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { RiskLevel } from "@/features/policy/types";
import { issuesByStep, readSpecJson, type SpecDraft } from "@/features/spec/edit";
import { sameValue } from "@/features/spec/diff";
import { formatSpec } from "@/features/spec/format";
import { validateSpec } from "@/features/spec/validate";
import { checkWorkflowSpecAction, saveWorkflowAction } from "../actions";
import type { SpecCheckResult } from "../types";
import { useGraphTrace } from "./graph-trace";
import { RiskBadge } from "./risk-badge";
import { IssueList } from "./spec-fields";
import { SpecSettings } from "./spec-settings";
import { WorkflowGraph } from "./workflow-graph";
import { Problems } from "./workflow-editor";

export type SpecEditorProps = {
  /** Left out for a new workflow. */
  workflowId?: string;
  name?: string;
  spec: object;
  /** The working spec's revision this was opened at; a save over a newer one is refused. */
  revision?: number;
  maxRisk: RiskLevel | null;
};

const CHECK_DELAY_MS = 400;

export function SpecEditor(props: SpecEditorProps) {
  const [result, save, saving] = useActionState(saveWorkflowAction, {});
  const [name, setName] = useState(props.name ?? "");
  const [mode, setMode] = useState<"graph" | "json">("graph");
  const [draft, setDraft] = useState<SpecDraft>(() => {
    const read = readSpecJson(JSON.stringify(props.spec));
    return read.ok ? read.draft : { steps: [] };
  });
  // The settings keep what the admin types; they start again from a draft read from JSON.
  const [settingsKey, setSettingsKey] = useState(0);
  const [json, setJson] = useState("");
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [check, setCheck] = useState<{ text: string; result: SpecCheckResult } | null>(null);

  const specText = mode === "graph" ? formatSpec(draft) : json;
  const parsed = mode === "graph" ? ({ ok: true, value: draft } as const) : parseJson(json);
  useLiveCheck(specText, parsed.ok, setCheck);

  // The page refreshes after a save, so the editor then holds what was saved.
  const saved =
    props.workflowId !== undefined &&
    parsed.ok &&
    sameValue(parsed.value, props.spec) &&
    name === props.name;
  const current = check?.text === specText ? check.result : null;
  const issues = current?.issues ?? [];
  const maxRisk = current === null ? props.maxRisk : current.maxRisk;

  const switchTo = (next: string) => {
    if (next === "json") {
      setJson(formatSpec(draft));
      setSwitchError(null);
      setMode("json");
      return;
    }
    const read = readSpecJson(json);
    if (!read.ok) {
      setSwitchError(`The graph can't show this yet. ${read.message}`);
      return;
    }
    setDraft(read.draft);
    setSettingsKey((key) => key + 1);
    setSwitchError(null);
    setMode("graph");
  };

  return (
    <form action={save} className="flex flex-col gap-4" aria-label="Workflow editor">
      {props.workflowId === undefined ? null : (
        <input type="hidden" name="workflowId" value={props.workflowId} />
      )}
      {props.revision === undefined ? null : (
        <input type="hidden" name="baseRevision" value={props.revision} />
      )}
      <input type="hidden" name="spec" value={specText} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Name
        <Input
          name="name"
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </label>
      <p className="flex items-center gap-2 text-sm" aria-label="Max risk">
        Max risk of the working spec:{" "}
        {maxRisk === null ? "unknown until it's valid" : <RiskBadge risk={maxRisk} />}
      </p>
      <Tabs value={mode} onValueChange={switchTo}>
        <TabsList>
          <TabsTrigger value="graph">Graph</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>
        {switchError === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {switchError}
          </p>
        )}
        <TabsContent value="graph" className="flex flex-col gap-6 pt-2">
          <DraftGraph draft={draft} />
          <IssueList issues={issues} label="Issues with the spec" />
          <SpecSettings
            key={settingsKey}
            draft={draft}
            issues={issuesByStep(issues).spec}
            onChange={(fields) => {
              setDraft((before) => withSettings(before, fields));
            }}
          />
        </TabsContent>
        <TabsContent value="json" className="flex flex-col gap-2 pt-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Spec (JSON)
            <Textarea
              rows={24}
              spellCheck={false}
              className="font-mono text-xs"
              value={json}
              onChange={(event) => {
                setJson(event.target.value);
              }}
            />
          </label>
          {parsed.ok ? (
            <IssueList issues={issues} label="Issues with the spec" />
          ) : (
            <p className="text-sm text-destructive">{parsed.message}</p>
          )}
        </TabsContent>
      </Tabs>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving || !parsed.ok || issues.length > 0}>
          Save
        </Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {saved ? "All changes saved." : saveHint(parsed.ok, current, issues.length)}
        </p>
      </div>
      <Problems result={result} />
    </form>
  );
}

/**
 * The draft as a graph, lit up by the page's Try it, once it's a valid spec. Until then the
 * issues say what to fix.
 */
function DraftGraph({ draft }: { draft: SpecDraft }) {
  const trace = useGraphTrace();
  const checked = useMemo(() => validateSpec(draft), [draft]);
  if (checked.ok) return <WorkflowGraph spec={checked.spec} trace={trace} />;
  return (
    <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
      {draft.steps.length === 0
        ? "No steps yet. Write them in the JSON view, or ask the builder to propose them."
        : "The graph shows the workflow once its spec is valid. Fix the issues below, or in the JSON view."}
    </p>
  );
}

function withSettings(draft: SpecDraft, fields: Record<string, unknown>): SpecDraft {
  const updated = { ...draft, ...fields };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) Reflect.deleteProperty(updated, key);
  }
  return updated;
}

function saveHint(parses: boolean, current: SpecCheckResult | null, issues: number): string {
  if (!parses) return "Fix the JSON to save.";
  if (current === null) return "Checking…";
  if (current.error !== undefined) return current.error;
  if (issues > 0) return `Fix ${issues === 1 ? "1 issue" : `${String(issues)} issues`} to save.`;
  return "Ready to save.";
}

/**
 * Checks the spec on the server a moment after the admin stops typing, as saving would. An
 * answer for text that has since changed is dropped.
 */
function useLiveCheck(
  specText: string,
  parses: boolean,
  setCheck: (check: { text: string; result: SpecCheckResult }) => void,
) {
  const latest = useRef(specText);
  useEffect(() => {
    latest.current = specText;
    if (!parses) return;
    const timer = setTimeout(() => {
      void checkWorkflowSpecAction(JSON.parse(specText)).then((result) => {
        if (latest.current === specText) setCheck({ text: specText, result });
      });
    }, CHECK_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [specText, parses, setCheck]);
}

type Parsed = { ok: true; value: unknown } | { ok: false; message: string };

function parseJson(text: string): Parsed {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, message: "This isn't valid JSON yet." };
  }
}
