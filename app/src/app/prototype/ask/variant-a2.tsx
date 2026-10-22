"use client";

// PROTOTYPE, throwaway: round 2 of variant A inside the chosen sidebar shell. Two rails read as
// two levels: the app's navigation, then a lighter, narrower conversation rail with search and
// an icon button for a new conversation. The chat fills the rest at full height, its composer
// pinned to the foot. Replies are variant A's: footnoted sources, markers, the run card.
import Link from "next/link";
import { NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { VariantProps } from "../_shared/prototype-page";
import { SidebarShell } from "../_shared/sidebar-shell";
import { showsBanner } from "../shell/nav-model";
import { RailA2 } from "./a2-rail";
import { useAskChat } from "./use-ask-chat";
import { Composer, Thread } from "./variant-a";

export function VariantA2({ params }: VariantProps) {
  const chat = useAskChat(params.google);
  return (
    <SidebarShell params={params} current="ask" width="bleed">
      <div
        className={cn(
          "flex min-h-0",
          // The shell's sidebar height, less the out-of-credits banner when it shows.
          showsBanner(params) ? "h-[calc(100svh-3.75rem-1px)]" : "h-[calc(100svh-1.25rem)]",
        )}
      >
        <RailA2 chat={chat} />
        <section className="flex min-w-0 flex-1 flex-col" aria-label="Conversation">
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
            <h1 className="truncate text-sm font-medium">
              {chat.active?.title ?? "New conversation"}
            </h1>
            <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
              <Link href="/prototype/told-facts">
                <NotebookPen /> What you&apos;ve told Mycel
              </Link>
            </Button>
          </div>
          <Thread chat={chat} />
          <Composer chat={chat} />
        </section>
      </div>
    </SidebarShell>
  );
}
