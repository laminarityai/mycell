"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { demoAgents } from "../data";
import type { DemoAgent } from "../types";
import { AgentAvatar } from "./avatar";
import { Thread, type Message } from "./thread";

/** Members share one daily token allowance across every agent; admins have none. */
const MEMBER_DAILY_TOKENS = 1_000_000;

/** Messages: agents listed like contacts, and one conversation per agent. */
export function DemoMessages({ admin, initialAgent }: { admin: boolean; initialAgent?: string }) {
  const personal: DemoAgent = {
    slug: "personal",
    name: "Your agent",
    description: "Your personal agent. Configure it once and use it for everyday work.",
    group: "Only you",
    connections: ["Google Workspace", "Microsoft 365", "Slack"],
    status: "Running",
  };
  const agents = [personal, ...demoAgents];
  const [selected, setSelected] = useState(
    agents.find((agent) => agent.slug === initialAgent)?.slug ?? "personal",
  );
  const [threads, setThreads] = useState<Partial<Record<string, Message[]>>>({});
  const [search, setSearch] = useState("");
  const agent = agents.find((item) => item.slug === selected) ?? personal;
  const used = Object.values(threads)
    .flatMap((thread) => thread ?? [])
    .reduce((total, message) => total + message.tokens, 0);

  return (
    <div className="flex h-[calc(100dvh-12rem)] min-h-[520px] overflow-hidden rounded-xl border">
      <aside
        aria-label="Conversations"
        className="flex w-72 shrink-0 flex-col border-r bg-muted/30"
      >
        <div className="relative p-3">
          <Search className="pointer-events-none absolute top-1/2 left-6 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search agents"
            placeholder="Search"
            className="pl-9"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </div>
        <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {agents
            .filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))
            .map((item) => {
              const last = threads[item.slug]?.at(-1);
              return (
                <li key={item.slug}>
                  <Button
                    variant="ghost"
                    aria-pressed={item.slug === selected}
                    className="h-auto w-full justify-start gap-3 rounded-xl px-3 py-2.5 text-left aria-pressed:bg-foreground/[0.07]"
                    onClick={() => {
                      setSelected(item.slug);
                    }}
                  >
                    <AgentAvatar name={item.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{item.name}</span>
                      <span className="block truncate text-xs font-normal text-muted-foreground">
                        {last ? `${last.mine ? "You: " : ""}${last.text}` : item.description}
                      </span>
                    </span>
                  </Button>
                </li>
              );
            })}
        </ul>
      </aside>
      <Thread
        key={agent.slug}
        agent={agent}
        messages={threads[agent.slug] ?? []}
        tokensLeft={admin ? null : MEMBER_DAILY_TOKENS - used}
        onSend={(message, reply) => {
          setThreads({
            ...threads,
            [agent.slug]: [...(threads[agent.slug] ?? []), message, reply],
          });
        }}
      />
    </div>
  );
}
