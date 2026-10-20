// What each source needs beyond Nango itself: its integration, and how to read which account
// a connection reached.
import { z } from "zod";
import type { Source } from "../types";
import { proxyGet } from "./nango";

/** The Nango integration (provider config key) behind each source. */
export const INTEGRATIONS: Record<Source, string> = { gmail: "google-mail" };

const gmailProfile = z.object({ emailAddress: z.string().min(1) });

type NangoConnection = { connectionId: string; integration: string };

const accountEmailReaders: Record<Source, (connection: NangoConnection) => Promise<string>> = {
  gmail: async (connection) =>
    (await proxyGet(connection, "/gmail/v1/users/me/profile", gmailProfile)).emailAddress,
};

/** The connected account's address, lowercased. */
export async function readAccountEmail(source: Source, connectionId: string): Promise<string> {
  const email = await accountEmailReaders[source]({
    connectionId,
    integration: INTEGRATIONS[source],
  });
  return email.toLowerCase();
}
