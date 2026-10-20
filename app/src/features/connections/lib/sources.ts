// What each source needs beyond Nango itself: its integration, and how to read which account
// a connection reached.
import { z } from "zod";
import type { Source } from "../types";
import { NangoConnectionGoneError, nangoProxyGet } from "./nango";

/**
 * The Nango integration (provider config key) behind each source. Nango's `google-drive`
 * provider proxies to https://www.googleapis.com, so Drive paths start with /drive/v3.
 */
export const INTEGRATIONS: Record<Source, string> = {
  gmail: "google-mail",
  drive: "google-drive",
};

const gmailProfile = z.object({ emailAddress: z.string().min(1) });
const driveAbout = z.object({ user: z.object({ emailAddress: z.string().min(1) }) });

type NangoConnection = { connectionId: string; integration: string };

const accountEmailReaders: Record<Source, (connection: NangoConnection) => Promise<string>> = {
  gmail: async (connection) => {
    const profile = await nangoProxyGet(connection, "/gmail/v1/users/me/profile", gmailProfile);
    if (profile === null) throw new NangoConnectionGoneError();
    return profile.emailAddress;
  },
  drive: async (connection) => {
    const about = await nangoProxyGet(
      connection,
      "/drive/v3/about?fields=user(emailAddress)",
      driveAbout,
    );
    if (about === null) throw new NangoConnectionGoneError();
    return about.user.emailAddress;
  },
};

/** The connected account's address, lowercased. */
export async function readAccountEmail(source: Source, connectionId: string): Promise<string> {
  const email = await accountEmailReaders[source]({
    connectionId,
    integration: INTEGRATIONS[source],
  });
  return email.toLowerCase();
}
