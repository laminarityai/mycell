"use client";

// Live validation for a working spec being edited, in the browser as the admin types: the spec
// schema and the policy engine against the company's action set, as saving runs them first.
// The checks against the org's setup (its connections and the scopes they were granted) need
// the server, so they run when the spec is saved.
import { useMemo } from "react";
import type { ActionSet } from "@/features/policy/types";
import { SpecInvalidError } from "@/lib/errors";
import type { SpecCheckResult } from "../types";
import { useActionSet } from "./action-set-context";
import { checkedByPolicy } from "./policy-check";

/** What the schema and the policy engine make of `specText`: null when it doesn't parse. */
export function useLiveCheck(specText: string, parses: boolean): SpecCheckResult | null {
  const actions = useActionSet();
  return useMemo(
    () => (parses ? checkSpec(JSON.parse(specText), actions) : null),
    [specText, parses, actions],
  );
}

function checkSpec(input: unknown, actions: ActionSet): SpecCheckResult {
  try {
    const { maxRisk, inserted } = checkedByPolicy(input, actions);
    return { issues: [], maxRisk, inserted };
  } catch (error) {
    if (!(error instanceof SpecInvalidError)) throw error;
    return { issues: error.issues, maxRisk: null, inserted: [] };
  }
}

/** What the save button's neighbour says: why it can't save yet, or that it can. */
export function saveHint(current: SpecCheckResult | null, issues: number): string {
  if (current === null) return "Fix the JSON to save.";
  if (issues > 0) return `Fix ${issues === 1 ? "1 issue" : `${String(issues)} issues`} to save.`;
  return "Ready to save.";
}
