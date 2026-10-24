// The catalog's Docs actions (#71): reading a Doc, and suggesting edits to one that change nothing
// until a person accepts them from the review (ADR-0017). Their risk levels are fixed here, as the
// rest of the catalog's are in `catalog.ts`, which lists them with the others.
import { z } from "zod";
import { GOOGLE_HOSTS, googleScope as scope } from "@/lib/google";
import { docsRequestSchema } from "./docs-requests";
import type { CatalogAction } from "./types";

const DOCS_HOST = GOOGLE_HOSTS.docs;
const DOCS_READ = [
  scope("documents"),
  scope("documents.readonly"),
  scope("drive"),
  scope("drive.readonly"),
];
const DOCS_WRITE = [scope("documents"), scope("drive")];

const id = z.string().min(1);

export const docsActions = [
  {
    kind: "catalog",
    name: "google-docs.read-document",
    app: "Docs",
    description: "Read one Google Doc: its title and its text, without any suggested edits.",
    risk: "read",
    integration: "google",
    host: DOCS_HOST,
    scopes: DOCS_READ,
    input: z.object({ documentId: id }),
    // Its title and text pass to later steps, never into run records (ADR-0021).
    output: z.object({ documentId: id, title: z.string(), text: z.string() }),
  },
  {
    kind: "catalog",
    name: "google-docs.suggest-edits",
    app: "Docs",
    description:
      "Suggest edits to a Google Doc, as a person in suggesting mode would: `requests` are " +
      "Docs batchUpdate requests (such as insertText at endOfSegmentLocation, or " +
      "replaceAllText), and nothing in the doc changes until a person approves them (accepting " +
      "the suggestions) or declines them (rejecting them).",
    pendingForm: "suggested edits in the doc, accepted or rejected from the review",
    channel: "suggested_edits",
    risk: "external_send",
    integration: "google",
    host: DOCS_HOST,
    scopes: DOCS_WRITE,
    input: z.object({ documentId: id, requests: z.array(docsRequestSchema).min(1).max(100) }),
    // Pointers only: the suggested text stays in the doc.
    output: z.object({ documentId: id, suggestionIds: z.array(id) }),
  },
] as const satisfies readonly CatalogAction[];
