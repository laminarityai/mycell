// "What I've told Mycel" as the page draws it: each note with who or what it's about, what it
// replaced, and Delete; the older notes, struck through, only when asked for; and an empty table
// that says how to tell Mycel something.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { listToldFacts, tellFact } from "@/features/memory/server";
import type { Ctx } from "@/lib/ctx";
import { grantOnly, scriptTelling } from "@/testing/memory-learning";
import { TOLD_FACTS_PATH } from "../types";
import { ToldFactsLink, ToldTable } from "../ui";

beforeEach(resetDatabase);

const OLD = "Acme's renewals go through Tom.";
const NEW = "Acme's renewals go through Priya, not Tom.";
const GLOBEX = "Priya Shah runs Globex.";

async function tell(ctx: Ctx, about: Parameters<typeof tellFact>[1]["about"], statement: string) {
  scriptTelling({ predicate: "renewal_contact", value: "someone" });
  const told = await tellFact(ctx, { about, statement });
  if (!told.saved) throw new Error(`Not saved: ${told.reason}`);
}

async function page(ctx: Ctx, includeOlder = false) {
  const listed = await listToldFacts(ctx, { includeOlder });
  return renderToStaticMarkup(
    createElement(ToldTable, { notes: listed.notes, total: listed.total }),
  );
}

describe("the told-facts table", () => {
  it("shows each note with who it's about, what it replaced, and Delete", async () => {
    const { orgA } = await seedTwoOrgs();
    await grantOnly(orgA.id);
    const member = orgA.member.ctx;
    await tell(member, { domain: "acme.example", name: "Acme" }, OLD);
    await tell(member, { domain: "acme.example" }, NEW);
    await tell(member, { email: "priya@globex.example", name: "Priya Shah" }, GLOBEX);

    const html = await page(member);

    expect(html).toContain("Acme");
    expect(html).toContain("acme.example");
    expect(html).toContain("priya@globex.example");
    expect(html).toContain(NEW.replaceAll("'", "&#x27;"));
    expect(html).toContain(`<span class="line-through">${OLD.replaceAll("'", "&#x27;")}</span>`);
    expect(html).toContain(`aria-label="Delete “${GLOBEX}”"`);
    expect(html).toContain("<time");
    expect(html).not.toContain("Older note");

    const older = await page(member, true);
    expect(older).toContain("Older note");
    expect(older).toContain("Replaced <time");
  });

  it("says how to tell Mycel something when there's nothing yet", async () => {
    const { orgA } = await seedTwoOrgs();

    expect(await page(orgA.member.ctx)).toContain("You haven&#x27;t told Mycel anything yet.");
  });
});

describe("the chat header", () => {
  it("links to the told-facts page", () => {
    const html = renderToStaticMarkup(createElement(ToldFactsLink));
    expect(html).toContain(`href="${TOLD_FACTS_PATH}"`);
  });
});
