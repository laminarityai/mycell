import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { listConversations } from "@/features/builder/server";
import { ConversationList, NewConversationButton } from "@/features/builder/ui";
import { getCtx } from "@/features/orgs/server";
import { listRuns } from "@/features/runtime/server";
import { triggers } from "@/features/spec/triggers";
import { listTags } from "@/features/tags/server";
import { RecentRuns, RunOnMessageForm } from "@/features/runtime/ui";
import { getWorkflow, previewPublish, runnableConnections } from "@/features/workflows/server";
import {
  GraphTraceProvider,
  WorkflowArchiveSection,
  WorkflowEditor,
  WorkflowSwitchSection,
} from "@/features/workflows/ui";
import { NotFoundError } from "@/lib/errors";
import { TryIt } from "./try-it";
import { AppNav } from "@/app/app-nav";

// A Server Action here may try the working spec on a message, model steps and all.
export const maxDuration = 300;

export default function WorkflowPage({
  params,
  searchParams,
}: PageProps<"/workflows/[workflowId]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Workflow</h1>
        <AppNav />
      </header>
      {/* Try it lights up the steps it ran and the paths it took on the workflow's graph. */}
      <GraphTraceProvider>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading workflow…</p>}>
          <Workflow params={params} />
        </Suspense>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading recent mail…</p>}>
          <TryIt params={params} searchParams={searchParams} />
        </Suspense>
      </GraphTraceProvider>
    </main>
  );
}

async function Workflow({ params }: Pick<PageProps<"/workflows/[workflowId]">, "params">) {
  const ctx = await getCtx();
  if (ctx.role !== "admin") redirect("/");
  const { workflowId } = await params;
  const workflow = await getWorkflow(ctx, workflowId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const [runs, runnable, conversations, tags, preview] = await Promise.all([
    listRuns(ctx, workflowId),
    runnableConnections(ctx, workflowId),
    listConversations(ctx, { workflowId }),
    listTags(ctx),
    // What publishing would pause; nothing to say when there's nothing new to publish, or the
    // policy refuses the working spec (publishing says why).
    workflow.unpublishedChanges && workflow.maxRisk !== null
      ? previewPublish(ctx, workflowId, workflow.workingSpec)
      : null,
  ]);
  // Only the connections a run could use, the one it's switched on for first.
  const connections = runnable.map((connection) => ({
    id: connection.id,
    label: connection.accountEmail,
  }));
  return (
    <div className="flex flex-col gap-8">
      <WorkflowEditor
        workflow={workflow}
        tags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
        preview={preview}
      />
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
      <section className="flex flex-col gap-3" aria-label="Runs">
        <h2 className="text-lg font-semibold">Runs</h2>
        <RunOnMessageForm
          workflowId={workflow.id}
          connections={connections}
          item={triggers[workflow.workingSpec.trigger.type].item}
        />
        <RecentRuns runs={runs} />
      </section>
    </div>
  );
}
