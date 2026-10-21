// PROTOTYPE, never merge. A throwaway page for M12's workflow graph: mock data in memory, no
// database, no model, no sign-in. See `features/prototype-workflow-graph/`.
import type { Metadata } from "next";
import { Suspense } from "react";
import { PrototypePage } from "@/features/prototype-workflow-graph/prototype-page";

export const metadata: Metadata = { title: "Workflow graph (prototype)" };

export default function Page() {
  return (
    <Suspense
      fallback={<p className="p-6 text-sm text-muted-foreground">Loading the prototype…</p>}
    >
      <PrototypePage />
    </Suspense>
  );
}
