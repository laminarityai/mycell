// Memory's public types: what it learns from, what learning did, and an object as a reader sees
// it (ADR-0022).
import { z } from "zod";

/** The apps memory learns from: Gmail messages and Drive docs. Calendar joins with its ticket. */
export const MEMORY_APPS = ["gmail", "drive"] as const;
export type MemoryApp = (typeof MEMORY_APPS)[number];

/**
 * Why learning put an item off: the month's budget is spent (it's tried again when the month
 * starts or the budget changes), the org ran out of credits (tried again when credits are
 * granted), or the injection screen kept failing (tried again hourly).
 */
export const POSTPONE_REASONS = ["budget", "credits", "screen"] as const;
export type PostponeReason = (typeof POSTPONE_REASONS)[number];

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
 * An item gone from a connection's app: what discovery's `discovery/item.removed` points at.
 * `itemId` is a Gmail message ID, or a Drive file ID (every version of the file).
 */
export const removedItemSchema = z.object({
  connectionId: z.string().min(1),
  app: z.enum(MEMORY_APPS),
  itemId: z.string().min(1),
});
export type RemovedItem = z.infer<typeof removedItemSchema>;

/**
 * A Drive file changed in place, its sharing perhaps: what discovery's `discovery/item.changed`
 * points at. `sourceRef` is the version it's at.
 */
export const changedItemSchema = z.object({
  connectionId: z.string().min(1),
  app: z.literal("drive"),
  sourceRef: z.string().min(1),
});
export type ChangedItem = z.infer<typeof changedItemSchema>;

/**
 * What reading a file's sharing list again did: rewrote its access lists, deleted what memory
 * learned from it (Drive no longer gives the account the file), found nothing memory learned
 * from it, or couldn't reach it (its connection needs reconnecting).
 */
export type AccessReread = { outcome: "rewritten" | "removed" | "unknown" | "unreachable" };

/**
 * Why learning skipped an item: no admin has started memory yet; it waits to be tried again
 * (`postponed`: the month's budget is spent, the org is out of credits, or the injection screen
 * kept failing); an exclusion covers it; it's from a person an admin
 * asked memory to forget (`forgotten`); learned already (for a
 * Drive file, this version or a newer one); not a kind of item memory reads (a Drive file that
 * isn't a Google Doc); changed since (a Drive file's newer version is learned on its own); the
 * injection screen flagged it, or no screen is configured, so no model read it; not business;
 * or it stated no fact memory keeps.
 */
export type SkipReason =
  | "not_started"
  | "postponed"
  | "excluded"
  | "forgotten"
  | "known"
  | "unsupported"
  | "outdated"
  | "flagged"
  | "unscreened"
  | "not_business"
  | "nothing_stated";

/**
 * What learning from one item did: stored facts about objects (a copy of an item learned
 * already reuses its facts), skipped it, or found its connection or the item gone.
 */
export type LearnOutcome =
  | { outcome: "learned"; objects: number; facts: number }
  | { outcome: "skipped"; reason: SkipReason }
  | { outcome: "gone" };

/** A group address an admin marked company-wide: email sent to it is visible to everyone. */
export type CompanyWideList = { address: string; markedAt: Date };

/** How a reader names an object: by its ID, or by one of its exact keys. */
export type ObjectLookup = { id: string } | { key: { kind: ObjectKeyKind; value: string } };

/** Where a fact came from: a pointer to re-fetch the item, never its content. */
export type FactSource = {
  app: MemoryApp;
  connectionId: string;
  sourceRef: string;
  // What every copy of the item shares (an email's Message-ID, a Drive file's ID), so a copy in a
  // colleague's mailbox can be linked by the item rather than by that mailbox's own ID.
  itemKey: string;
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
  // For a fact stated only from outside the company: the fact from inside, or company-wide,
  // that it contradicts and couldn't replace, so both are current. Only one the reader can see.
  conflictsWith: string | null;
  // Stated only from outside the company, as far as the reader's sources show: none of the
  // sources they can see came from inside (a mailbox's own sent mail, a colleague's doc).
  outsideOnly: boolean;
};

/**
 * Where a fact a reader already read came from, to cite it again (Ask Mycel's footnotes): its
 * sources the reader can see and its markers, never what it says.
 */
export type FactCitation = Pick<MemoryFact, "id" | "sources" | "conflictsWith" | "outsideOnly">;

/**
 * A fact a newer one replaced, as one reader sees it: `supersededBy` is the newer fact they can
 * see that replaced it, and `supersededAt` when memory recorded that.
 */
export type HistoricFact = MemoryFact & { supersededAt: Date; supersededBy: string };

/**
 * An object with the facts about it its reader can see: the current ones, and those a newer
 * fact the reader can see replaced (`history`). A fact replaced only by facts the reader can't
 * see is current for them.
 */
