import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { resolveModel, setModelRole } from "../server";

beforeEach(resetDatabase);

describe("resolveModel", () => {
  it("uses the config default when the org has no row for the role", async () => {
    const { orgA } = await seedTwoOrgs();

    expect(await resolveModel(orgA.admin.ctx, "classify")).toBe("typesafe-ai/jev-1.14.0");
    expect(await resolveModel(orgA.admin.ctx, "fast")).toBe("test/fast-default");
  });

  it("uses the org's own row over the default, for that role only", async () => {
    const { orgA } = await seedTwoOrgs();

    await setModelRole(orgA.admin.ctx, "fast", "openai/gpt-x-mini");

    expect(await resolveModel(orgA.admin.ctx, "fast")).toBe("openai/gpt-x-mini");
    expect(await resolveModel(orgA.admin.ctx, "smart")).toBe("test/smart-default");
  });

  it("replaces an org's row when the role is set again", async () => {
    const { orgA } = await seedTwoOrgs();

    await setModelRole(orgA.admin.ctx, "fast", "openai/one");
    await setModelRole(orgA.admin.ctx, "fast", "openai/two");

    expect(await resolveModel(orgA.admin.ctx, "fast")).toBe("openai/two");
  });

  it("lets only an admin set a role", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(setModelRole(orgA.member.ctx, "fast", "openai/x")).rejects.toThrow(ForbiddenError);
    expect(await resolveModel(orgA.admin.ctx, "fast")).toBe("test/fast-default");
  });

  it("refuses a model ID that isn't provider/model", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(setModelRole(orgA.admin.ctx, "fast", "gpt")).rejects.toThrow(ValidationError);
  });
});
