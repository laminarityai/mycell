"use client";

// The workflow page's tabs (M7): Editor, Runs and Health. It opens on Health while the workflow
// is paused, and the Health tab carries a dot then, so a pause shows from the other tabs. Every
// tab stays mounted, hidden while another is shown, so an unsaved edit or a Try it result
// survives a look at Health.
import { createContext, type ReactNode, use, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BUDGET_FIELD_ID } from "./budget-help";

type Tab = "editor" | "runs" | "health";

// Shows a tab: what "Change the budget" on the Health tab uses to go to the editor's field.
const ShowTab = createContext<(tab: Tab) => void>(() => undefined);

const CONTENT = "flex flex-col gap-8 pt-4 data-[state=inactive]:hidden";

export function WorkflowTabs({
  paused,
  editor,
  runs,
  health,
}: {
  /** Whether anything stops the workflow from running: it opens on Health then. */
  paused: boolean;
  editor: ReactNode;
  runs: ReactNode;
  health: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>(paused ? "health" : "editor");
  return (
    <ShowTab value={setTab}>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as Tab);
        }}
      >
        <TabsList variant="line" className="border-b">
          <TabsTrigger value="editor">Editor</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="health">
            Health
            {paused ? (
              <span role="img" aria-label="Paused" className="size-2 rounded-full bg-destructive" />
            ) : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="editor" forceMount className={CONTENT}>
          {editor}
        </TabsContent>
        <TabsContent value="runs" forceMount className={CONTENT}>
          {runs}
        </TabsContent>
        <TabsContent value="health" forceMount className={CONTENT}>
          {health}
        </TabsContent>
      </Tabs>
    </ShowTab>
  );
}

/** Opens the Editor tab and moves to the budget field in its settings. */
export function ChangeBudgetButton() {
  const showTab = use(ShowTab);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-fit"
      onClick={() => {
        showTab("editor");
        // Once the editor is shown: a hidden field can't take focus.
        requestAnimationFrame(() => {
          const field = document.getElementById(BUDGET_FIELD_ID);
          field?.scrollIntoView({ block: "center" });
          field?.focus();
        });
      }}
    >
      Change the budget
    </Button>
  );
}
