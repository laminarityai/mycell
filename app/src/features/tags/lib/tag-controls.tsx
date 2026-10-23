"use client";

// React resets a form after its action, even a refused one, so each field starts from what a
// refused form sent (`values`).
import { useActionState, useState } from "react";
import { FormError } from "@/components/form-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { ActionResult } from "@/lib/errors";
import {
  assignTagAction,
  createTagAction,
  deleteTagAction,
  renameTagAction,
  unassignTagAction,
} from "../actions";

type UserOption = { id: string; name: string };

export function CreateTagForm() {
  const [result, create, creating] = useActionState(createTagAction, {});
  return (
    <form action={create} className="flex flex-col gap-1">
      <div className="flex gap-2">
        <Input
          name="name"
          defaultValue={result.values?.name ?? ""}
          required
          maxLength={40}
          placeholder="support-team"
          aria-label="New tag name"
          className="w-48"
        />
        <Button type="submit" size="sm" disabled={creating}>
          Add tag
        </Button>
      </div>
      <FormError message={result.error} />
    </form>
  );
}

/** Rename and delete controls for one tag. */
export function TagNameControls({ tagId, name }: { tagId: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [renameResult, rename, renaming] = useActionState(
    async (previous: ActionResult, form: FormData) => {
      const renamed = await renameTagAction(previous, form);
      if (renamed.error === undefined) setEditing(false);
      return renamed;
    },
    {},
  );
  const [deleteResult, remove, deleting] = useActionState(deleteTagAction, {});
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <form action={rename} className="flex gap-2">
            <input type="hidden" name="tagId" value={tagId} />
            <Input
              name="name"
              defaultValue={renameResult.values?.name ?? name}
              required
              maxLength={40}
              aria-label={`New name for ${name}`}
              className="w-48"
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
      <FormError message={renameResult.error} />
      <FormError message={deleteResult.error} />
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
              <Button
                type="submit"
                variant="ghost"
                size="icon-xs"
                disabled={unassigning}
                aria-label={`Remove tag from ${user.name}`}
                className="text-muted-foreground"
              >
                ×
              </Button>
            </Badge>
          </form>
        ))}
      </div>
      {others.length === 0 ? null : (
        <form action={assign} className="flex gap-2">
          <input type="hidden" name="tagId" value={tagId} />
          <NativeSelect
            name="userId"
            defaultValue={assignResult.values?.userId}
            aria-label="User to tag"
          >
            {others.map((user) => (
              <NativeSelectOption key={user.id} value={user.id}>
                {user.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button type="submit" variant="outline" size="sm" disabled={assigning}>
            Add
          </Button>
        </form>
      )}
      <FormError message={assignResult.error} />
      <FormError message={unassignResult.error} />
    </div>
  );
}
