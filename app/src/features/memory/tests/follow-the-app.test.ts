import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { backfillConnection, pollConnection } from "@/features/discovery/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { connectDrive, connectMailbox, daysAgo } from "@/testing/connect-helpers";
import type { FakeDrive, FakeFileInput } from "@/testing/fake-drive";
import type { FakeMailbox, FakeMessageInput } from "@/testing/fake-gmail";
import { readObject, rereadDriveAccess } from "../server";
import {
  followAppChanges,
  learnStoredItems,
  scriptDocLearning,
  scriptLearning,
  withCredits,
  type ScriptedExtraction,
} from "./memory-helpers";

beforeEach(resetDatabase);

const DOC = "application/vnd.google-apps.document";
const DANA = "dana@acme.example";
const ROLE = "Dana Ruiz leads procurement at Acme.";
const RENEWAL = "Acme renews its contract in March.";

const byAcme = { key: { kind: "domain" as const, value: "acme.example" } };
const byDana = { key: { kind: "email" as const, value: DANA } };

const DANA_AND_RENEWAL: ScriptedExtraction = {
  objects: [
    { ref: "dana", kind: "person", name: "Dana Ruiz", email: DANA },
    { ref: "acme", kind: "company", name: "Acme", domain: "acme.example" },
  ],
  facts: [
    { about: "dana", statement: ROLE, evidence: "I lead procurement at Acme", object: "acme" },
    { about: "acme", statement: RENEWAL, evidence: "renews its contract in March" },
  ],
};

const RENEWAL_ONLY: ScriptedExtraction = {
  objects: [{ ref: "acme", kind: "company", name: "Acme", domain: "acme.example" }],
  facts: [{ about: "acme", statement: RENEWAL, evidence: "renews its contract in March" }],
};

// Org A with a third person, Lee.
async function setup() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  await withCredits(orgA.id);
  const lee = await seedUser(orgA.id, `lee@${orgA.workspaceDomain}`, "member");
  const email = (text: string, overrides: Partial<FakeMessageInput> = {}): FakeMessageInput => ({
    from: `Dana Ruiz <${DANA}>`,
    to: [orgA.member.email],
    subject: "Renewal",
    text,
    at: daysAgo(2),
    ...overrides,
  });
  const doc = (overrides: Partial<FakeFileInput> = {}): FakeFileInput => ({
    name: "Acme account notes",
    mimeType: DOC,
    text: "Account notes. Acme (acme.example) renews its contract in March.",
    at: daysAgo(2),
    ...overrides,
  });
  return { ...orgs, lee, email, doc };
}

const statements = async (ctx: Ctx, lookup: Parameters<typeof readObject>[1] = byAcme) =>
  (await readObject(ctx, lookup)).facts.map((fact) => fact.statement).sort();

const messageIds = (mailbox: FakeMailbox) =>
  (mailbox.list(new URLSearchParams()).messages ?? []).map((message) => message.id);

