"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { unsubscribeAction } from "../actions";

/**
 * Confirms turning the daily review email off. A button rather than the link alone, so a mail
 * scanner opening the link turns nothing off.
 */
export function UnsubscribeForm({ token }: { token: string }) {
  const [result, action, pending] = useActionState(unsubscribeAction, {});
  if (result.done === true) {
    return (
      <p className="text-sm">
        The daily review email is off. You can switch it back on from your{" "}
        <Link href="/reviews" className="underline underline-offset-4">
          Reviews page
        </Link>
        .
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col items-start gap-3">
      <input type="hidden" name="token" value={token} />
      <p className="text-sm">Stop the daily email listing the reviews waiting for you?</p>
      <Button type="submit" disabled={pending}>
        Turn off the daily email
      </Button>
      {result.error === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {result.error}
        </p>
      )}
    </form>
  );
}
