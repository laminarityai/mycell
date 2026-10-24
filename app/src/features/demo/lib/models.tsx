"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { demoModels, demoProviders, demoRequests } from "../data";
import { usageBy } from "../usage";
import { UsageLeaderboard } from "./usage-leaderboard";
import { UsageRankings } from "./usage-rankings";

const modelRows = usageBy(
  demoRequests,
  (request) => demoModels.find((model) => model.id === request.model)?.label ?? request.model,
  (request) => request.provider,
);

export function DemoModels() {
  return (
    <Tabs defaultValue="analytics" className="space-y-6">
      <TabsList aria-label="Models and providers views">
        <TabsTrigger value="analytics">Analytics</TabsTrigger>
        <TabsTrigger value="providers">Providers</TabsTrigger>
        <TabsTrigger value="models">Models</TabsTrigger>
      </TabsList>
      <TabsContent value="analytics" className="space-y-6">
        <UsageLeaderboard title="Company model usage" subject="model" rows={modelRows} />
        <UsageRankings
          title="Model rankings"
          nameLabel="Model"
          groupLabel="Provider"
          rows={modelRows}
        />
      </TabsContent>
      <TabsContent value="providers">
        <Card>
          <CardHeader>
            <CardTitle>Providers</CardTitle>
            <CardDescription>Providers the router can send requests to.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {demoProviders.map((provider) => (
              <div key={provider} className="flex items-center justify-between py-3 text-sm">
                <span className="font-medium">{provider}</span>
                <Badge variant="secondary">Enabled</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="models">
        <Card>
          <CardHeader>
            <CardTitle>Models</CardTitle>
            <CardDescription>Models available to automatic routing.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {demoModels.map((model) => (
              <div key={model.id} className="flex items-center justify-between py-3 text-sm">
                <span className="font-medium">{model.label}</span>
                <span className="text-muted-foreground">{model.provider}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
