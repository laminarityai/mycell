// Shared by the Calendar trigger's tests: Calendar-triggered workflows switched on for an
// admin's own Google connection, and the invites its poll announced.
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { enable } from "@/features/workflows/server";
import { systemCtx } from "@/lib/ctx";
import { connectGoogle } from "@/testing/connect-helpers";
import { fakeInngest } from "@/testing/fake-inngest";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import type { CalendarInviteReceived } from "../lib/events";

/** The organizer's domain this spec's first path takes. */
export const CUSTOMER_DOMAIN = "customer.test";

/** A Calendar-triggered spec: a branch on the invite's organizer, with nothing on its paths. */
export function inviteSpec(id = "customer-invites"): Record<string, unknown> {
  return {
    specVersion: 2,
    id,
    credentials: "member",
    trigger: { type: "calendar.invite_received" },
    steps: [
      {
        id: "route",
        type: "branch",
        mode: "first",
        paths: [
          {
            id: "customers",
            name: "Customers",
            condition: {
              combine: "all",
              checks: [
                { subject: { from: "trigger.organizerDomain" }, op: "is", value: CUSTOMER_DOMAIN },
              ],
            },
            steps: [],
          },
        ],
        otherwise: { id: "rest", steps: [] },
      },
    ],
    autonomy: { rung: 3 },
  };
}

/**
 * Org A's admin connects Google, and two Calendar-triggered workflows are switched on for that
 * connection. `before` runs between connecting and switching on, to seed what came earlier.
 */
export async function calendarSwitchedOn(
  before?: (calendar: Awaited<ReturnType<typeof connectGoogle>>["calendar"]) => void,
) {
  const orgs = await seedTwoOrgs();
  const { admin } = orgs.orgA;
  const google = await connectGoogle(admin.ctx, admin.email);
  before?.(google.calendar);
  await tagUsers(admin.ctx, "sales", [admin]);
  const customers = await publishTo(admin.ctx, "Customer invites", inviteSpec(), ["sales"]);
  const all = await publishTo(admin.ctx, "All invites", inviteSpec("all-invites"), ["sales"]);
  await enable(admin.ctx, customers.workflowId);
  await enable(admin.ctx, all.workflowId);
  return {
    ...orgs,
    admin,
    google,
    calendar: google.calendar,
    system: systemCtx(orgs.orgA.id),
    workflowIds: [customers.workflowId, all.workflowId],
  };
}

/** The invites the poll announced, oldest first, as the fan-out receives them. */
export function announced(): CalendarInviteReceived[] {
  return fakeInngest
    .sent("calendar/invite.received")
    .map((event) => event.data as CalendarInviteReceived);
}

/** The Inngest event IDs of the invites the poll announced. */
export function announcedIds(): (string | undefined)[] {
  return fakeInngest.sent("calendar/invite.received").map((event) => event.id);
}
