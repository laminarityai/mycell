// The fixed rule that sets a custom action's risk level from the call it makes (ADR-0018):
// nothing a model says about the level reaches it.
import { describe, expect, it } from "vitest";
import { customActionRisk } from "../custom-risk";

const app = { accountingOrPayments: false };
const accounting = { accountingOrPayments: true };

describe("a custom action's risk level", () => {
  it("is read for a GET", () => {
    expect(customActionRisk({ method: "GET", path: "/v1.0/me/messages/{messageId}" }, app)).toEqual(
      { ok: true, risk: "read" },
    );
  });

  it("is external_send for a POST, PUT or PATCH", () => {
    for (const method of ["POST", "PUT", "PATCH"] as const) {
      expect(customActionRisk({ method, path: "/v1.0/me/events" }, app)).toEqual({
        ok: true,
        risk: "external_send",
      });
    }
  });

  it("is read for a GraphQL query, written out or as the shorthand", () => {
    for (const graphql of [
      "query Issue($id: String!) { issue(id: $id) { title } }",
      "# who am I\n{ viewer { name } }",
      'fragment F on Issue { title }\nquery { issue(id: "x") { ...F } }',
    ]) {
      expect(customActionRisk({ graphql, path: "/graphql" }, app)).toEqual({
        ok: true,
        risk: "read",
      });
    }
  });

  it("is external_send for a GraphQL mutation", () => {
    const graphql = "mutation Update($id: String!) { issueUpdate(id: $id) { success } }";

    expect(customActionRisk({ graphql, path: "/graphql" }, app)).toEqual({
      ok: true,
      risk: "external_send",
    });
  });

  it("refuses a GraphQL document that isn't exactly one query or mutation", () => {
    for (const graphql of [
      "subscription { issues { title } }",
      "query A { a } query B { b }",
      "fragment F on Issue { title }",
      "{ unclosed",
    ]) {
      expect(customActionRisk({ graphql, path: "/graphql" }, app)).toMatchObject({ ok: false });
    }
  });

  it("refuses a DELETE", () => {
    expect(customActionRisk({ method: "DELETE", path: "/v1.0/me/events/{id}" }, app)).toEqual({
      ok: false,
      reason: "A custom action can't delete.",
    });
  });

  it("refuses a path or operation whose name says delete, remove, void, refund, cancel, archive or purge", () => {
    for (const path of [
      "/v1.0/me/events/{id}/cancel",
      "/v1/invoices/{id}/void",
      "/v1/charges/{id}/refunds",
      "/v1/items/remove",
      "/v1/softDelete/{id}",
      "/v1/purge_cache",
      "/v1.0/me/mailFolders/archive/messages",
    ]) {
      expect(customActionRisk({ method: "GET", path }, app), path).toMatchObject({ ok: false });
    }
    const graphql = "mutation { issueArchive(id: $id) { success } }";
    expect(customActionRisk({ graphql, path: "/graphql" }, app)).toMatchObject({ ok: false });
  });

  it("allows names that only look alike", () => {
    for (const path of ["/v1/voices/{id}", "/v1/removable-media", "/v1/archetypes"]) {
      expect(customActionRisk({ method: "GET", path }, app), path).toEqual({
        ok: true,
        risk: "read",
      });
    }
  });

  it("refuses any write in an accounting or payments app, and allows its reads", () => {
    expect(customActionRisk({ method: "POST", path: "/v1/invoices" }, accounting)).toEqual({
      ok: false,
      reason: "A custom action can only read in an accounting or payments app.",
    });
    const mutation = "mutation { invoiceCreate { id } }";
    expect(customActionRisk({ graphql: mutation, path: "/graphql" }, accounting)).toMatchObject({
      ok: false,
    });
    expect(customActionRisk({ method: "GET", path: "/v1/invoices" }, accounting)).toEqual({
      ok: true,
      risk: "read",
    });
  });
});
