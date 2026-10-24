"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

// The demo console's own sections. They stay out of the main sidebar, since none of it is real.
const sections = [
  ["Dashboard", "/demo"],
  ["Teams & Access", "/demo/teams"],
  ["Agents", "/demo/agents"],
  ["Models & Providers", "/demo/models"],
  ["Bring your own key", "/demo/keys"],
  ["Routing", "/demo/routing"],
  ["Logs", "/demo/logs"],
  ["Billing", "/demo/billing"],
  ["Chat", "/demo/messages"],
] as const;

export function DemoNav() {
  const pathname = usePathname();
  return (
    <div className="space-y-3">
      <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
        Demo console with sample data for a 52-person company. Nothing here reads or changes your
        org.
      </p>
      <nav aria-label="Demo sections" className="flex flex-wrap gap-1">
        {sections.map(([label, href]) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname === href ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm hover:bg-muted",
              pathname === href && "bg-muted font-medium",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
