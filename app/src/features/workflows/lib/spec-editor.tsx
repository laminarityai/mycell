"use client";

// The workflow editor: a workflow's name and working spec, edited in a form or as JSON (the
// same spec, switchable at any time), validated live as saving would, and saved over the
// revision it was opened at.
import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { actionsAllowedBy, catalog } from "@/features/policy/catalog";
import type { CatalogAction, InsertedApproval, RiskLevel } from "@/features/policy/types";
import {
  addStep,
  issuesByStep,
  moveStep,
  readSpecJson,
  removeStep,
  updateStep,
  type SpecDraft,
} from "@/features/spec/edit";
import { sameValue } from "@/features/spec/diff";
import { formatSpec } from "@/features/spec/format";
import type { StepType } from "@/features/spec/types";
import { checkWorkflowSpecAction, saveWorkflowAction } from "../actions";
import type { EditorConnection, SpecCheckResult } from "../types";
import { RiskBadge } from "./risk-badge";
import { IssueList } from "./spec-fields";
import { SpecSettings } from "./spec-settings";
import { StepList } from "./step-list";
import { Problems } from "./workflow-editor";

export type SpecEditorProps = {
  /** Left out for a new workflow. */
  workflowId?: string;
  name?: string;
  spec: object;
  /** The working spec's revision this was opened at; a save over a newer one is refused. */
  revision?: number;
  maxRisk: RiskLevel | null;
  inserted: InsertedApproval[];
  /** The caller's own connections and the org's, for the tool step's action picker. */
  connections: EditorConnection[];
};

const CHECK_DELAY_MS = 400;

export function SpecEditor(props: SpecEditorProps) {
  const [result, save, saving] = useActionState(saveWorkflowAction, {});
  const [name, setName] = useState(props.name ?? "");
  // The saved spec as the form shows it: one list of steps, when it can. Otherwise the editor
  // opens on the JSON view.
  const shown = readSpecJson(JSON.stringify(props.spec));
  const [mode, setMode] = useState<"form" | "json">(shown.ok ? "form" : "json");
  const steps = useStepDraft(props.spec);
  const { draft } = steps;
  const [json, setJson] = useState(() => (shown.ok ? "" : formatSpec(props.spec)));
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [check, setCheck] = useState<{ text: string; result: SpecCheckResult } | null>(null);

  const specText = mode === "form" ? formatSpec(draft) : json;
  const parsed = mode === "form" ? ({ ok: true, value: draft } as const) : parseJson(json);
  useLiveCheck(specText, parsed.ok, setCheck);

  // The page refreshes after a save, so the editor then holds what was saved.
  const saved =
    props.workflowId !== undefined &&
    parsed.ok &&
    (sameValue(parsed.value, props.spec) || (shown.ok && sameValue(parsed.value, shown.draft))) &&
    name === props.name;
  const current = check?.text === specText ? check.result : null;
  const issues = current?.issues ?? [];
  const grouped = issuesByStep(issues);
  const inserted = current === null ? props.inserted : current.inserted;
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
      setSwitchError(`The form can't show this yet. ${read.message}`);
      return;
    }
    steps.reset(read.draft);
    setSwitchError(null);
    setMode("form");
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
          <TabsTrigger value="form">Form</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>
        {switchError === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {switchError}
          </p>
        )}
        <TabsContent value="form" className="flex flex-col gap-6 pt-2">
          <SpecSettings draft={draft} issues={grouped.spec} onChange={steps.updateSettings} />
          <IssueList issues={grouped.spec} label="Issues with the settings" />
          <StepList
            draft={draft}
            keys={steps.keys}
            issues={grouped.steps}
            inserted={inserted}
            actions={allowedActions(draft, props.connections)}
            onUpdate={steps.update}
            onRemove={steps.remove}
            onMove={steps.move}
            onAdd={steps.add}
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

/** The form's draft and a stable key per step, changed together. */
function useStepDraft(initial: object) {
  const [state, setState] = useState(() => {
    const read = readSpecJson(JSON.stringify(initial));
    const draft = read.ok ? read.draft : { steps: [] };
    return { draft, keys: fresh(draft.steps.length) };
  });
  const change = (draft: SpecDraft, keys: string[]) => {
    setState({ draft, keys });
  };
  const { draft, keys } = state;
  return {
    draft,
    keys,
    reset: (draft: SpecDraft) => {
      change(draft, fresh(draft.steps.length));
    },
    updateSettings: (fields: Record<string, unknown>) => {
      const updated = { ...draft, ...fields };
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) Reflect.deleteProperty(updated, key);
      }
      change(updated, keys);
    },
    update: (index: number, fields: Record<string, unknown>) => {
      change(updateStep(draft, index, fields), keys);
    },
    remove: (index: number) => {
      change(
        removeStep(draft, index),
        keys.filter((_, at) => at !== index),
      );
    },
    move: (index: number, by: -1 | 1) => {
      const moved = moveStep(draft, index, by);
      if (moved === draft) return;
      const swapped = [...keys];
      [swapped[index], swapped[index + by]] = [keys[index + by] ?? "", keys[index] ?? ""];
      change(moved, swapped);
    },
    add: (type: StepType) => {
      change(addStep(draft, type), [...keys, ...fresh(1)]);
    },
  };
}

// Step keys need only be unique on the page, so one counter serves every editor.
let lastKey = 0;
function fresh(count: number): string[] {
  return Array.from({ length: count }, () => `step-${String((lastKey += 1))}`);
}

type Parsed = { ok: true; value: unknown } | { ok: false; message: string };

function parseJson(text: string): Parsed {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, message: "This isn't valid JSON yet." };
  }
}

/**
 * The tool step's choices: the catalog actions the connections the spec could run on were
 * granted (the credentials' kind, allowed Gmail), or the whole catalog before there are any.
 */
function allowedActions(draft: SpecDraft, connections: EditorConnection[]): CatalogAction[] {
  const pool = connections.filter(
    (connection) => connection.kind === draft.credentials && connection.apps.includes("gmail"),
  );
  if (pool.length === 0) return Object.values(catalog);
  return actionsAllowedBy(pool.flatMap((connection) => connection.grantedScopes));
}