export type MemoryObject = {
  id: string;
  kind: ObjectKind;
  name: string;
  keys: { kind: ObjectKeyKind; value: string }[];
  facts: MemoryFact[];
  history: HistoricFact[];
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
export type FoundObject = Omit<MemoryObject, "facts" | "history">;

/** A fact a search found, with the object it's about. */
export type FoundFact = MemoryFact & { subject: { id: string; kind: ObjectKind; name: string } };

/** What a search found that its caller can see, best match first. */
export type MemorySearchResult = { objects: FoundObject[]; facts: FoundFact[] };

/**
 * What an exclusion keeps out of memory for the whole company (ADR-0023): every email with a
 * Gmail label (by name), every doc in a Drive folder or a folder under it (by ID), and every
 * item an address, or an address at a domain, is on.
 */
export const EXCLUSION_KINDS = ["gmail_label", "drive_folder", "address", "domain"] as const;
export type ExclusionKind = (typeof EXCLUSION_KINDS)[number];

/** What each kind of exclusion is called on the settings page. */
export const EXCLUSION_KIND_NAMES: Record<ExclusionKind, string> = {
  gmail_label: "Gmail label",
  drive_folder: "Drive folder",
  address: "Address",
  domain: "Domain",
};

/** An exclusion as an admin sees it. */
export type Exclusion = { id: string; kind: ExclusionKind; value: string; createdAt: Date };

const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

/**
 * A new exclusion, as an admin types it: a label's name; a Drive folder's ID or link; an address;
 * a domain (an `@` or `www.` in front is dropped). Addresses and domains are lowercased.
 */
export const exclusionInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("gmail_label"), value: z.string().trim().min(1).max(225) }),
  z.object({
    kind: z.literal("drive_folder"),
    value: z
      .string()
      .trim()
      .transform((value) => /\/folders\/([\w-]+)/.exec(value)?.[1] ?? value)
      .pipe(z.string().regex(/^[\w-]{10,}$/, "Expected a Drive folder's link or ID.")),
  }),
  z.object({ kind: z.literal("address"), value: z.string().trim().toLowerCase().pipe(z.email()) }),
  z.object({
    kind: z.literal("domain"),
    value: z
      .string()
      .trim()
      .toLowerCase()
      .transform((value) => value.replace(/^@/, "").replace(/^www\./, ""))
      .pipe(z.string().regex(DOMAIN, "Expected a domain, such as example.com.")),
  }),
]);
export type ExclusionInput = z.input<typeof exclusionInputSchema>;

/**
 * How long memory keeps what a source taught, in months (ADR-0024): 24 by default, the longest,
 * and admins may shorten it.
 */
export const MAX_RETENTION_MONTHS = 24;

/** A retention window as an admin sets it: whole months, 1 to 24. */
export const retentionWindowSchema = z.object({
  months: z.coerce.number().int().min(1).max(MAX_RETENTION_MONTHS),
});
export type RetentionWindow = z.input<typeof retentionWindowSchema>;

/** A person an admin asks memory to forget, by email address (lowercased). */
export const forgetPersonSchema = z.object({
  email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
});
export type ForgetPersonInput = z.input<typeof forgetPersonSchema>;

/** What forgetting a person did: how many facts went. Nothing else is shown (ADR-0024). */
export type Forgotten = { facts: number };

/** What a night's retention removed: source records past the window, and what only they taught. */
export type RetentionApplied = { sourceRecords: number; facts: number; objects: number };

/** A monthly memory budget, in credits. */
export const memoryBudgetSchema = z.object({
  monthlyBudget: z.coerce.number().positive().max(10_000_000),
});
export type MemoryBudget = z.input<typeof memoryBudgetSchema>;

/**
 * What learning from what's stored so far would cost: the items discovery stored, and the most
 * one item costs (its injection screen, `classify`, extraction and embedding, at each call's
 * credit estimate), so `credits` is an upper bound: items that aren't business stop after
 * `classify`.
 */
export type MemoryEstimate = { items: number; creditsPerItem: number; credits: number };

/**
 * Memory's settings as an admin sees them: whether it started, with what budget and retention
 * window; what this month's learning spent (since `monthStart`, UTC); the estimate; the
 * exclusions and company-wide lists; and how many people were forgotten.
 */
export type MemorySettings = {
  started: { startedAt: Date; monthlyBudget: number; retentionMonths: number } | null;
  monthStart: Date;
  spentThisMonth: number;
  postponedItems: number;
  estimate: MemoryEstimate;
  exclusions: Exclusion[];
  companyWideLists: CompanyWideList[];
  // The company's Workspace domain: only a list there can be marked company-wide.
  workspaceDomain: string;
  // How many people are on the do-not-learn list: never who.
  forgottenPeople: number;
};

/**
 * A summary of one object, built when asked from only the facts its caller can see, and never
 * stored: the object, the model's few sentences, and how many facts they were built from.
 */
export type ObjectSummary = { object: FoundObject; summary: string; factCount: number };

/**
 * Who or what is reading memory, which every read logs (ADR-0024). The ctx says whose view it
 * reads in; this says on whose behalf: the person acting directly (the default), the builder
 * chat for the admin using it, the person's own agent (Ask Mycel), or a workflow run, as its
 * enablement's member (member credentials) or company-wide only (org credentials, the system
 * ctx).
 */
export const memoryReaderSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("person") }),
  z.object({ kind: z.literal("builder") }),
  // A person's own agent, Ask Mycel (M9), reading in their view for them.
  z.object({ kind: z.literal("agent") }),
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
  "agent",
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
