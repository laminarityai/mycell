"use client";

// Live validation for a working spec being edited: checked on the server as saving would, a
// moment after the admin stops typing.
import { useEffect, useRef, useState } from "react";
import { checkWorkflowSpecAction } from "../actions";
import type { SpecCheckResult } from "../types";

const CHECK_DELAY_MS = 400;

/** What the check says when it couldn't reach the server, or the server failed. */
const UNCHECKED: SpecCheckResult = {
  error: "Couldn't check the spec just now. Edit it again to retry.",
  issues: [],
  maxRisk: null,
  inserted: [],
};

/**
 * What saving would make of `specText`: null while it's being checked, or when it doesn't
 * parse. An answer for text that has since changed is dropped. A check that fails says so,
 * and holds the save back until a later edit checks again.
 */
export function useLiveCheck(specText: string, parses: boolean): SpecCheckResult | null {
  const [check, setCheck] = useState<{ text: string; result: SpecCheckResult } | null>(null);
  const latest = useRef(specText);
  useEffect(() => {
    latest.current = specText;
    if (!parses) return;
    const timer = setTimeout(() => {
      const answer = (result: SpecCheckResult) => {
        if (latest.current === specText) setCheck({ text: specText, result });
      };
      checkWorkflowSpecAction(JSON.parse(specText)).then(answer, () => {
        answer(UNCHECKED);
      });
    }, CHECK_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [specText, parses]);
  return check?.text === specText ? check.result : null;
}

/** What the save button's neighbour says: why it can't save yet, or that it can. */
export function saveHint(parses: boolean, current: SpecCheckResult | null, issues: number): string {
  if (!parses) return "Fix the JSON to save.";
  if (current === null) return "Checking…";
  if (current.error !== undefined) return current.error;
  if (issues > 0) return `Fix ${issues === 1 ? "1 issue" : `${String(issues)} issues`} to save.`;
  return "Ready to save.";
}
