"use client";

import { useActionState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { reAddUserAction } from "../actions";
import type { RemovedUser } from "../types";

/** An admin's control for one removed person: re-add them, lifting the block on signing in. */
export function ReAddControl({ removed }: { removed: RemovedUser }) {
  const [result, reAdd, reAdding] = useActionState(reAddUserAction, {});
  return (
    <div className="flex flex-col items-end gap-1">
      <form action={reAdd}>
        <input type="hidden" name="removalId" value={removed.id} />
        <Button type="submit" variant="outline" size="sm" disabled={reAdding}>
          Re-add
        </Button>
      </form>
      <FormError message={result.error} />
    </div>
  );
}
