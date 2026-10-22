// Each registered app's operation index (ADR-0018): built by `pnpm api-index` from the API
// description copied into the repo, in the form the builder chat's lookup searches.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { registeredApps } from "@/features/connections/registered-apps";
import { apiIndexPath, apiIndexSchema, buildApiIndex } from "../api-index";

// Vitest runs from `app/`, which the paths are relative to.
const read = (path: string) => readFileSync(join(process.cwd(), path));

describe("each registered app's operation index", () => {
  it("was built from its API description as copied: run `pnpm api-index` when this fails", () => {
    for (const app of registeredApps) {
      const index = apiIndexSchema.parse(
        JSON.parse(gunzipSync(read(apiIndexPath(app.id))).toString("utf8")),
      );
      expect(index.app).toBe(app.id);
      expect(index.sources).toEqual(
        app.apiDescription.files.map(({ path }) => ({
          path,
          sha256: createHash("sha256").update(read(path)).digest("hex"),
        })),
      );
      expect(index.operations.length).toBeGreaterThan(100);
    }
  });
});

/** A small OpenAPI description in Microsoft Graph's style, for a made-up contacts API. */
const contactsApi = {
  openapi: "3.0.4",
  servers: [{ url: "https://graph.microsoft.com/v1.0" }],
  paths: {
    "/me/contacts/{contact-id}": {
      parameters: [{ $ref: "#/components/parameters/contactId" }],
      get: {
        summary: "Get contact",
        description: "Read one contact. It has many details.",
        operationId: "me.GetContact",
        parameters: [
          {
            name: "$select",
            in: "query",
            description: "Select properties",
            schema: { type: "array", items: { type: "string" } },
          },
          { name: "If-Match", in: "header", schema: { type: "string" } },
        ],
        responses: {
          "2XX": {
            content: { "application/json": { schema: { $ref: "#/components/schemas/contact" } } },
          },
        },
      },
      patch: {
        operationId: "me.UpdateContact",
        requestBody: { $ref: "#/components/requestBodies/contactBody" },
        responses: { "204": { description: "Success" } },
      },
    },
    "/users/{user-id}/contacts/{contact-id}": {
      get: { operationId: "users.GetContact", responses: {} },
    },
    "/me/contacts/$count": { get: { operationId: "me.contacts.GetCount", responses: {} } },
  },
  components: {
    schemas: {
      entity: { type: "object", properties: { id: { type: "string", description: "Its ID." } } },
      contact: {
        allOf: [
          { $ref: "#/components/schemas/entity" },
          {
            type: "object",
            properties: {
              displayName: { type: "string", nullable: true },
              birthday: { type: "string", format: "date-time" },
              emails: { type: "array", items: { $ref: "#/components/schemas/email" } },
              kind: {
                anyOf: [{ $ref: "#/components/schemas/kind" }, { type: "object", nullable: true }],
              },
            },
          },
        ],
      },
      email: { type: "object", properties: { address: { type: "string" } } },
      kind: { type: "string", enum: ["person", "company"] },
    },
    parameters: {
      contactId: { name: "contact-id", in: "path", required: true, schema: { type: "string" } },
    },
    requestBodies: {
      contactBody: {
        content: { "application/json": { schema: { $ref: "#/components/schemas/contact" } } },
      },
    },
  },
};

describe("building an index from an OpenAPI description", () => {
  const index = buildApiIndex("microsoft", [
    { path: "contacts.yaml", sha256: "abc", content: contactsApi },
  ]);

  it("lists each operation from the app's root, its placeholders named as inputs", () => {
    expect(index.sources).toEqual([{ path: "contacts.yaml", sha256: "abc" }]);
    // The `/users/{userId}` copy of a `/me` call and OData's counts are left out.
    expect(index.operations).toEqual([
      {
        method: "GET",
        path: "/v1.0/me/contacts/{contactId}",
        id: "me.GetContact",
        summary: "Get contact Read one contact.",
        // Path and query parameters only: a custom action sets no headers.
        parameters: [
          { name: "contactId", in: "path", required: true, type: "text" },
          { name: "$select", in: "query", required: false, type: "list of text" },
        ],
        response: "contact",
      },
      {
        method: "PATCH",
        path: "/v1.0/me/contacts/{contactId}",
        id: "me.UpdateContact",
        summary: "",
        parameters: [{ name: "contactId", in: "path", required: true, type: "text" }],
        body: "contact",
      },
    ]);
  });

  it("flattens each type it reaches to its fields, inherited ones included", () => {
    expect(index.types).toEqual({
      contact: {
        fields: [
          { name: "id", type: "text", description: "Its ID." },
          { name: "displayName", type: "text" },
          { name: "birthday", type: "text (date-time)" },
          { name: "emails", type: "list of email" },
          { name: "kind", type: "kind" },
        ],
      },
      email: { fields: [{ name: "address", type: "text" }] },
      kind: { fields: [] },
    });
  });
});

describe("building an index from Google's Discovery documents", () => {
  it("names each API's types after it, and its paths from the API's root", () => {
    const index = buildApiIndex("google", [
      {
        path: "tasks.json",
        sha256: "def",
        content: {
          kind: "discovery#restDescription",
          name: "tasks",
          servicePath: "",
          resources: {
            tasks: {
              methods: {
                insert: {
                  id: "tasks.tasks.insert",
                  httpMethod: "POST",
                  path: "tasks/v1/lists/{tasklist}/tasks",
                  description: "Creates a new task.",
                  parameters: {
                    tasklist: { type: "string", location: "path", required: true },
                    parent: { type: "string", location: "query", description: "Parent task." },
                  },
                  request: { $ref: "Task" },
                  response: { $ref: "Task" },
                },
              },
            },
          },
          schemas: {
            Task: {
              type: "object",
              properties: {
                title: { type: "string", description: "Title of the task." },
                due: { type: "string" },
                links: {
                  type: "array",
                  items: { type: "object", properties: { link: { type: "string" } } },
                },
              },
            },
          },
        },
      },
    ]);

    expect(index.operations).toEqual([
      {
        method: "POST",
        path: "/tasks/v1/lists/{tasklist}/tasks",
        id: "tasks.tasks.insert",
        summary: "Creates a new task.",
        parameters: [
          { name: "tasklist", in: "path", required: true, type: "text" },
          {
            name: "parent",
            in: "query",
            required: false,
            type: "text",
            description: "Parent task.",
          },
        ],
        body: "tasks.Task",
        response: "tasks.Task",
      },
    ]);
    expect(index.types).toEqual({
      "tasks.Task": {
        fields: [
          { name: "title", type: "text", description: "Title of the task." },
          { name: "due", type: "text" },
          { name: "links", type: "list of tasks.Task.links" },
        ],
      },
      "tasks.Task.links": { fields: [{ name: "link", type: "text" }] },
    });
  });
});
