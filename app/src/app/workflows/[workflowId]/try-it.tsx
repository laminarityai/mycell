// The workflow page's "Try it" section. It's composed here rather than in `workflows`, which
// runtime imports and so may not import back.
import Link from "next/link";
import { getCtx } from "@/features/orgs/server";
import { tryWorkflowAction } from "@/features/runtime/actions";
import { recentInvites, recentMessages } from "@/features/runtime/server";
import { TryItPanel } from "@/features/runtime/ui";
import { triggers } from "@/features/spec/triggers";
import { getWorkflow } from "@/features/workflows/server";
import { NotFoundError } from "@/lib/errors";

/**
 * Try the working spec on a recent message, or invite when it starts on one. The picker reads
 * the inboxes (or calendars) only once the admin asks for it (`?try`), so opening the page
 * fetches no mail.
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
  const { credentials, trigger } = workflow.workingSpec;
  const { item } = triggers[trigger.type];
  return (
    <section className="flex flex-col gap-3" aria-label="Try it">
      <h2 className="text-lg font-semibold">Try it</h2>
      {open ? (
        <TryItPanel
          sources={
            item === "invite"
              ? await recentInvites(ctx, credentials)
              : await recentMessages(ctx, credentials)
          }
          item={item}
          action={tryWorkflowAction}
          fields={{ workflowId }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          See what the working spec would do with one recent {item}, writing nothing.{" "}
          <Link href={`/workflows/${workflowId}?try=1`} className="underline">
            Choose {item === "invite" ? "an invite" : "a message"}
          </Link>
        </p>
      )}
    </section>
  );
}
