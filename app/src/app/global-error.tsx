"use client";

// What Mycel shows when even its root layout fails. It replaces that layout, so it brings its
// own document and styles. Like the error page, it says nothing of the error (invariant 8).
import type { ErrorInfo } from "next/error";
import { Button } from "@/components/ui/button";
import "./globals.css";

export default function GlobalError({ retry }: ErrorInfo) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <title>Something went wrong · Mycel</title>
        <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
          <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            Mycel couldn&apos;t be shown. Try again, or reload the page in a moment.
          </p>
          <div>
            <Button onClick={retry}>Try again</Button>
          </div>
        </main>
      </body>
    </html>
  );
}
