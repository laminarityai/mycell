"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { demoAgents, demoRequests } from "../data";
import { usageBy } from "../usage";
import { AgentAvatar } from "./avatar";
import { UsageLeaderboard } from "./usage-leaderboard";
import { UsageRankings } from "./usage-rankings";

const agentRows = usageBy(
  demoRequests,
  (request) => request.agent,
  (request) => demoAgents.find((agent) => agent.name === request.agent)?.group ?? "",
);
const agentId = (name: string) =>
  `agt_${String(demoAgents.findIndex((agent) => agent.name === name) + 1).padStart(4, "0")}`;

export function DemoAgents() {
  const [search, setSearch] = useState("");
  const shown = demoAgents.filter((agent) =>
    `${agent.name} ${agent.description} ${agent.group}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <Tabs defaultValue="analytics" className="space-y-6">
      <TabsList aria-label="Agents views">
        <TabsTrigger value="analytics">Analytics</TabsTrigger>
        <TabsTrigger value="agents">Agents</TabsTrigger>
      </TabsList>
      <TabsContent value="analytics" className="space-y-6">
        <UsageLeaderboard title="Company agent usage" subject="agent" rows={agentRows} />
        <UsageRankings
          title="Agent rankings"
          nameLabel="Agent"
          groupLabel="Team"
          rows={agentRows}
          idOf={agentId}
        />
      </TabsContent>
      <TabsContent value="agents" className="space-y-4">
        <Input
          aria-label="Search agents"
          placeholder="Search agents"
          className="max-w-xs"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
        <ul className="divide-y rounded-xl border">
          {shown.map((agent) => (
            <li key={agent.slug} className="flex items-center gap-4 px-4 py-3.5">
              <AgentAvatar name={agent.name} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {agent.name}
                  {agent.status !== "Running" && (
                    <span className="text-xs font-normal text-muted-foreground">
                      · {agent.status}
                    </span>
                  )}
                </p>
                <p className="truncate text-sm text-muted-foreground">{agent.description}</p>
                <p className="mt-1.5 flex flex-wrap gap-1">
                  {agent.connections.map((connection) => (
                    <Badge key={connection} variant="outline">
                      {connection}
                    </Badge>
                  ))}
                </p>
              </div>
              <span className="hidden w-28 shrink-0 text-sm text-muted-foreground md:block">
                {agent.group}
              </span>
              <Link
                href={`/demo/messages?agent=${agent.slug}`}
                className="text-sm font-medium underline-offset-4 hover:underline"
              >
                Chat
              </Link>
            </li>
          ))}
          {shown.length === 0 && (
            <li className="py-10 text-center text-sm text-muted-foreground">
              No agents match “{search}”.
            </li>
          )}
        </ul>
      </TabsContent>
    </Tabs>
  );
}
