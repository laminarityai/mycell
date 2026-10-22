"use client";

// PROTOTYPE, throwaway: variant C, a "Health" tab beside "Editor" and "Runs". The editor keeps
// the whole page; status lives in its own tab, which opens first while the workflow is paused
// and carries a dot so a pause is visible from the other tabs.
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateTime } from "@/components/date-time";
import { cn } from "@/lib/utils";
import { RUNS, type RunStatus } from "../_shared/fixtures";
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { EditorPlaceholder, SwitchPlaceholder } from "./editor-mock";
import { RUNS_HREF, WORKFLOW, runHref } from "./fixtures";
import { HealthChecks } from "./health-checks";
import { PAUSE_LABEL, useWorkflowStatus } from "./use-workflow-status";

const STATUS_TEXT: Record<RunStatus, string> = {
  succeeded: "Succeeded",
  failed: "Failed",
  partly_failed: "Partly failed",
  escalated: "Escalated",
  skipped: "Skipped",
  cancelled: "Cancelled",
  running: "Running",
};

export function VariantC({ params }: VariantProps) {
  return <Page key={params.state} state={params.state} />;
}

function Page({ state }: { state: string }) {
  const status = useWorkflowStatus(state);
  const paused = status.effective !== "running";
  const runs = RUNS.filter((r) => r.workflowId === WORKFLOW.id).slice(0, 6);
  return (
    <PrototypeMain wide>
      <PrototypeHeader title="Workflow" admin />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">{WORKFLOW.name}</h2>
        <span className="text-sm text-muted-foreground">Version {WORKFLOW.version}</span>
        {status.effective === "running" ? null : (
          <Badge variant="destructive">{PAUSE_LABEL[status.effective]}</Badge>
        )}
      </div>
      <Tabs defaultValue={paused ? "health" : "editor"}>
        <TabsList variant="line" className="border-b">
          <TabsTrigger value="editor">Editor</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="health">
            Health
            <span
              aria-hidden
              className={cn(
                "size-2 rounded-full",
                !paused
                  ? "bg-emerald-500"
                  : status.effective === "budget_reached"
                    ? "bg-amber-500"
                    : "bg-destructive",
              )}
            />
          </TabsTrigger>
        </TabsList>
        <TabsContent value="editor" className="flex flex-col gap-6 pt-4">
          <EditorPlaceholder className="min-h-[28rem]" />
          <SwitchPlaceholder />
        </TabsContent>
        <TabsContent value="runs" className="flex flex-col gap-3 pt-4">
          <ul className="flex flex-col divide-y rounded-lg border">
            {runs.map((run) => (
              <li
                key={run.id}
                className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2"
              >
                <Link href={runHref(run.id)} className="underline">
                  <DateTime value={run.startedAt} />
                </Link>
                <span className="text-muted-foreground">{run.subject}</span>
                <span>{STATUS_TEXT[run.status]}</span>
                <span className="text-muted-foreground tabular-nums">{run.cost} credits</span>
              </li>
            ))}
          </ul>
          <Link href={RUNS_HREF} className="w-fit underline">
            See all its runs on the Runs page
          </Link>
        </TabsContent>
        <TabsContent value="health" className="max-w-3xl pt-4">
          <HealthChecks status={status} />
        </TabsContent>
      </Tabs>
    </PrototypeMain>
  );
}
