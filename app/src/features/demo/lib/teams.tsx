"use client";

import { ChevronRight, Folder, UserRound, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { demoGroups, demoMembers } from "../data";
import { money } from "../format";
import type { DemoGroup } from "../types";

const membersIn = (group: DemoGroup) => {
  const names = new Set([
    group.name,
    ...demoGroups.filter((child) => child.parentId === group.id).map((child) => child.name),
  ]);
  return demoMembers.filter((member) => names.has(member.group));
};

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex w-80 shrink-0 flex-col border-r last:border-r-0">
      <h3 className="px-3 py-3 text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="space-y-1 px-2 pb-3">{children}</div>
    </section>
  );
}

/** Teams in Finder-style columns: open a team to see its sub-teams and people. */
export function DemoTeams({ org }: { org: string }) {
  const [path, setPath] = useState<number[]>([]);
  const columns = [null, ...path];
  return (
    <div className="flex overflow-x-auto rounded-xl border">
      {columns.map((parentId, level) => {
        const parent = demoGroups.find((group) => group.id === parentId);
        const groups = demoGroups.filter((group) => group.parentId === parentId);
        const people = parent ? demoMembers.filter((member) => member.group === parent.name) : [];
        return (
          <Column key={parentId ?? "org"} title={parent?.name ?? org}>
            {groups.map((group) => (
              <Button
                key={group.id}
                variant="ghost"
                aria-pressed={path[level] === group.id}
                className="h-auto w-full justify-start gap-2 px-2 py-2.5 aria-pressed:bg-muted"
                onClick={() => {
                  setPath([...path.slice(0, level), group.id]);
                }}
              >
                <Folder className="size-4 text-sky-500" />
                <span className="flex-1 truncate text-left">{group.name}</span>
                <span
                  className="flex items-center gap-1 text-xs text-muted-foreground"
                  title="People"
                >
                  <Users className="size-3.5" />
                  {membersIn(group).length}
                </span>
                <span className="text-xs text-muted-foreground" title="Monthly budget">
                  {money(group.budget)}
                </span>
                <ChevronRight className="size-3.5 text-muted-foreground" />
              </Button>
            ))}
            {people.map((member) => (
              <p key={member.id} className="flex items-center gap-2 px-2 py-2.5 text-sm">
                <UserRound className="size-4 text-muted-foreground" />
                {member.name}
              </p>
            ))}
          </Column>
        );
      })}
    </div>
  );
}