describe("an item deleted in its app", () => {
  it.each<[string, (mailbox: FakeMailbox, id: string) => void]>([
    [
      "deleted for good",
      (mailbox, id) => {
        mailbox.delete(id);
      },
    ],
    [
      "moved to the trash",
      (mailbox, id) => {
        mailbox.trash(id);
      },
    ],
  ])(
    "takes the facts only it supported when an email is %s, and keeps those another email supports",
    async (_, remove) => {
      const { orgA, email } = await setup();
      const connection = await connectMailbox(orgA.member.ctx, orgA.member.email, [
        email("I lead procurement at Acme. Acme renews its contract in March.", {
          at: daysAgo(3),
        }),
      ]);
      await backfillConnection(orgA.member.ctx, connection.id);
      scriptLearning(DANA_AND_RENEWAL);
      await learnStoredItems(orgA.id);
      connection.mailbox.add(email("Reminder: Acme renews its contract in March."));
      await pollConnection(systemCtx(orgA.id), connection.id);
      scriptLearning(RENEWAL_ONLY);
      await learnStoredItems(orgA.id);
      expect(await statements(orgA.member.ctx)).toEqual([RENEWAL]);
      const [, first] = messageIds(connection.mailbox);

      remove(connection.mailbox, first);
      await pollConnection(systemCtx(orgA.id), connection.id);
      await followAppChanges(orgA.id);

      // Dana's role went with the email, and Dana with it: nothing else is known about her.
      await expect(readObject(orgA.member.ctx, byDana)).rejects.toThrow(NotFoundError);
      const acme = await readObject(orgA.member.ctx, byAcme);
      expect(acme.facts.map((fact) => fact.statement)).toEqual([RENEWAL]);
      expect(acme.facts[0]?.sources.map((source) => source.sourceRef)).not.toContain(first);
    },
  );

  it("is never learned when it's in the trash by the time memory reads it", async () => {
    const { orgA, email } = await setup();
    const connection = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      email("Acme renews its contract in March."),
    ]);
    await backfillConnection(orgA.member.ctx, connection.id);
    const [id] = messageIds(connection.mailbox);
    connection.mailbox.trash(id);

    expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "gone" }]);
  });

  it.each<[string, (connection: { drive: FakeDrive }, id: string) => void]>([
    [
      "deleted",
      (connection, id) => {
        connection.drive.remove(id);
      },
    ],
    [
      "moved to the trash",
      (connection, id) => {
        connection.drive.trash(id, new Date());
      },
    ],
  ])(
    "takes the facts only a doc supported when it's %s, and keeps those an email supports",
    async (_, remove) => {
      const { orgA, email, doc } = await setup();
      const connection = await connectMailbox(orgA.member.ctx, orgA.member.email, [
        email("Acme renews its contract in March."),
      ]);
      await backfillConnection(orgA.member.ctx, connection.id);
      scriptLearning(RENEWAL_ONLY);
      await learnStoredItems(orgA.id);
      const file = connection.drive.add(
        doc({ text: `Dana Ruiz (${DANA}): I lead procurement at Acme. ${RENEWAL}` }),
      );
      await pollConnection(systemCtx(orgA.id), connection.id);
      scriptDocLearning(DANA_AND_RENEWAL);
      await learnStoredItems(orgA.id);
      expect(await statements(orgA.member.ctx, byDana)).toEqual([ROLE]);

      remove(connection, file.id);
      await pollConnection(systemCtx(orgA.id), connection.id);
      await followAppChanges(orgA.id);

      await expect(readObject(orgA.member.ctx, byDana)).rejects.toThrow(NotFoundError);
      const acme = await readObject(orgA.member.ctx, byAcme);
      expect(acme.facts.map((fact) => fact.statement)).toEqual([RENEWAL]);
      expect(acme.facts[0]?.sources.map((source) => source.app)).toEqual(["gmail"]);
    },
  );
});

