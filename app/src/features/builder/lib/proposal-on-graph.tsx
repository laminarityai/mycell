"use client";

// Which waiting proposal the builder page draws on its graph. The newest waiting proposal is
// drawn when it arrives; its card shows or hides it, and can show an older one instead. A Try it
// takes the graph over, and showing a proposal again, or a new one arriving (the workspace's
// GraphTraceProvider), puts the Try it away.
import { createContext, useContext, useState, type ReactNode } from "react";
import { useGraphTrace, useShowOnGraph } from "@/features/workflows/ui";
import type { Proposal } from "../types";

type ProposalOnGraph = {
  /** The proposal drawn on the graph; null when the graph draws the working spec. */
  drawn: Proposal | null;
  /** Shows a waiting proposal on the graph, or hides it. */
  show: (proposalId: string, shown: boolean) => void;
};

const ProposalOnGraphContext = createContext<ProposalOnGraph | null>(null);

type Choice = { proposalId: string; shown: boolean };

export function ProposalOnGraphProvider({
  proposals,
  children,
}: {
  proposals: Proposal[];
  children: ReactNode;
}) {
  const trace = useGraphTrace();
  const showTrace = useShowOnGraph();
  const waiting = proposals.filter((proposal) => proposal.status === "proposed");
  const newest = waiting.at(-1);

  // The admin's last show or hide, until a newer proposal arrives.
  const [choice, setChoice] = useState<Choice | null>(null);
  const [seen, setSeen] = useState(newest?.id);
  if (newest?.id !== seen) {
    setSeen(newest?.id);
    setChoice(null);
  }
  const chosen = choice?.shown ? waiting.find((p) => p.id === choice.proposalId) : undefined;
  const newestHidden = choice !== null && !choice.shown && choice.proposalId === newest?.id;
  const candidate = chosen ?? (newestHidden ? undefined : newest);
  const drawn = trace === null ? (candidate ?? null) : null;

  const show = (proposalId: string, shown: boolean) => {
    setChoice({ proposalId, shown });
    if (shown) showTrace?.(null);
  };
  return <ProposalOnGraphContext value={{ drawn, show }}>{children}</ProposalOnGraphContext>;
}

/** The proposal the graph draws, and showing or hiding one; null on a page with no graph. */
export function useProposalOnGraph(): ProposalOnGraph | null {
  return useContext(ProposalOnGraphContext);
}
