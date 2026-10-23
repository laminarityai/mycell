"use client";

// What a page shows when something on it fails: the app shell, a retry, and a way to the
// Reviews page. It says nothing of the error, which may quote someone's mail (invariant 8); the
// server logs it.
import type { ErrorInfo } from "next/error";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ShellFrame } from "./_shell/shell-frame";
import { SidebarBody } from "./_shell/sidebar-body";

export default function ErrorPage({ retry }: ErrorInfo) {
  return (
    <ShellFrame
      title="Something went wrong"
      // A client component can't read who's signed in: the items everyone has.
      sidebar={<SidebarBody admin={false} counts={{}} />}
    >
      <p className="text-sm text-muted-foreground">
        This page couldn&apos;t be shown. Try again, or go back to your reviews.
      </p>
      <div className="flex items-center gap-4">
        <Button onClick={retry}>Try again</Button>
        <Link href="/" className="text-sm font-medium underline-offset-4 hover:underline">
          Go to Reviews
        </Link>
      </div>
    </ShellFrame>
  );
}
