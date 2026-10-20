import { z } from "zod";

/** The sources a connection can reach. Outlook joins after v1, behind the same interface. */
export const sourceSchema = z.enum(["gmail"]);
export type Source = z.infer<typeof sourceSchema>;

/** A connection as its owner sees it. */
export type ConnectionSummary = {
  id: string;
  source: Source;
  kind: "member" | "org";
  accountEmail: string;
  status: "active";
  createdAt: Date;
};

/** A connect attempt that hasn't become a connection: still waiting, or refused and why. */
export type ConnectAttemptSummary = {
  id: string;
  source: Source;
  status: "pending" | "refused";
  refusal: string | null;
  createdAt: Date;
};

export type ConnectionsListing = {
  connections: ConnectionSummary[];
  attempts: ConnectAttemptSummary[];
};
