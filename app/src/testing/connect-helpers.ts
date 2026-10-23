// Connecting through the whole flow (startConnect, OAuth in the fake Nango, the signed creation
// webhook), for any feature's tests: a feature's tests can't import another feature's tests/.
import { handleNangoWebhook, listConnections, startConnect } from "@/features/connections/server";
import type { ConnectionKind, RegisteredAppId } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import { DAY_MS } from "@/lib/time";
import type { FakeFileInput } from "./fake-drive";
import type { FakeMessageInput } from "./fake-gmail";
import { fakeNango } from "./fake-nango";

/** A moment `days` days ago. */
export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

export type ConnectGoogleOptions = {
  // A member connection (the default), or an org connection, which only admins make.
  kind?: ConnectionKind;
  // The scopes the account grants on Google's consent screen; every app Mycel asks for by
  // default. Leaving one out is unticking that app.
  scopes?: readonly string[];
  messages?: FakeMessageInput[];
  files?: FakeFileInput[];
};

/**
 * Connects `emailAddress`'s Google account, seeds its mailbox and Drive, and returns Mycel's
 * connection ID, Nango's, the fake mailbox, Drive, spreadsheets, calendar and documents, and the seeded
 * files.
 * Throws if the connection wasn't recorded (the account was refused).
 */
export async function connectGoogle(
  ctx: Ctx,
  emailAddress: string,
  options: ConnectGoogleOptions = {},
) {
  const webhook = await connectFlow(ctx, options.kind ?? "member", emailAddress, options.scopes);
  const connection = (await all(ctx)).find(
    (c) => c.source === "google" && c.accountEmail === emailAddress.toLowerCase(),
  );
  if (connection === undefined) throw new Error(`${emailAddress} didn't connect`);
  const mailbox = fakeNango.mailbox(webhook.connectionId);
  for (const message of options.messages ?? []) mailbox.add(message);
  const drive = fakeNango.drive(webhook.connectionId);
  const files = (options.files ?? []).map((file) => drive.add(file));
  const sheets = fakeNango.sheets(webhook.connectionId);
  const calendar = fakeNango.calendar(webhook.connectionId);
  const docs = fakeNango.docs(webhook.connectionId);
  return {
    id: connection.id,
    nangoConnectionId: webhook.connectionId,
    mailbox,
    drive,
    files,
    sheets,
    calendar,
    docs,
  };
}

/** connectGoogle, seeding only the mailbox: for tests about mail. */
export async function connectMailbox(
  ctx: Ctx,
  emailAddress: string,
  messages: FakeMessageInput[] = [],
  kind: ConnectionKind = "member",
) {
  return connectGoogle(ctx, emailAddress, { kind, messages });
}

/**
 * The bare connect flow for the caller's own Google account: start an attempt, finish OAuth as
 * `emailAddress` (granting `scopes`, every app by default), and deliver the creation webhook.
 * Returns the webhook, with Nango's connection ID, and Mycel's response to it. Unlike
 * connectGoogle, it doesn't need the connection to be recorded: the account may be refused.
 */
export async function connectGmail(ctx: Ctx, emailAddress: string, scopes?: readonly string[]) {
  return connectFlow(ctx, "member", emailAddress, scopes);
}

/** The same flow for a shared account, such as support@, connected as an org connection. */
export async function connectOrgInbox(ctx: Ctx, emailAddress: string, scopes?: readonly string[]) {
  return connectFlow(ctx, "org", emailAddress, scopes);
}

async function connectFlow(
  ctx: Ctx,
  kind: ConnectionKind,
  emailAddress: string,
  scopes: readonly string[] | undefined,
) {
  const { token } = await startConnect(ctx, "google", kind);
  const webhook = fakeNango.completeConnect(token, { emailAddress }, scopes);
  const response = await handleNangoWebhook(webhook.rawBody, webhook.headers);
  return { ...webhook, response };
}

/**
 * The bare connect flow for a registered app: start an attempt for the caller (their own
 * account by default, or an org one), finish OAuth as `emailAddress` (granting `scopes`,
 * everything the app asks for by default), and deliver the creation webhook. Returns the
 * webhook, with Nango's connection ID, Mycel's response to it, and the recorded connection's ID
 * (undefined when the account was refused).
 */
export async function connectApp(
  ctx: Ctx,
  app: RegisteredAppId,
  emailAddress: string,
  options: { kind?: ConnectionKind; scopes?: readonly string[] } = {},
) {
  const { token } = await startConnect(ctx, app, options.kind ?? "member");
  const webhook = fakeNango.completeConnect(token, { emailAddress }, options.scopes);
  const response = await handleNangoWebhook(webhook.rawBody, webhook.headers);
  const connection = (await all(ctx)).find(
    (c) => c.source === app && c.accountEmail === emailAddress.toLowerCase(),
  );
  return { ...webhook, response, id: connection?.id };
}

/** connectGoogle, seeding only the Drive: for tests about Drive files. */
export async function connectDrive(
  ctx: Ctx,
  emailAddress: string,
  files: FakeFileInput[] = [],
  kind: ConnectionKind = "member",
) {
  return connectGoogle(ctx, emailAddress, { kind, files });
}

/**
 * Connects one app on its own, as connections were made before one Google connection per
 * account (ADR-0014). Nothing in the app makes these any more; tests stand them in for the
 * ones that remain from then.
 */
export async function connectOldConnection(
  ctx: Ctx,
  source: "gmail" | "drive",
  emailAddress: string,
  options: Pick<ConnectGoogleOptions, "kind" | "messages" | "files"> = {},
) {
  const { token } = await startConnect(ctx, source, options.kind ?? "member");
  const webhook = fakeNango.completeConnect(token, { emailAddress });
  await handleNangoWebhook(webhook.rawBody, webhook.headers);
  const connection = (await all(ctx)).find(
    (c) => c.source === source && c.accountEmail === emailAddress.toLowerCase(),
  );
  if (connection === undefined) throw new Error(`${emailAddress}'s ${source} didn't connect`);
  const mailbox = fakeNango.mailbox(webhook.connectionId);
  for (const message of options.messages ?? []) mailbox.add(message);
  const drive = fakeNango.drive(webhook.connectionId);
  for (const file of options.files ?? []) drive.add(file);
  return { id: connection.id, nangoConnectionId: webhook.connectionId, mailbox, drive };
}

/** The caller's own connection with this ID (or an org one), as the connections page lists it. */
export async function listed(ctx: Ctx, connectionId: string) {
  return (await all(ctx)).find((c) => c.id === connectionId);
}

/** Delivers a webhook from the fake Nango to Mycel's webhook handler. */
export async function deliver(webhook: { rawBody: string; headers: Headers }) {
  return handleNangoWebhook(webhook.rawBody, webhook.headers);
}

async function all(ctx: Ctx) {
  const listing = await listConnections(ctx);
  return [...listing.connections, ...listing.orgConnections];
}
