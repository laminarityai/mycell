"use client";

// The company's action set in the browser (ADR-0018): what the graph, the step menu and the side
// panel look actions up in, so they offer and describe the actions saving would check against.
// A page's server component reads the company's custom actions (`listCustomActions`) and hands
// them, as plain records, to `ActionSetProvider` at the client root; without one, the set is the
// catalog alone.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { actionSetWith } from "@/features/custom-actions/description";
import type { CustomActionRecord } from "@/features/custom-actions/types";
import { catalogActionSet } from "@/features/policy/catalog";
import type { ActionSet } from "@/features/policy/types";

const ActionSetContext = createContext<ActionSet>(catalogActionSet);

/** The catalog plus `customActions`, for everything inside it. */
export function ActionSetProvider({
  customActions,
  children,
}: {
  customActions: readonly CustomActionRecord[];
  children: ReactNode;
}) {
  const actions = useMemo(() => actionSetWith(customActions), [customActions]);
  return <ActionSetContext value={actions}>{children}</ActionSetContext>;
}

/** The action set of the company whose workflow is drawn or edited. */
export function useActionSet(): ActionSet {
  return useContext(ActionSetContext);
}
