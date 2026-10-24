"use client";

import { KeyRound, Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { demoProviders } from "../data";

/** Bring your own key: a company's provider key replaces the default key for that provider. */
export function DemoKeys() {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const shown = demoProviders.filter((provider) =>
    provider.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <div className="max-w-4xl space-y-5">
      <p className="text-sm text-muted-foreground">
        Add your provider key. All company requests to that provider will use your key. No routing
        changes are needed.
      </p>
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search providers"
          placeholder="Search providers"
          className="pl-9"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </div>
      <Card>
        <CardContent className="divide-y">
          {shown.map((provider) => (
            <div key={provider} className="flex items-center gap-3 py-3">
              <KeyRound className="size-4 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-sm font-medium">{provider}</p>
                <p className="text-xs text-muted-foreground">Default key</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAdding(provider);
                }}
              >
                Add key
              </Button>
            </div>
          ))}
          {shown.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No providers match “{search}”.
            </p>
          )}
        </CardContent>
      </Card>
      <Dialog
        open={adding !== null}
        onOpenChange={(open) => {
          if (!open) setAdding(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a {adding} key</DialogTitle>
            <DialogDescription>
              The demo doesn&apos;t collect keys. In the product this opens a form whose key is
              encrypted at rest and never shown again.
            </DialogDescription>
          </DialogHeader>
          <Button
            onClick={() => {
              setAdding(null);
            }}
          >
            Close
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
