"use client";

// What a page shows when something on it fails: the nav, a retry, and a way to the Reviews page.
// It says nothing of the error, which may quote someone's mail (invariant 8); the server logs it.
import type { ErrorInfo } from "next/error";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { NAV_CLASS, NavLinks } from "./nav-links";

export default function ErrorPage({ retry }: ErrorInfo) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
        {/* A client component can't read who's signed in: the links everyone has. */}
        <nav aria-label="Main" className={NAV_CLASS}>
          <NavLinks waiting={0} admin={false} />
        </nav>
      </header>
      <p className="text-sm text-muted-foreground">
        This page couldn&apos;t be shown. Try again, or go back to your reviews.
      </p>
      <div className="flex items-center gap-4">
        <Button onClick={retry}>Try again</Button>
        <Link href="/" className="text-sm font-medium underline-offset-4 hover:underline">
          Go to Reviews
        </Link>
      </div>
    </main>
  );
}
