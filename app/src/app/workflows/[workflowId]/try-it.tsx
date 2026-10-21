// The workflow page's "Try it" section. It's composed here rather than in `workflows`, which
// runtime imports and so may not import back.
import Link from "next/link";
import { getCtx } from "@/features/orgs/server";
import { tryWorkflowAction } from "@/features/runtime/actions";
import { recentMessages } from "@/features/runtime/server";
import { TryItPanel } from "@/features/runtime/ui";
import { getWorkflow } from "@/features/workflows/server";
import { NotFoundError } from "@/lib/errors";

/**
 * Try the working spec on a recent message. The picker reads the inboxes only once the admin
 * asks for it (`?try`), so opening the page fetches no mail.
 */
export async function TryIt({ params, searchParams }: PageProps<"/workflows/[workflowId]">) {
  const ctx = await getCtx();
  if (ctx.role !== "admin") return null;
  const { workflowId } = await params;
  const open = (await searchParams).try !== undefined;
  const workflow = await getWorkflow(ctx, workflowId).catch((error: unknown) => {
    if (error instanceof NotFoundError) return null;
    throw error;
  });
  if (workflow === null) return null;
  return (
    <section className="flex flex-col gap-3" aria-label="Try it">
      <h2 className="text-lg font-semibold">Try it</h2>
      {open ? (
        <TryItPanel
          sources={await recentMessages(ctx, workflow.workingSpec.credentials)}
          action={tryWorkflowAction}
          fields={{ workflowId }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          See what the working spec would do with one recent message, writing nothing.{" "}
          <Link href={`/workflows/${workflowId}?try=1`} className="underline">
            Choose a message
          </Link>
        </p>
      )}
    </section>
  );
}
