// What Mycel shows for an address with nothing at it, or for something that isn't in the
// person's org (`notFound()`), inside the app shell and with a way to the Reviews page. It
// draws without a session too, with the items everyone has.
import Link from "next/link";
import { AppShell } from "./_shell/app-shell";

export default function NotFound() {
  return (
    <AppShell title="Page not found" signedOut="allow">
      <p className="text-sm text-muted-foreground">
        There&apos;s nothing here. It may have been deleted, or the link may be wrong.
      </p>
      <Link href="/" className="text-sm font-medium underline-offset-4 hover:underline">
        Go to Reviews
      </Link>
    </AppShell>
  );
}
