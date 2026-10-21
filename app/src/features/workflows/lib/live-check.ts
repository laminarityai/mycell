"use client";

// Live validation for a working spec being edited: checked on the server as saving would, a
// moment after the admin stops typing.
import { useEffect, useRef, useState } from "react";
import { checkWorkflowSpecAction } from "../actions";
import type { SpecCheckResult } from "../types";

const CHECK_DELAY_MS = 400;

/**
 * What saving would make of `specText`: null while it's being checked, or when it doesn't
 * parse. An answer for text that has since changed is dropped.
 */
export function useLiveCheck(specText: string, parses: boolean): SpecCheckResult | null {
  const [check, setCheck] = useState<{ text: string; result: SpecCheckResult } | null>(null);
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
