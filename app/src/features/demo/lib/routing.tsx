"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { demoRoutes } from "../data";
import { money } from "../format";

/** Routing configurations: how requests pick a model, with fallback and a cost cap. */
export function DemoRouting() {
  const [enabled, setEnabled] = useState(
    () => new Map(demoRoutes.map((route) => [route.id, route.enabled])),
  );
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {demoRoutes.map((route) => (
        <Card key={route.id}>
          <CardHeader>
            <CardTitle>{route.name}</CardTitle>
            <CardDescription>{route.strategy}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="flex justify-between">
              <span className="text-muted-foreground">Fallback</span>
              <Badge variant="outline">{route.fallback ? "On" : "Off"}</Badge>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">Max cost per million tokens</span>
              <span>{money(route.maxCost)}</span>
            </p>
            <label className="flex items-center justify-between">
              <span className="text-muted-foreground">Enabled</span>
              <Switch
                aria-label={`Enable ${route.name}`}
                checked={enabled.get(route.id)}
                onCheckedChange={(checked) => {
                  setEnabled(new Map(enabled).set(route.id, checked));
                }}
              />
            </label>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
