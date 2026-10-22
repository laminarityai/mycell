// What Mycel shows for an address with nothing at it, or for something that isn't in the
// person's org (`notFound()`), with the nav and a way to the Reviews page.
import Link from "next/link";
import { AppNav } from "./app-nav";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <AppNav />
      </header>
      <p className="text-sm text-muted-foreground">
        There&apos;s nothing here. It may have been deleted, or the link may be wrong.
      </p>
      <Link href="/" className="text-sm font-medium underline-offset-4 hover:underline">
        Go to Reviews
      </Link>
    </main>
  );
}
