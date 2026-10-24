"use client";

import { useActionState, useState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { HeldSendField } from "@/features/runtime/adapters";
import {
  approveReviewAction,
  declineReviewAction,
  handOffReviewAction,
  markDoneAction,
} from "../actions";
import type { ReviewPerson } from "../types";

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
          {/* React resets the form after its action: a refused send starts from what it sent. */}
          <Textarea
            name="text"
            defaultValue={approveResult.values?.text ?? draftText}
            rows={10}
            required
          />
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
        <FormError message={approveResult.error} />
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
      <FormError message={approveResult.error} />
      <FormError message={declineResult.error} />
    </div>
  );
}

/**
 * What a person does with an open held send: approve it as it is, edit its editable fields and
 * approve the edit, or decline it. Each edited field goes to the Server Action as
 * `field:<name>`, and on to the app; it's never stored.
 */
export function HeldSendActions({
  reviewId,
  fields,
}: {
  reviewId: string;
  fields: HeldSendField[];
}) {
  const [approveResult, approve, approving] = useActionState(approveReviewAction, {});
  const [declineResult, decline, declining] = useActionState(declineReviewAction, {});
  const [editing, setEditing] = useState(false);
  const busy = approving || declining;
  const editable = fields.filter((field) => field.editable);

  if (editing) {
    return (
      <form action={approve} className="flex flex-col gap-3">
        <input type="hidden" name="reviewId" value={reviewId} />
        {editable.map((field) => (
          <label key={field.name} className="flex flex-col gap-1 text-sm font-medium">
            {field.description}
            {/* React resets the form after its action: a refused send starts from what it sent. */}
            <Textarea
              name={`field:${field.name}`}
              defaultValue={approveResult.values?.[`field:${field.name}`] ?? field.value}
              rows={6}
              required
            />
          </label>
        ))}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            Send edited request
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
        <FormError message={approveResult.error} />
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
        {editable.length === 0 ? null : (
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
        )}
        <form action={decline}>
          <input type="hidden" name="reviewId" value={reviewId} />
          <Button type="submit" variant="outline" disabled={busy}>
            Decline
          </Button>
        </form>
      </div>
      <FormError message={approveResult.error} />
      <FormError message={declineResult.error} />
    </div>
  );
}

/** What a person does with open suggested edits: accept them all, or reject them all. */
export function SuggestedEditsActions({ reviewId }: { reviewId: string }) {
  const [approveResult, approve, approving] = useActionState(approveReviewAction, {});
  const [declineResult, decline, declining] = useActionState(declineReviewAction, {});
  const busy = approving || declining;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <form action={approve}>
          <input type="hidden" name="reviewId" value={reviewId} />
          <Button type="submit" disabled={busy}>
            Accept the suggestions
          </Button>
        </form>
        <form action={decline}>
          <input type="hidden" name="reviewId" value={reviewId} />
          <Button type="submit" variant="outline" disabled={busy}>
            Reject them
          </Button>
        </form>
      </div>
      <FormError message={approveResult.error} />
      <FormError message={declineResult.error} />
    </div>
  );
}

/** What a person does with an open escalation: mark it done once they've handled the message. */
export function EscalationActions({ reviewId }: { reviewId: string }) {
  const [result, done, marking] = useActionState(markDoneAction, {});
  return (
    <div className="flex flex-col gap-2">
      <form action={done}>
        <input type="hidden" name="reviewId" value={reviewId} />
        <Button type="submit" disabled={marking}>
          Done
        </Button>
      </form>
      <FormError message={result.error} />
    </div>
  );
}

/** Handing the review to a colleague, chosen from those the caller may hand it to. */
export function HandOffForm({
  reviewId,
  colleagues,
}: {
  reviewId: string;
  colleagues: ReviewPerson[];
}) {
  const [result, hand, handing] = useActionState(handOffReviewAction, {});
  return (
    <form action={hand} className="flex flex-col gap-2 border-t pt-4">
      <input type="hidden" name="reviewId" value={reviewId} />
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Hand it to
          <NativeSelect
            name="toUserId"
            required
            defaultValue={result.values?.toUserId ?? ""}
            className="w-full"
          >
            <NativeSelectOption value="" disabled>
              Choose a colleague…
            </NativeSelectOption>
            {colleagues.map((colleague) => (
              <NativeSelectOption key={colleague.id} value={colleague.id}>
                {colleague.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <Button type="submit" variant="outline" disabled={handing}>
          Hand on
        </Button>
      </div>
      <FormError message={result.error} />
    </form>
  );
}

/**
 * What a person does with an open meeting: approve it, which invites its guests, or decline it,
 * which deletes the event. The meeting itself is changed, if at all, in Calendar.
 */
export function MeetingActions({ reviewId }: { reviewId: string }) {
  const [approveResult, approve, approving] = useActionState(approveReviewAction, {});
  const [declineResult, decline, declining] = useActionState(declineReviewAction, {});
  const busy = approving || declining;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <form action={approve}>
          <input type="hidden" name="reviewId" value={reviewId} />
          <Button type="submit" disabled={busy}>
            Approve and invite
          </Button>
        </form>
        <form action={decline}>
          <input type="hidden" name="reviewId" value={reviewId} />
          <Button type="submit" variant="outline" disabled={busy}>
            Decline and delete
          </Button>
        </form>
      </div>
      <FormError message={approveResult.error} />
      <FormError message={declineResult.error} />
    </div>
  );
}
