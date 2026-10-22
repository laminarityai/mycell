// PROTOTYPE, throwaway (branch prototype/v1-views): throwaway UI variants for the v1 milestones
// (M11, M7, M8, M9), on fixture data with no sign-in or database. Never in production.
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { env } from "@/env";

export default function PrototypeLayout({ children }: { children: ReactNode }) {
  if (env.NODE_ENV === "production") notFound();
  return (
    <>
      <div className="bg-fuchsia-700 px-4 py-0.5 text-center text-xs font-medium text-white">
        PROTOTYPE · throwaway · fixture data · branch prototype/v1-views
      </div>
      {children}
    </>
  );
}
