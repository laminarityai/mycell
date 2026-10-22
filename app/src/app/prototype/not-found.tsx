// PROTOTYPE, throwaway: a plain not-found for prototype routes, so they never render the real
// one, whose nav reads who's signed in (and so redirects to sign-in, with no session here).
import Link from "next/link";

export default function PrototypeNotFound() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <p>
        No such prototype. <Link href="/prototype">All prototypes</Link>
      </p>
    </main>
  );
}
