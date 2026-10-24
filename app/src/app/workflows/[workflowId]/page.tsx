import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { listConversations } from "@/features/builder/server";
import { ConversationList, NewConversationButton } from "@/features/builder/ui";
import { listCustomActions } from "@/features/custom-actions/server";
import { getCtx } from "@/features/orgs/server";
import { listRuns, pausingRuns } from "@/features/runtime/server";
import { triggers } from "@/features/spec/triggers";
import { listTags } from "@/features/tags/server";
import { RunOnMessageForm, RunsTable, runsHref } from "@/features/runtime/ui";
import {
  getWorkflow,
  getWorkflowHealth,
  previewPublish,
  runnableConnections,
} from "@/features/workflows/server";
import {
  ActionSetProvider,
  GraphTraceProvider,
  WorkflowArchiveSection,
  WorkflowEditor,
  WorkflowHealthChecks,
  WorkflowSwitchSection,
  WorkflowTabs,
} from "@/features/workflows/ui";
import { isAdmin } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { TryIt } from "./try-it";
import { AppShell } from "@/app/_shell/app-shell";

/** How many of its latest runs the workflow's page shows; the Runs page has the rest. */
const RECENT_RUNS = 10;

// A Server Action here may try the working spec on a message, model steps and all.
export const maxDuration = 300;

export default function WorkflowPage({
  params,
  searchParams,
}: PageProps<"/workflows/[workflowId]">) {
  return (
    <AppShell current="workflows" title="Workflow" width="wide">
      {/* Try it lights up the steps it ran and the paths it took on the workflow's graph. */}
      <GraphTraceProvider>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading workflow…</p>}>
          <Workflow
            params={params}
            tryIt={
              <Suspense
                fallback={<p className="text-sm text-muted-foreground">Loading recent mail…</p>}
              >
                <TryIt params={params} searchParams={searchParams} />
              </Suspense>
            }
          />
        </Suspense>
      </GraphTraceProvider>
    </AppShell>
  );
}

async function Workflow({
  params,
  tryIt,
}: Pick<PageProps<"/workflows/[workflowId]">, "params"> & { tryIt: ReactNode }) {
  const ctx = await getCtx();
  if (!isAdmin(ctx)) redirect("/");
  const { workflowId } = await params;
  const workflow = await getWorkflow(ctx, workflowId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const [runs, runnable, conversations, tags, customActions, preview, health, paused] =
    await Promise.all([
      listRuns(ctx, { workflowId }, { size: RECENT_RUNS }),
      runnableConnections(ctx, workflowId),
      listConversations(ctx, { workflowId }),
      listTags(ctx),
      listCustomActions(ctx),
      // What publishing would pause; nothing to say when there's nothing new to publish, or the
      // policy refuses the working spec (publishing says why).
      workflow.unpublishedChanges && workflow.maxRisk !== null
        ? previewPublish(ctx, workflowId, workflow.workingSpec)
        : null,
      getWorkflowHealth(ctx, workflowId),
      // The runs that paused it for failing, if they did.
      pausingRuns(ctx, workflow.failurePause?.runIds ?? []),
    ]);
  // Only the connections a run could use, the one it's switched on for first.
  const connections = runnable.map((connection) => ({
    id: connection.id,
    label: connection.accountEmail,
  }));
  return (
    // The graph, the step menu and the side panel look actions up in the company's action set.
    <ActionSetProvider customActions={customActions}>
      {/* It opens on Health while anything stops it, failing included: what paused it and
          Resume lead the page then. */}
      <WorkflowTabs
        paused={health.status === "paused"}
        editor={
          <>
            <WorkflowEditor
              workflow={workflow}
              tags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
              preview={preview}
            />
            {tryIt}
            <WorkflowSwitchSection workflow={workflow} connections={connections} />
            {workflow.versions.length > 0 ? <WorkflowArchiveSection workflow={workflow} /> : null}
            <section className="flex flex-col gap-3" aria-label="Builder conversations">
              <h2 className="text-lg font-semibold">Builder conversations</h2>
              <p className="text-sm text-muted-foreground">
                Ask the builder to change this workflow, or continue a conversation about it.
              </p>
              <ConversationList conversations={conversations} />
              <NewConversationButton workflowId={workflow.id} />
            </section>
          </>
        }
        runs={
          <section className="flex flex-col gap-3" aria-label="Runs">
            <RunOnMessageForm
              workflowId={workflow.id}
              connections={connections}
              item={triggers[workflow.workingSpec.trigger.type].item}
            />
            {runs.runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs yet.</p>
            ) : (
              <>
                <RunsTable runs={runs.runs} showInbox />
                <Link
                  href={runsHref({ workflowId: workflow.id })}
                  className="text-sm font-medium underline-offset-4 hover:underline"
                >
                  See every run of this workflow
                </Link>
              </>
            )}
          </section>
        }
        health={<WorkflowHealthChecks health={health} pausingRuns={paused} />}
      />
    </ActionSetProvider>
  );
}
