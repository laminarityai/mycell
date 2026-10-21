import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  assignTag,
  createTag,
  deleteTag,
  findTagsByName,
  listMyTags,
  listTags,
  renameTag,
  unassignTag,
} from "../server";

beforeEach(resetDatabase);

describe("createTag", () => {
  it("adds a tag the admin then sees with no users", async () => {
    const { orgA } = await seedTwoOrgs();

    const tag = await createTag(orgA.admin.ctx, "sales");

    expect(await listTags(orgA.admin.ctx)).toEqual([{ id: tag.id, name: "sales", userIds: [] }]);
  });

  it("normalizes the name to a lowercase slug", async () => {
    const { orgA } = await seedTwoOrgs();

    const tag = await createTag(orgA.admin.ctx, "  Support   Team ");

    expect(tag.name).toBe("support-team");
  });

  it.each([
    ["empty", "   "],
    ["starting with a digit", "9-lives"],
    ["with symbols", "sales!"],
    ["with doubled hyphens", "ops--emea"],
    ["over 40 characters", "a".repeat(41)],
  ])("rejects a name %s", async (_why, name) => {
    const { orgA } = await seedTwoOrgs();

    await expect(createTag(orgA.admin.ctx, name)).rejects.toThrow(ValidationError);
    expect(await listTags(orgA.admin.ctx)).toEqual([]);
  });

  it("refuses a name the org already has, whatever its case", async () => {
    const { orgA } = await seedTwoOrgs();
    await createTag(orgA.admin.ctx, "sales");

    await expect(createTag(orgA.admin.ctx, "Sales")).rejects.toThrow(ConflictError);
    expect(await listTags(orgA.admin.ctx)).toHaveLength(1);
  });

  it("allows a name another org already has", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    await createTag(orgB.admin.ctx, "sales");

    await createTag(orgA.admin.ctx, "sales");

    expect((await listTags(orgA.admin.ctx)).map((t) => t.name)).toEqual(["sales"]);
  });

  it("refuses a member", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(createTag(orgA.member.ctx, "sales")).rejects.toThrow(ForbiddenError);
    expect(await listTags(orgA.admin.ctx)).toEqual([]);
  });
});

describe("listTags", () => {
  it("refuses a member, who sees only their own tags", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(listTags(orgA.member.ctx)).rejects.toThrow(ForbiddenError);
  });
});

describe("renameTag", () => {
  it("renames the tag, normalizing the new name", async () => {
    const { orgA } = await seedTwoOrgs();
    const tag = await createTag(orgA.admin.ctx, "sales");

    await renameTag(orgA.admin.ctx, tag.id, "Inside Sales");

    expect(await listTags(orgA.admin.ctx)).toEqual([
      { id: tag.id, name: "inside-sales", userIds: [] },
    ]);
  });

  it("refuses a name another of the org's tags has", async () => {
    const { orgA } = await seedTwoOrgs();
    await createTag(orgA.admin.ctx, "sales");
    const support = await createTag(orgA.admin.ctx, "support");

    await expect(renameTag(orgA.admin.ctx, support.id, "SALES")).rejects.toThrow(ConflictError);
  });

  it("treats another org's tag as if it doesn't exist", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    const tag = await createTag(orgB.admin.ctx, "sales");

    await expect(renameTag(orgA.admin.ctx, tag.id, "hijacked")).rejects.toThrow(NotFoundError);
    expect((await listTags(orgB.admin.ctx)).map((t) => t.name)).toEqual(["sales"]);
  });

  it("refuses a member", async () => {
    const { orgA } = await seedTwoOrgs();
    const tag = await createTag(orgA.admin.ctx, "sales");

    await expect(renameTag(orgA.member.ctx, tag.id, "ops")).rejects.toThrow(ForbiddenError);
  });
});

