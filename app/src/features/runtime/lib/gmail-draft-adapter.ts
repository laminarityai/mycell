// The Gmail drafts adapter, the first pending form (ADR-0013): a run's reply waits as a draft in
// the person's own Gmail. Approving sends it (after replacing its text, when the person edited
// it), declining deletes it, and the person may also send or delete it in Gmail themselves.
// Every call goes through the Nango proxy with the caller's ctx; the draft's and the message's
// text are held in memory only (invariant 8).
import { z } from "zod";
import { proxyDelete, proxyGet, proxyPost, proxyPut } from "@/features/connections/server";
import type { Ctx } from "@/lib/ctx";
import { fullMessageSchema, GMAIL, mailOf } from "./gmail";
import { createReplyDraft, editedMessage } from "./gmail-drafts";
import { ItemGoneError } from "@/lib/errors";
import type { PendingFormAdapter, PendingItem } from "./pending-forms";
import type { Compose } from "./step-context";

/** What the create-draft action hands `prepare`: the message to reply to, and the step's text. */
export type ReplyDraftInput = {
  connectionId: string;
  messageId: string;
  /** The run and step making it (`<runId>/<stepId>`), so a retry finds its earlier draft. */
  marker: string;
  compose?: Compose;
};

const draftSchema = z.object({ id: z.string(), message: fullMessageSchema });
const draftRefSchema = z.object({ id: z.string() });
const sentSchema = z.object({ id: z.string(), threadId: z.string() });
const threadSchema = z.object({
  messages: z
    .array(
      z.object({
        labelIds: z.array(z.string()).default([]),
        internalDate: z.string().optional(),
      }),
    )
    .default([]),
});

export const gmailDraftAdapter: PendingFormAdapter<ReplyDraftInput> = {
  // M3's create-draft: a reply in the message's thread, made once per run step.
  async prepare(ctx, input) {
    const { draftId, threadId } = await createReplyDraft(
      ctx,
      input.connectionId,
      { messageId: input.messageId },
      input.marker,
      input.compose,
    );
    return { itemRef: draftId, threadRef: threadId };
  },

  // drafts.update with the edited text (only when edited), then drafts.send.
  async approve(ctx, item, edits) {
    if (edits !== undefined) {
      const draft = await draftOf(ctx, item, "full");
      if (draft === null) throw new ItemGoneError();
      const raw = editedMessage(draft.message.payload?.headers ?? [], edits.text);
      const message = { raw, threadId: item.threadRef };
      gone(await proxyPut(ctx, item.connectionId, draftPath(item), { message }, draftRefSchema));
    }
    gone(
      await proxyPost(
        ctx,
        item.connectionId,
        `${GMAIL}/drafts/send`,
        { id: item.itemRef },
        sentSchema,
      ),
    );
  },

  // drafts.delete.
  async decline(ctx, item) {
    if (!(await proxyDelete(ctx, item.connectionId, draftPath(item)))) throw new ItemGoneError();
  },

  // The draft still there is waiting; without it, a message sent in its thread since the review
  // began means the person sent it from Gmail, and nothing means they deleted it.
  async check(ctx, item) {
    if ((await draftOf(ctx, item, "minimal")) !== null) return "waiting";
    const thread = await proxyGet(
      ctx,
      item.connectionId,
      `${GMAIL}/threads/${encodeURIComponent(item.threadRef)}?format=minimal`,
      threadSchema,
    );
    const since = item.createdAt.getTime();
    const sent = (thread?.messages ?? []).some(
      (message) => message.labelIds.includes("SENT") && Number(message.internalDate ?? 0) >= since,
    );
    return sent ? "done_in_app" : "gone";
  },

  // The draft, and the message that started the run, which it replies to.
  async view(ctx, item) {
    const draft = await draftOf(ctx, item, "full");
    if (draft === null) throw new ItemGoneError();
    const message = await proxyGet(
      ctx,
      item.connectionId,
      `${GMAIL}/messages/${encodeURIComponent(item.sourceRef)}?format=full`,
      fullMessageSchema,
    );
    return {
      kind: "draft",
      message: message === null ? null : mailOf(message),
      draft: mailOf(draft.message),
    };
  },
};

function draftPath(item: PendingItem): string {
  return `${GMAIL}/drafts/${encodeURIComponent(item.itemRef)}`;
}

async function draftOf(ctx: Ctx, item: PendingItem, format: "full" | "minimal") {
  return proxyGet(ctx, item.connectionId, `${draftPath(item)}?format=${format}`, draftSchema);
}

function gone<T>(answer: T | null): T {
  if (answer === null) throw new ItemGoneError();
  return answer;
}
