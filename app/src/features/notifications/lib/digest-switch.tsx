"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { setReviewDigestAction } from "../actions";

/** The caller's switch for the daily email listing their waiting reviews. */
export function ReviewDigestSwitch({ on }: { on: boolean }) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function change(checked: boolean) {
    startTransition(async () => {
      setError((await setReviewDigestAction(checked)).error);
    });
  }

  return (
    <div className="flex flex-col gap-1 text-sm">
      <label className="flex items-center gap-2">
        <Switch checked={on} onCheckedChange={change} disabled={pending} />
        Email me each day when reviews are waiting
      </label>
      {error === undefined ? null : (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
