"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/errors";
import { removeUserAction, setRoleAction } from "../actions";
import type { OrgUser } from "../types";

/** An admin's controls for one user of the org: change their role, or remove them. */
export function UserControls({ user }: { user: OrgUser }) {
  const [roleResult, changeRole, changingRole] = useActionState(setRoleAction, {});
  const [removeResult, remove, removing] = useActionState(removeUserAction, {});
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const error = firstError(roleResult, removeResult);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <form action={changeRole}>
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="role" value={user.role === "admin" ? "member" : "admin"} />
          <Button type="submit" variant="outline" size="sm" disabled={changingRole}>
            {user.role === "admin" ? "Make member" : "Make admin"}
          </Button>
        </form>
        {confirmingRemove ? (
          <form action={remove} className="flex gap-2">
            <input type="hidden" name="userId" value={user.id} />
            <Button type="submit" variant="destructive" size="sm" disabled={removing}>
              Confirm remove
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setConfirmingRemove(false);
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setConfirmingRemove(true);
            }}
          >
            Remove
          </Button>
        )}
      </div>
      {error === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function firstError(...results: ActionResult[]): string | undefined {
  return results.find((result) => result.error !== undefined)?.error;
}
