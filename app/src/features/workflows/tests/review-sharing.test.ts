// What reviews need from a workflow (ADR-0013): whether the caller can see it through its tags,
// so they may see its org reviews, and whether its latest version lets a review be handed on.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { unassignTag } from "@/features/tags/server";
import { systemCtx } from "@/lib/ctx";
import { connectGmail } from "@/testing/connect-helpers";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import {
  getWorkflow,
  previewPublish,
  publishWorkflow,
  reviewSharing,
  saveWorkflow,
} from "../server";
import { draftSpec } from "./specs";

beforeEach(resetDatabase);

async function salesWorkflow() {
  const orgs = await seedTwoOrgs();
  const { admin, member } = orgs.orgA;
  await connectGmail(admin.ctx, admin.email);
  const sales = await tagUsers(admin.ctx, "sales", [member]);
  const pricing = await publishTo(admin.ctx, "Pricing replies", draftSpec(), ["sales"]);
  return { ...orgs, admin, member, sales, pricing };
}

describe("the hand-off setting", () => {
  it("is chosen as the admin publishes, and the working spec keeps it", async () => {
    const { admin, pricing } = await salesWorkflow();

    const version = await publishWorkflow(admin.ctx, pricing.workflowId, { handoff: true });

    expect(version.spec.review).toEqual({ handoff: true });
    expect((await getWorkflow(admin.ctx, pricing.workflowId)).workingSpec.review).toEqual({
      handoff: true,
    });
  });

  it("isn't a risk change: publishing it pauses nobody", async () => {
    const { admin, pricing } = await salesWorkflow();
    const { workingSpec } = await getWorkflow(admin.ctx, pricing.workflowId);

    const preview = await previewPublish(admin.ctx, pricing.workflowId, {
      ...workingSpec,
      review: { handoff: true },
    });

    expect(preview).toEqual({ gained: null, pauses: 0 });
  });
});

describe("reviewSharing", () => {
  it("says who sees each workflow through its tags, and whether its reviews can be handed on", async () => {
    const { orgA, admin, member, pricing } = await salesWorkflow();
    const { id } = await saveWorkflow(admin.ctx, {
      name: "Handed on",
      spec: draftSpec({
        id: "handed-on",
        visibility: { tags: ["sales"] },
        review: { handoff: true },
      }),
    });
    await publishWorkflow(admin.ctx, id);
    const untagged = await seedUser(orgA.id, "untagged@org-a.test", "member");
    const ids = [pricing.workflowId, id];

    expect(await reviewSharing(member.ctx, ids)).toEqual(
      new Map([
        [pricing.workflowId, { seen: true, handOff: false }],
        [id, { seen: true, handOff: true }],
      ]),
    );
    expect(await reviewSharing(untagged.ctx, ids)).toEqual(
      new Map([
        [pricing.workflowId, { seen: false, handOff: false }],
        [id, { seen: false, handOff: true }],
      ]),
    );
    for (const ctx of [admin.ctx, systemCtx(orgA.id)]) {
      expect((await reviewSharing(ctx, ids)).get(id)).toEqual({ seen: true, handOff: true });
    }
  });

  it("follows the tags as they are now", async () => {
    const { admin, member, sales, pricing } = await salesWorkflow();

    await unassignTag(admin.ctx, sales, member.id);

    expect((await reviewSharing(member.ctx, [pricing.workflowId])).get(pricing.workflowId)).toEqual(
      { seen: false, handOff: false },
    );
  });

  it("follows the latest version", async () => {
    const { admin, pricing } = await salesWorkflow();

    await publishWorkflow(admin.ctx, pricing.workflowId, { handoff: true });
    expect((await reviewSharing(admin.ctx, [pricing.workflowId])).get(pricing.workflowId)).toEqual({
      seen: true,
      handOff: true,
    });
    await publishWorkflow(admin.ctx, pricing.workflowId, { handoff: false });
    expect((await reviewSharing(admin.ctx, [pricing.workflowId])).get(pricing.workflowId)).toEqual({
      seen: true,
      handOff: false,
    });
  });

  it("has no entry for a workflow never published or in another org", async () => {
    const { orgB, admin } = await salesWorkflow();
    const { id } = await saveWorkflow(admin.ctx, {
      name: "Unpublished",
      spec: draftSpec({ id: "unpublished" }),
    });
    await connectGmail(orgB.admin.ctx, orgB.admin.email);
    const other = await publishTo(orgB.admin.ctx, "Org B's", draftSpec(), []);

    expect(await reviewSharing(admin.ctx, [id, other.workflowId])).toEqual(new Map());
  });
});
