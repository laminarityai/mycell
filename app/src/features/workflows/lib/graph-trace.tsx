"use client";

// The Try it a page's workflow graph lights up. The page wraps its graph and its Try it panel
// in the provider; the panel, which lives in `runtime`, shows each result here, and the graph
// reads it. A page without a graph has no provider, and the panel shows the paths itself.
import { createContext, useContext, useState, type ReactNode } from "react";
import type { GraphTrace } from "@/features/spec/graph";

type GraphTraceState = {
  trace: GraphTrace | null;
  show: (trace: GraphTrace | null) => void;
};

const GraphTraceContext = createContext<GraphTraceState | null>(null);

export function GraphTraceProvider({ children }: { children: ReactNode }) {
  const [trace, show] = useState<GraphTrace | null>(null);
  return <GraphTraceContext value={{ trace, show }}>{children}</GraphTraceContext>;
}

/** The Try it to light up on the graph, if any. */
export function useGraphTrace(): GraphTrace | null {
  return useContext(GraphTraceContext)?.trace ?? null;
}

/** Shows a Try it on the page's graph; null on a page that draws none. */
export function useShowOnGraph(): ((trace: GraphTrace | null) => void) | null {
  return useContext(GraphTraceContext)?.show ?? null;
}
