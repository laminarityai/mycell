"use client";

// PROTOTYPE, throwaway: the run page's controls every variant places its own way: Retry (a stub
// that starts r-2001), the real workflow graph lit with the run's path, and what a member sees
// when the run isn't theirs.
import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { GraphTrace } from "@/features/spec/graph";
import type { Spec } from "@/features/spec/types";
import { WorkflowGraph } from "@/features/workflows/ui";
import { cn } from "@/lib/utils";
import type { RunView } from "./run-view";

export function RetryButton({
  retry,
  latestVersion,
  showWhy = true,
  className,
}: {
  retry: RunView["retry"];
  latestVersion: number;
  showWhy?: boolean;
  className?: string;
}) {
  const [started, setStarted] = useState(false);
  if (started) {
    return (
      <p className={cn("text-sm", className)} role="status">
        Retry started:{" "}
        <Link href="/prototype/run?run=succeeded" className="font-medium underline">
          r-2001
        </Link>
        . It runs version {latestVersion} on the same message.
      </p>
    );
  }
  if (!retry.allowed && retry.hide === true) {
    return <p className={cn("text-xs text-muted-foreground", className)}>{retry.why}</p>;
  }
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Button
        disabled={!retry.allowed}
        onClick={() => {
          setStarted(true);
        }}
        className="w-fit"
      >
        <RotateCcw /> Retry
      </Button>
      {!retry.allowed && showWhy ? (
        <p className="text-xs text-muted-foreground">{retry.why}</p>
      ) : null}
    </div>
  );
}

/** The real workflow graph, the run's path lit as Try it lights one. */
export function RunGraph({
  spec,
  trace,
  fill = false,
  className,
  children,
}: {
  spec: Spec;
  trace: GraphTrace;
  fill?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <WorkflowGraph spec={spec} trace={trace} fill={fill} className={className}>
      {children}
    </WorkflowGraph>
  );
}

export function NotYours({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed p-8 text-center">
      <p className="font-medium">This run isn&apos;t yours to see</p>
      <p className="text-sm text-muted-foreground">
        It ran on a colleague&apos;s inbox. You see the runs on your own inbox in{" "}
        <Link href="/prototype/runs?as=member" className="underline">
          Runs
        </Link>
        .
      </p>
      {children}
    </div>
  );
}
