// Memory's public types: what it learns from, what learning did, and an object as a reader sees
// it (ADR-0022).
import { z } from "zod";

/** The apps memory learns from. Drive and Calendar join with their tickets. */
export const MEMORY_APPS = ["gmail"] as const;
export type MemoryApp = (typeof MEMORY_APPS)[number];

/** The kinds of object memory holds. */
export const OBJECT_KINDS = ["person", "company", "deal", "project", "document"] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];

/**
 * Exact identifiers an object is matched on, each unique in an org: a person's email address, a
 * company's domain. Drive file IDs and CRM IDs join later.
 */
export const OBJECT_KEY_KINDS = ["email", "domain"] as const;
export type ObjectKeyKind = (typeof OBJECT_KEY_KINDS)[number];

/** One item to learn from: what discovery's `discovery/item.stored` points at. */
export const itemToLearnSchema = z.object({
  connectionId: z.string().min(1),
  app: z.enum(MEMORY_APPS),
  sourceRef: z.string().min(1),
});
export type ItemToLearn = z.infer<typeof itemToLearnSchema>;

/**
 * What learning from one item did: stored facts about objects (a copy of an item learned
 * already reuses its facts), skipped it, or found its connection or the item gone.
 */
export type LearnOutcome =
  | { outcome: "learned"; objects: number; facts: number }
  | { outcome: "skipped"; reason: "known" | "not_business" | "nothing_stated" }
  | { outcome: "gone" };

/** How a reader names an object: by its ID, or by one of its exact keys. */
export type ObjectLookup = { id: string } | { key: { kind: ObjectKeyKind; value: string } };

/** Where a fact came from: a pointer to re-fetch the item, never its content. */
export type FactSource = {
  app: MemoryApp;
  connectionId: string;
  sourceRef: string;
  occurredAt: Date;
};

/** A fact as one reader sees it: with only the sources that reader can see. */
export type MemoryFact = {
  id: string;
  statement: string;
  predicate: string | null;
  value: string | null;
  // The other object the fact links its subject to ("Dana works at Acme").
  linkedObject: { id: string; kind: ObjectKind; name: string } | null;
  // When it became true and stopped being true, as far as its sources say.
  validFrom: Date | null;
  validUntil: Date | null;
  // When memory recorded it.
  recordedAt: Date;
  sources: FactSource[];
};

/** An object with the facts about it its reader can see. */
export type MemoryObject = {
  id: string;
  kind: ObjectKind;
  name: string;
  keys: { kind: ObjectKeyKind; value: string }[];
  facts: MemoryFact[];
};

/** The most facts one search returns. */
export const MAX_SEARCH_RESULTS = 50;

const searchLimit = z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional();

/**
 * A search of memory: by text (its words, and any email address or domain in it), or by one
 * exact key. `limit` caps the facts returned (20 by default).
 */
export const memorySearchSchema = z.union([
  z.object({ text: z.string().trim().min(1).max(500), limit: searchLimit }),
  z.object({
    key: z.object({
      kind: z.enum(OBJECT_KEY_KINDS),
      value: z.string().trim().toLowerCase().min(1).max(320),
    }),
    limit: searchLimit,
  }),
]);
export type MemorySearch = z.input<typeof memorySearchSchema>;

/** An object a search found, without its facts (`readObject` reads them). */
export type FoundObject = Omit<MemoryObject, "facts">;

/** A fact a search found, with the object it's about. */
export type FoundFact = MemoryFact & { subject: { id: string; kind: ObjectKind; name: string } };

/** What a search found that its caller can see, best match first. */
export type MemorySearchResult = { objects: FoundObject[]; facts: FoundFact[] };

/**
 * Who or what is reading memory, which every read logs (ADR-0024). The ctx says whose view it
 * reads in; this says on whose behalf: the person acting directly (the default), the builder
 * chat for the admin using it, or a workflow run, as its enablement's member (member
 * credentials) or company-wide only (org credentials, the system ctx).
 */
export const memoryReaderSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("person") }),
  z.object({ kind: z.literal("builder") }),
  z.object({
    kind: z.literal("workflow_run"),
    runId: z.string().min(1),
    workflowId: z.string().min(1),
  }),
]);
export type MemoryReader = z.infer<typeof memoryReaderSchema>;

/** The readers the access log names: as above, plus our staff and Mycel itself (system ctx). */
export const ACCESS_LOG_READER_KINDS = [
  "person",
  "builder",
  "workflow_run",
  "staff",
  "system",
] as const;
export type AccessLogReaderKind = (typeof ACCESS_LOG_READER_KINDS)[number];

/** The reads the access log records. */
export const MEMORY_READ_OPERATIONS = ["search", "read_object"] as const;
export type MemoryReadOperation = (typeof MEMORY_READ_OPERATIONS)[number];

/** How long the access log keeps an entry (ADR-0024 asks for at least 90 days). */
export const ACCESS_LOG_RETENTION_DAYS = 365;

/**
 * One read of memory as the access log shows it: who or what read, when, and which objects and
 * how many facts, never the query or what the facts say. An object's name shows only when the
 * log's viewer can see one of the facts read that is about it or links to it (otherwise it's
 * null), so the log widens no one's view.
 */
export type AccessLogEntry = {
  id: string;
  readAt: Date;
  operation: MemoryReadOperation;
  reader: {
    kind: AccessLogReaderKind;
    // The person, the builder's admin, a member-credential run's member, or the admin whose
    // consent our staff read under; null for Mycel itself and an org-credential run.
    userId: string | null;
    name: string | null;
    runId: string | null;
    workflowId: string | null;
    staff: { email: string; reason: string } | null;
  };
  objects: { id: string; name: string | null }[];
  factCount: number;
};

/** The longest an admin can let our staff read memory for one case. */
export const MAX_STAFF_CONSENT_DAYS = 30;

/** An admin's consent for one of our staff to read memory for one case (ADR-0024). */
export const staffConsentInputSchema = z.object({
  staffEmail: z.string().trim().toLowerCase().max(320).pipe(z.email()),
  // The case: what the staff member is looking into, in the admin's words.
  reason: z.string().trim().min(1).max(500),
  days: z.coerce.number().int().min(1).max(MAX_STAFF_CONSENT_DAYS),
});
export type StaffConsentInput = z.input<typeof staffConsentInputSchema>;

/**
 * A staff consent as admins see it. Our staff read in the view of the admin who granted it, so
 * a consent never shows them more than that admin can see.
 */
export type StaffConsent = {
  id: string;
  staffEmail: string;
  reason: string;
  grantedBy: { userId: string; name: string };
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

/** Which consent a staff read goes through, and who at Mycel is reading. */
export type StaffAccess = { consentId: string; staffEmail: string };