describe("a doc's sharing changed in Drive", () => {
  it("hides its facts from someone it's unshared from, and shows them once it's shared again", async () => {
    const { orgA, lee, doc } = await setup();
    const drive = await connectDrive(orgA.member.ctx, orgA.member.email, [
      doc({ sharedWith: [{ type: "user", emailAddress: lee.email }] }),
    ]);
    await backfillConnection(orgA.member.ctx, drive.id);
    scriptDocLearning(RENEWAL_ONLY);
    await learnStoredItems(orgA.id);
    expect(await statements(lee.ctx)).toEqual([RENEWAL]);
    const [file] = drive.files;

    drive.drive.unshare(file.id, lee.email);
    await pollConnection(systemCtx(orgA.id), drive.id);
    await followAppChanges(orgA.id);

    await expect(readObject(lee.ctx, byAcme)).rejects.toThrow(NotFoundError);
    expect(await statements(orgA.member.ctx)).toEqual([RENEWAL]);

    drive.drive.share(file.id, { type: "user", emailAddress: lee.email });
    await pollConnection(systemCtx(orgA.id), drive.id);
    await followAppChanges(orgA.id);

    expect(await statements(lee.ctx)).toEqual([RENEWAL]);
    await expect(readObject(orgA.admin.ctx, byAcme)).rejects.toThrow(NotFoundError);
  });

  it("makes a doc shared with the whole company visible to everyone", async () => {
    const { orgA, lee, doc } = await setup();
    const drive = await connectDrive(orgA.member.ctx, orgA.member.email, [doc()]);
    await backfillConnection(orgA.member.ctx, drive.id);
    scriptDocLearning(RENEWAL_ONLY);
    await learnStoredItems(orgA.id);
    await expect(readObject(lee.ctx, byAcme)).rejects.toThrow(NotFoundError);

    drive.drive.share(drive.files[0].id, { type: "domain", domain: orgA.workspaceDomain });
    await pollConnection(systemCtx(orgA.id), drive.id);
    await followAppChanges(orgA.id);

    for (const ctx of [lee.ctx, orgA.admin.ctx, systemCtx(orgA.id)]) {
      expect(await statements(ctx)).toEqual([RENEWAL]);
    }
  });

  it("hides a doc from a member whose own Drive held it, once it's unshared from them", async () => {
    const { orgA, lee, doc } = await setup();
    // Shared with Lee to read: Lee's Drive holds it, without its sharing list.
    const shared = doc({ sharedWith: [{ type: "user", emailAddress: lee.email }] });
    const mine = await connectDrive(orgA.member.ctx, orgA.member.email, [shared]);
    const [file] = mine.files;
    const lees = await connectDrive(lee.ctx, lee.email, [
      { ...shared, id: file.id, owners: [orgA.member.email] },
    ]);
    await backfillConnection(orgA.member.ctx, mine.id);
    await backfillConnection(lee.ctx, lees.id);
    scriptDocLearning(RENEWAL_ONLY);
    await learnStoredItems(orgA.id);
    expect(await statements(lee.ctx)).toEqual([RENEWAL]);

    mine.drive.unshare(file.id, lee.email);
    lees.drive.remove(file.id);
    await pollConnection(systemCtx(orgA.id), mine.id);
    await pollConnection(systemCtx(orgA.id), lees.id);
    await followAppChanges(orgA.id);

    await expect(readObject(lee.ctx, byAcme)).rejects.toThrow(NotFoundError);
    expect(await statements(orgA.member.ctx)).toEqual([RENEWAL]);
  });
});

describe("the nightly re-read of Drive access", () => {
  it("catches a sharing change the changes feed missed", async () => {
    const { orgA, lee, doc } = await setup();
    const drive = await connectDrive(orgA.member.ctx, orgA.member.email, [
      doc({ sharedWith: [{ type: "user", emailAddress: lee.email }] }),
    ]);
    await backfillConnection(orgA.member.ctx, drive.id);
    scriptDocLearning(RENEWAL_ONLY);
    await learnStoredItems(orgA.id);
    const [file] = drive.files;

    // Unshared from Lee, and shared with the admin, with no poll to see either.
    drive.drive.unshare(file.id, lee.email);
    drive.drive.share(file.id, { type: "user", emailAddress: orgA.admin.email });
    expect(await rereadDriveAccess(systemCtx(orgA.id))).toEqual({ files: 1, removed: 0 });

    await expect(readObject(lee.ctx, byAcme)).rejects.toThrow(NotFoundError);
    expect(await statements(orgA.admin.ctx)).toEqual([RENEWAL]);
    expect(await statements(orgA.member.ctx)).toEqual([RENEWAL]);
  });

  it("takes what a doc taught once Drive no longer has it", async () => {
    const { orgA, doc } = await setup();
    const drive = await connectDrive(orgA.member.ctx, orgA.member.email, [doc()]);
    await backfillConnection(orgA.member.ctx, drive.id);
    scriptDocLearning(RENEWAL_ONLY);
    await learnStoredItems(orgA.id);

    drive.drive.remove(drive.files[0].id);
    expect(await rereadDriveAccess(systemCtx(orgA.id))).toEqual({ files: 1, removed: 1 });

    await expect(readObject(orgA.member.ctx, byAcme)).rejects.toThrow(NotFoundError);
  });

  it("re-reads only the system's own org, and only as the system", async () => {
    const { orgA, orgB, doc } = await setup();
    const drive = await connectDrive(orgA.member.ctx, orgA.member.email, [doc()]);
    await backfillConnection(orgA.member.ctx, drive.id);
    scriptDocLearning(RENEWAL_ONLY);
    await learnStoredItems(orgA.id);

    expect(await rereadDriveAccess(systemCtx(orgB.id))).toEqual({ files: 0, removed: 0 });
    await expect(rereadDriveAccess(orgA.admin.ctx)).rejects.toThrow();
  });
});
