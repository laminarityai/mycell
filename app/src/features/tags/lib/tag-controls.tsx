"use client";

import { useActionState, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/errors";
import {
  assignTagAction,
  createTagAction,
  deleteTagAction,
  renameTagAction,
  unassignTagAction,
} from "../actions";

const fieldClass =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type UserOption = { id: string; name: string };

export function CreateTagForm() {
  const [result, create, creating] = useActionState(createTagAction, {});
  return (
    <form action={create} className="flex flex-col gap-1">
      <div className="flex gap-2">
        <input
          name="name"
          required
          maxLength={40}
          placeholder="support-team"
          aria-label="New tag name"
          className={fieldClass}
        />
        <Button type="submit" size="sm" disabled={creating}>
          Add tag
        </Button>
      </div>
      <ErrorMessage result={result} />
    </form>
  );
}

/** Rename and delete controls for one tag. */
export function TagNameControls({ tagId, name }: { tagId: string; name: string }) {
  const [renameResult, rename, renaming] = useActionState(renameTagAction, {});
  const [deleteResult, remove, deleting] = useActionState(deleteTagAction, {});
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <form action={rename} className="flex gap-2">
            <input type="hidden" name="tagId" value={tagId} />
            <input
              name="name"
              defaultValue={name}
              required
              maxLength={40}
              aria-label={`New name for ${name}`}
              className={fieldClass}
            />
            <Button type="submit" size="sm" disabled={renaming}>
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <>
            <span className="font-medium">{name}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(true);
              }}
            >
              Rename
            </Button>
          </>
        )}
        {confirmingDelete ? (
          <form action={remove} className="flex gap-2">
            <input type="hidden" name="tagId" value={tagId} />
            <Button type="submit" variant="destructive" size="sm" disabled={deleting}>
              Confirm delete
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setConfirmingDelete(false);
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setConfirmingDelete(true);
            }}
          >
            Delete
          </Button>
        )}
      </div>
      <ErrorMessage result={renameResult} />
      <ErrorMessage result={deleteResult} />
    </div>
  );
}

/** The users who have a tag, each removable, plus a picker to add another. */
export function TagUsersControls({
  tagId,
  holders,
  others,
}: {
  tagId: string;
  holders: UserOption[];
  others: UserOption[];
}) {
  const [assignResult, assign, assigning] = useActionState(assignTagAction, {});
  const [unassignResult, unassign, unassigning] = useActionState(unassignTagAction, {});

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {holders.map((user) => (
          <form key={user.id} action={unassign}>
            <input type="hidden" name="tagId" value={tagId} />
            <input type="hidden" name="userId" value={user.id} />
            <Badge variant="secondary" className="gap-1 pr-1">
              {user.name}
              <button
                type="submit"
                disabled={unassigning}
                aria-label={`Remove tag from ${user.name}`}
                className="rounded px-1 text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </Badge>
          </form>
        ))}
      </div>
      {others.length === 0 ? null : (
        <form action={assign} className="flex gap-2">
          <input type="hidden" name="tagId" value={tagId} />
          <select name="userId" aria-label="User to tag" className={fieldClass}>
            {others.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline" size="sm" disabled={assigning}>
            Add
          </Button>
        </form>
      )}
      <ErrorMessage result={assignResult} />
      <ErrorMessage result={unassignResult} />
    </div>
  );
}

function ErrorMessage({ result }: { result: ActionResult }) {
  return result.error === undefined ? null : (
    <p role="alert" className="text-sm text-destructive">
      {result.error}
    </p>
  );
}
