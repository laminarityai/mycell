"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { demoAgents, demoMembers, demoRequests } from "../data";
import { count, money } from "../format";

const PAGE = 15;
const memberNames = new Map(demoMembers.map((member) => [member.id, member.name]));
const agentIds = new Map(
  demoAgents.map((agent, index) => [agent.name, `agt_${String(index + 1).padStart(4, "0")}`]),
);
// Newest first, as a log reads.
const newestFirst = [...demoRequests].sort((a, b) => a.day - b.day || b.id - a.id);

/** Every request: who sent it, the agent and agent ID that handled it, its tokens and cost. */
export function DemoLogs() {
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const rows = useMemo(() => {
    const query = search.toLowerCase();
    return newestFirst.filter((request) =>
      `${request.summary} ${memberNames.get(request.member) ?? ""} ${request.agent} ${agentIds.get(request.agent) ?? ""}`
        .toLowerCase()
        .includes(query),
    );
  }, [search]);
  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle>Request logs</CardTitle>
        <Input
          aria-label="Search logs"
          placeholder="Search logs..."
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOffset(0);
          }}
        />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              {["Member / request", "Agent", "Agent ID", "Tokens", "Cost"].map((heading) => (
                <TableHead key={heading}>{heading}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(offset, offset + PAGE).map((request) => (
              <TableRow key={request.id}>
                <TableCell>
                  <p className="font-medium">{memberNames.get(request.member)}</p>
                  <p className="text-xs text-muted-foreground">
                    {request.summary} ·{" "}
                    {request.day === 0 ? "Today" : `${String(request.day)}d ago`}
                  </p>
                </TableCell>
                <TableCell>{request.agent}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {agentIds.get(request.agent)}
                </TableCell>
                <TableCell>{count(request.tokens)}</TableCell>
                <TableCell>{money(request.cost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No requests match these filters.
          </p>
        )}
        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {rows.length ? offset + 1 : 0}–{Math.min(offset + PAGE, rows.length)} of{" "}
            {count(rows.length)} requests
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={offset === 0}
              onClick={() => {
                setOffset(Math.max(0, offset - PAGE));
              }}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={offset + PAGE >= rows.length}
              onClick={() => {
                setOffset(offset + PAGE);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
