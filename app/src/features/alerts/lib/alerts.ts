// Listing and counting the open alerts. Each source of alerts is read once, in parallel, so the
// reads are a fixed few however many alerts there are: the shell counts them on every page.
// #176 adds the workflows' alerts as one more source here.
import { listConnectionsToFix } from "@/features/connections/server";
import { getRunway } from "@/features/credits/server";
import { type Ctx, requireAdmin } from "@/lib/ctx";
import { ALERT_KINDS, type Alert } from "../types";
import { connectionAlerts } from "./connection-alerts";
import { creditAlerts } from "./credit-alerts";

/** The open alerts, most urgent first. Admins only: members get none. */
export async function listAlerts(ctx: Ctx): Promise<Alert[]> {
  requireAdmin(ctx);
  const [runway, connections] = await Promise.all([getRunway(ctx), listConnectionsToFix(ctx)]);
  const alerts = [...creditAlerts(runway), ...connectionAlerts(connections)];
  // A stable sort: alerts of one kind keep their source's order.
  return alerts.sort((a, b) => ALERT_KINDS.indexOf(a.kind) - ALERT_KINDS.indexOf(b.kind));
}

/** How many alerts are open, as `listAlerts` lists them. Admins only. */
export async function countAlerts(ctx: Ctx): Promise<number> {
  return (await listAlerts(ctx)).length;
}
