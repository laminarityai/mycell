// A fact a reply read can be deleted while the reply is still being written (#185): before it's
// stored, or between checking what it drew on and recording it. Either way the reply is stored
// removed, never with the words of something already gone. Memory's `citeFacts`, which the
// store asks what the reply drew on, is wrapped here so the deletion lands at each moment.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import type * as MemoryServer from "@/features/memory/server";
import { forgetPerson } from "@/features/memory/server";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { readTurn } from "@/testing/streamed-turn";
import { getConversation, startConversation, streamTurn } from "../server";
import { DANA, setupMemory } from "./memory-setup";

// What to do just before or just after the store's next `citeFacts`, once.
const race = vi.hoisted(() => ({
  before: undefined as (() => Promise<unknown>) | undefined,
  after: undefined as (() => Promise<unknown>) | undefined,
}));

vi.mock("@/features/memory/server", async (importOriginal) => {
  const memory = await importOriginal<typeof MemoryServer>();
  return {
    ...memory,
    citeFacts: async (...args: Parameters<typeof memory.citeFacts>) => {
      const { before, after } = race;
      race.before = undefined;
      race.after = undefined;
      await before?.();
      const cited = await memory.citeFacts(...args);
      await after?.();
      return cited;
    },
  };
});

beforeEach(async () => {
  race.before = undefined;
  race.after = undefined;
  await resetDatabase();
});

describe.each(["before", "after"] as const)(
  "a fact deleted %s the store checks what the reply drew on",
  (moment) => {
    it("leaves the reply stored removed", async () => {
      const { orgA } = await setupMemory();
      const member = orgA.member.ctx;
      const { id } = await startConversation(member);
      fakeAiGateway.reply({ toolCalls: [{ name: "read_object", input: { email: DANA } }] });
      fakeAiGateway.reply({ text: "MARKER-185-H: Dana wants a demo." });
      race[moment] = () => forgetPerson(orgA.admin.ctx, { email: DANA });

      await readTurn(await streamTurn(member, id, "Tell me about Dana"));

      const messages = (await getConversation(member, id)).messages;
      expect(messages.map((message) => message.parts)).toEqual([
        [{ type: "text", text: "Tell me about Dana" }],
        [{ type: "removed" }],
      ]);
      expect(await tablesHolding("MARKER-185-H")).toEqual([]);
    });
  },
);
