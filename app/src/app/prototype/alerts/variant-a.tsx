// PROTOTYPE, throwaway: Alerts as one quiet list, grouped by what they're about (workflows,
// credits, connections), each row saying what happened, since when, and the one fix.
import { Coins, Plug, Workflow } from "lucide-react";
import { DateTime } from "@/components/date-time";
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { ago, alertsFor, type AlertGroup } from "./alert-data";
import { FixButton, MemberNotices, OutOfCreditsBanner } from "./alert-parts";

const GROUPS: { group: AlertGroup; icon: typeof Coins }[] = [
  { group: "Credits", icon: Coins },
  { group: "Workflows", icon: Workflow },
  { group: "Connections", icon: Plug },
];

export function VariantA({ params }: VariantProps) {
  const admin = params.as === "admin";
  const alerts = alertsFor(params.state);
  return (
    <>
      {admin && params.state === "out" ? <OutOfCreditsBanner /> : null}
      <PrototypeMain>
        <PrototypeHeader title={admin ? "Alerts" : "Your notices"} admin={admin} />
        {!admin ? (
          <MemberNotices state={params.state} />
        ) : alerts.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nothing needs you. Alerts appear here when a workflow fails, credits run low or a shared
            inbox needs reconnecting, and go away once it&apos;s fixed.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Each alert goes away by itself once its cause is fixed.
            </p>
            {GROUPS.map(({ group, icon: Icon }) => {
              const rows = alerts.filter((a) => a.group === group);
              if (rows.length === 0) return null;
              return (
                <section key={group} className="flex flex-col gap-2" aria-label={group}>
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <Icon className="size-4 text-muted-foreground" /> {group}
                  </h2>
                  <ul className="flex flex-col divide-y rounded-lg border">
                    {rows.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 p-4">
                        <div className="flex min-w-60 flex-1 flex-col gap-1">
                          <p className="text-sm">
                            {a.group === "Credits" ? (
                              <span className="font-medium">{a.title}</span>
                            ) : (
                              <>
                                <span className="font-medium">{a.subject}</span>:{" "}
                                {a.title.toLowerCase()}
                              </>
                            )}
                          </p>
                          <p className="text-sm text-muted-foreground">{a.what}</p>
                          <p className="text-xs text-muted-foreground">
                            {a.since === undefined ? (
                              "Ongoing"
                            ) : (
                              <>
                                Since <DateTime value={a.since} /> ({ago(a.since)})
                              </>
                            )}
                            . {a.clears}
                          </p>
                        </div>
                        <FixButton alert={a} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </>
        )}
      </PrototypeMain>
    </>
  );
}
