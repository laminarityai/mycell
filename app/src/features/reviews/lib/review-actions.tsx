"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/errors";
import { approveReviewAction, declineReviewAction } from "../actions";

/**
 * What a person does with an open review: approve the draft as it is, edit it and approve the
 * edit, or decline it. The edited text goes to the Server Action and on to Gmail; it's never
 * stored.
 */
export function ReviewActions({ reviewId, draftText }: { reviewId: string; draftText: string }) {
  const [approveResult, approve, approving] = useActionState(approveReviewAction, {});
  const [declineResult, decline, declining] = useActionState(declineReviewAction, {});
  const [editing, setEditing] = useState(false);
  const busy = approving || declining;

  if (editing) {
    return (
      <form action={approve} className="flex flex-col gap-3">
        <input type="hidden" name="reviewId" value={reviewId} />
        <label className="flex flex-col gap-1 text-sm font-medium">
          Your reply
          <Textarea name="text" defaultValue={draftText} rows={10} required />
        </label>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            Send edited reply
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
        <Problem result={approveResult} />
      </form>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <form action={approve}>
          <input type="hidden" name="reviewId" value={reviewId} />
          <Button type="submit" disabled={busy}>
            Approve and send
          </Button>
        </form>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setEditing(true);
          }}
        >
          Edit
        </Button>
        <form action={decline}>
          <input type="hidden" name="reviewId" value={reviewId} />
          <Button type="submit" variant="outline" disabled={busy}>
            Decline
          </Button>
        </form>
      </div>
      <Problem result={approveResult} />
      <Problem result={declineResult} />
    </div>
  );
}

function Problem({ result }: { result: ActionResult }) {
  if (result.error === undefined) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {result.error}
    </p>
  );
}