describe("assignTag", () => {
  it("gives users tags, and a user many tags", async () => {
    const { orgA } = await seedTwoOrgs();
    const sales = await createTag(orgA.admin.ctx, "sales");
    const support = await createTag(orgA.admin.ctx, "support");

    await assignTag(orgA.admin.ctx, sales.id, orgA.member.id);
    await assignTag(orgA.admin.ctx, sales.id, orgA.admin.id);
    await assignTag(orgA.admin.ctx, support.id, orgA.member.id);

    expect(await listTags(orgA.admin.ctx)).toEqual([
      { id: sales.id, name: "sales", userIds: [orgA.admin.id, orgA.member.id].sort() },
      { id: support.id, name: "support", userIds: [orgA.member.id] },
    ]);
  });

  it("does nothing when the user already has the tag", async () => {
    const { orgA } = await seedTwoOrgs();
    const sales = await createTag(orgA.admin.ctx, "sales");
    await assignTag(orgA.admin.ctx, sales.id, orgA.member.id);

    await assignTag(orgA.admin.ctx, sales.id, orgA.member.id);

    expect((await listTags(orgA.admin.ctx))[0]?.userIds).toEqual([orgA.member.id]);
  });

  it("treats a user from another org as if they don't exist", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    const sales = await createTag(orgA.admin.ctx, "sales");

    await expect(assignTag(orgA.admin.ctx, sales.id, orgB.member.id)).rejects.toThrow(
      NotFoundError,
    );
    expect((await listTags(orgA.admin.ctx))[0]?.userIds).toEqual([]);
  });

  it("treats another org's tag as if it doesn't exist", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    const orgBTag = await createTag(orgB.admin.ctx, "sales");

    await expect(assignTag(orgA.admin.ctx, orgBTag.id, orgA.member.id)).rejects.toThrow(
      NotFoundError,
    );
    expect((await listTags(orgB.admin.ctx))[0]?.userIds).toEqual([]);
  });

  it("refuses a member", async () => {
    const { orgA } = await seedTwoOrgs();
    const sales = await createTag(orgA.admin.ctx, "sales");

    await expect(assignTag(orgA.member.ctx, sales.id, orgA.member.id)).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("unassignTag", () => {
  it("takes the tag off that user only", async () => {
    const { orgA } = await seedTwoOrgs();
    const sales = await createTag(orgA.admin.ctx, "sales");
    await assignTag(orgA.admin.ctx, sales.id, orgA.member.id);
    await assignTag(orgA.admin.ctx, sales.id, orgA.admin.id);

    await unassignTag(orgA.admin.ctx, sales.id, orgA.member.id);

    expect((await listTags(orgA.admin.ctx))[0]?.userIds).toEqual([orgA.admin.id]);
  });

  it("treats another org's tag as if it doesn't exist", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    const orgBTag = await createTag(orgB.admin.ctx, "sales");
    await assignTag(orgB.admin.ctx, orgBTag.id, orgB.member.id);

    await expect(unassignTag(orgA.admin.ctx, orgBTag.id, orgB.member.id)).rejects.toThrow(
      NotFoundError,
    );
    expect((await listTags(orgB.admin.ctx))[0]?.userIds).toEqual([orgB.member.id]);
  });

  it("refuses a member", async () => {
    const { orgA } = await seedTwoOrgs();
    const sales = await createTag(orgA.admin.ctx, "sales");

    await expect(unassignTag(orgA.member.ctx, sales.id, orgA.member.id)).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("deleteTag", () => {
  it("deletes the tag and its assignments", async () => {
    const { orgA } = await seedTwoOrgs();
    const sales = await createTag(orgA.admin.ctx, "sales");
    await assignTag(orgA.admin.ctx, sales.id, orgA.member.id);

    await deleteTag(orgA.admin.ctx, sales.id);

    expect(await listTags(orgA.admin.ctx)).toEqual([]);
    expect(await listMyTags(orgA.member.ctx)).toEqual([]);
  });

  it("treats another org's tag as if it doesn't exist", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    const orgBTag = await createTag(orgB.admin.ctx, "sales");

    await expect(deleteTag(orgA.admin.ctx, orgBTag.id)).rejects.toThrow(NotFoundError);
    expect(await listTags(orgB.admin.ctx)).toHaveLength(1);
  });

  it("refuses a member", async () => {
    const { orgA } = await seedTwoOrgs();
    const sales = await createTag(orgA.admin.ctx, "sales");

    await expect(deleteTag(orgA.member.ctx, sales.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("listMyTags", () => {
  it("lists only the caller's own tags, for a member too", async () => {
    const { orgA } = await seedTwoOrgs();
    const sales = await createTag(orgA.admin.ctx, "sales");
    const support = await createTag(orgA.admin.ctx, "support");
    await createTag(orgA.admin.ctx, "ops");
    await assignTag(orgA.admin.ctx, support.id, orgA.member.id);
    await assignTag(orgA.admin.ctx, sales.id, orgA.member.id);
    await assignTag(orgA.admin.ctx, sales.id, orgA.admin.id);

    expect(await listMyTags(orgA.member.ctx)).toEqual([
      { id: sales.id, name: "sales" },
      { id: support.id, name: "support" },
    ]);
    expect(await listMyTags(orgA.admin.ctx)).toEqual([{ id: sales.id, name: "sales" }]);
  });
});

describe("findTagsByName", () => {
  it("finds each named tag once, in the order named", async () => {
    const { orgA } = await seedTwoOrgs();
    const sales = await createTag(orgA.admin.ctx, "sales");
    const support = await createTag(orgA.admin.ctx, "support");

    expect(await findTagsByName(orgA.admin.ctx, ["support", "sales", "support"])).toEqual([
      { id: support.id, name: "support" },
      { id: sales.id, name: "sales" },
    ]);
    expect(await findTagsByName(orgA.admin.ctx, [])).toEqual([]);
  });

  it("refuses a name no tag has, naming it", async () => {
    const { orgA } = await seedTwoOrgs();
    await createTag(orgA.admin.ctx, "sales");

    const finding = findTagsByName(orgA.admin.ctx, ["sales", "slaes"]);

    await expect(finding).rejects.toThrow(ValidationError);
    await expect(finding).rejects.toThrow(/"slaes"/);
  });

  it("is refused to a member", async () => {
    const { orgA } = await seedTwoOrgs();
    await createTag(orgA.admin.ctx, "sales");

    await expect(findTagsByName(orgA.member.ctx, ["sales"])).rejects.toThrow(ForbiddenError);
  });
});
