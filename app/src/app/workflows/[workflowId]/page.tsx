import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { listConversations } from "@/features/builder/server";
import { ConversationList, NewConversationButton } from "@/features/builder/ui";
import { listCustomActions } from "@/features/custom-actions/server";
import { getCtx } from "@/features/orgs/server";
import { listRuns } from "@/features/runtime/server";
import { listTags } from "@/features/tags/server";
import { RecentRuns, RunOnMessageForm } from "@/features/runtime/ui";
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
  const [runs, runnable, conversations, tags, customActions, preview, health] = await Promise.all([
    listRuns(ctx, workflowId),
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
  ]);
  // Only the connections a run could use, the one it's switched on for first.
  const connections = runnable.map((connection) => ({
    id: connection.id,
    label: connection.accountEmail,
  }));
  return (
    // The graph, the step menu and the side panel look actions up in the company's action set.
    <ActionSetProvider customActions={customActions}>
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
          // Its recent runs, until M8's Runs page links in.
          <section className="flex flex-col gap-3" aria-label="Runs">
            <RunOnMessageForm workflowId={workflow.id} connections={connections} />
            <RecentRuns runs={runs} />
          </section>
        }
        health={<WorkflowHealthChecks health={health} />}
      />
    </ActionSetProvider>
  );
}
