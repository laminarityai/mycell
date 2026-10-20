# Mycel

Mycel connects to a small company's existing tools, finds repetitive work in their data, suggests AI workflows to handle it, and deploys those workflows for the team. It's built for small, non-technical companies, so **frictionless uptake** is the guiding principle: connect accounts with OAuth only, install nothing on anyone's machine, get value in the first session.

`docs/roadmap.md` holds the build order. This file covers architecture, rules, and decisions. Keep it stable, and update it when a decision changes.

## Product in one paragraph

An **admin** connects Google Workspace and describes workflows to the **builder chat**, an agent that knows the org's context. This is the primary way workflows get made (ADR-0007). Alongside it, Mycel backfills recent history and mines it for patterns (repeated questions, templated replies, cross-app handoffs). It ranks those patterns into **suggestions**, each with evidence and a measured shadow-eval result, and feeds what it learns into the builder chat's context. Admins turn a suggestion or a description into a **workflow**. Admins publish workflows to **tags**. **Members** see workflows published to their tags and can enable or disable them. They cannot create or edit them. Discovery runs again continuously.

## v1 scope

- First customer: our own company (dogfood). Mycel **reads** Gmail and Sheets/Drive and **acts** in Gmail, Sheets, Calendar, Docs and Tasks, all through one Google connection per account (ADR-0014). Slack, Outlook and the rest of Microsoft come after v1, through the same four parts (see Adding an app). Discord is not a source.
- The full loop, kept thin at every stage: builder chat (fed by discovery and suggestions) → publish to tags → member toggles → run → observability.
- No admin-level data access: no Admin SDK Reports API and no domain-wide delegation (ADR-0008).
- Workflows may act **autonomously only on read and internal-reversible actions** (e.g. labels). Anything that reaches other people waits in its app's **pending form** (a Gmail draft, a Calendar event with no guests) until a human approves it on the Reviews page. Financial and destructive actions don't exist in v1.

## Stack

- TypeScript, one Next.js (App Router) app, deployed on **Vercel** (layout: ADR-0005)
- **Neon Postgres** with **Drizzle ORM** (pgvector for embeddings)
- **Better Auth**: Google sign-in and the organization plugin, plus a sign-in hook that checks the verified `hd` claim on the server (ADR-0002). Accounts with no Workspace domain are rejected in v1.
- **Inngest**: every background job, i.e. backfill, Gmail and Drive polling, nightly discovery, and deletion reconciliation. It is served from a Next.js route, with concurrency limits keyed by org and connection.
- **Nango Cloud**: OAuth, the proxy, actions (tool calls), webhooks. No syncs (see **Data handling**).
- **Vercel AI SDK**: every model call in code, including the builder chat agent (`streamText` with tools). No agent framework (ADR-0006).
- **Vercel AI Gateway**: every model call goes through it. Jev (TypeSafe AI, `typesafe-ai/jev`) handles classification.
- Zod for every schema that crosses a boundary

## Repo layout (ADR-0005; refine during scaffolding)

A pnpm workspace with two members. Features live in one directory each and own their tables, logic, Server Actions, and UI. Features import each other only through their entry files, which dependency-cruiser enforces.

```
app/                         The one Next.js app (deploys to Vercel)
  src/app/                   Routes only: pages, layouts, route handlers. Thin; they call features.
  src/db/                    Drizzle client, migrations, forOrg(ctx). No feature tables.
  src/features/<name>/       One directory per feature, e.g.:
    spec/                    Workflow spec schema (zod), validator
    policy/                  Action risk catalog + policy engine (deterministic)
    runtime/                 Spec interpreter (steps as Inngest steps); model-role routing; Nango tool adapters
    connections/             Connections, the Nango client and proxy, Nango's webhook, disconnecting
    discovery/               Ingest (connectors, backfill, polling), events, object refs, mining, ranking, shadow eval
    credits/                 Credit ledger, estimates, budget enforcement
    memory/                  Fact extraction + retrieval (after the core loop)
nango-integrations/          Custom Nango functions (deployed via the Nango CLI)
docs/                        intent.md, architecture.md, conventions.md, roadmap.md, adr/, research/
```

## Invariants

The eight invariants live in `AGENTS.md`, which is always loaded, so they have a single source of truth. The sections below explain the machinery behind them.

## Roles and permissions

- **Admin**: connects org sources, sees suggestions, uses the builder chat, creates/edits/publishes workflows (in chat or the editor), manages tags, sees observability and credits.
- **Member**: connects their own sources, sees workflows published to any of their tags, enables or disables them. No observability, no editing.
- Tags are created by admins. A user can have many tags. A workflow is visible to a member if it shares any tag with them.
- **Credentials:** a workflow over personal data (e.g. "my inbox") runs on **each enabling member's own connection**. Shared workflows (e.g. a support@ inbox) run on an **org connection** owned by an admin. The spec field is `credentials: "member" | "org"`.
- **Who switches what on:** members enable and disable only `credentials: "member"` workflows; each switch-on is an **enablement**. An org-credential workflow runs once per trigger and has a single on/off switch that only admins control. For those workflows, tags decide who can _see_ the workflow, not who runs it.
- **Membership (ADR-0002):** one org per user, Google sign-in only. The first user from a Workspace domain creates the org and becomes admin. Later users from that domain auto-join as members. Admins can promote members.
- **Removing a user** deletes their member connections and everything derived from them (the invariant 3 cascade), along with their enablements. An org always keeps at least one admin, so the last admin can't be removed or demoted.
- **Org connections outlive their owner.** If the admin who made an org connection is removed, the connection keeps working and admins see a "connected by a removed user" warning. Only deleting the connection itself triggers the cascade delete.

## Data handling (option B: derived data plus pointers)

- Raw email and file content is processed in memory and **not persisted**. We keep derived data: cleaned features, entities, cluster assignments, templates (with slots), embeddings, extracted memories, plus `source_ref` pointers (Gmail message/thread IDs, Drive file IDs).
- When raw content is needed later (evidence view, shadow eval), it is **re-fetched through the Nango proxy**. Handle rate limits, and handle deleted sources (evidence goes stale and drops out).
- Embeddings and memories count as sensitive. They are encrypted, scoped, and deleted with their connection.
- **Never use Nango syncs.** All content, including the 90-day backfill, goes through the Nango proxy, which doesn't store response bodies. Syncs would keep copies at Nango for up to 60 days that we can't purge.
- Google: dogfood with an **Internal** OAuth app (no verification needed). Before the first external customer, complete Google OAuth verification and the restricted-scope security assessment.

## Scopes and promotion

- Data from a member's personal connection is `owner_scope: member`. Data from org connections is `org`.
- Org-visible surfaces (suggestions, builder chat, org memory) may show **aggregates and promoted items** from member scope: counts, cluster labels, slot-redacted templates, and business facts that pass the promotion step.
- **Evidence visibility (ADR-0001):** admins never see raw evidence from a member's mailbox unless that member shares specific examples. Evidence from org connections is shown raw to admins.
- A personal agent (future) reads the member's own scope plus org scope. Org memory never contains un-promoted member facts.

## Discovery pipeline (`features/discovery`)

1. **Ingest**: backfill 90 days on connect, then incremental updates by polling each app through the Nango proxy every minute (an Inngest cron job), starting from that app's stored cursor: Gmail's `history.list` from the last history ID, Drive's `changes.list` from the last page token. Push (Gmail through Pub/Sub, Drive through `changes.watch`) can replace polling later without changing anything downstream.
   - **One Google connection per account (ADR-0014).** Each person, and each org account such as support@, connects Google once, through Nango's one `google` integration, which asks for `gmail.modify`, `drive.readonly`, `spreadsheets`, `calendar.events`, `documents` and `tasks`. Google lets people untick apps on the consent screen, so `connections` reads the granted scopes from Nango (`GET /connections/{id}`, `credentials.raw.scope`) when the connection is recorded and on every reconnect, and stores them on the connection (`granted_scopes`); its apps are those whose scope was granted. The account's address is read from Gmail, or from Drive if Gmail wasn't allowed; an account that allowed neither is refused. A missing app shows "reconnect to allow …": a reconnect works on any connection, not only one needing reauth, and its `override` webhook re-reads the scopes (after checking it reached the same account), starting an ingested app it newly allows (`connections/apps.granted`, which also starts the backfill job) and dropping one it no longer allows. Every proxied call sets its API host with Nango's `Base-Url-Override`, chosen in `connections` from the path's prefix (`/gmail/` on `gmail.googleapis.com`, `/drive/` on `www.googleapis.com`, `/v4/spreadsheets` on `sheets.googleapis.com`), so callers pass Google's own paths.
   - **Before ADR-0014**, Gmail and Drive were separate connections, on Nango's `google-mail` and `google-drive` integrations. Those that remain (`source` `gmail` or `drive`) keep ingesting through their own integration, and the connections page asks to switch: connecting Google for the same account and kind deletes them and everything they ingested (invariant 3), and the new connection backfills again.
   - Each ingested app is one connector (start cursor, backfill page over a window, poll from a cursor); a connection runs the connectors of the apps it may use, each with its own cursor, and nothing outside a connector knows its app's API. The backfill, poll and recovery code is shared, and every event keeps its connection's `connection_id` and records its app as `source`.
   - **Gmail** (on `gmail.googleapis.com`): the cursor is the history ID; the backfill lists messages with `after:` and fetches each in full; polling reads `history.list` (`messageAdded` only).
   - **Drive** (on `www.googleapis.com`): the cursor is the changes feed's page token (`changes.getStartPageToken`); the backfill is `files.list` with `corpora=user`, `modifiedTime > <since> and trashed = false` and no shared drives; polling follows `changes.list` page by page and stores the last page's `newStartPageToken`. Every request names its `fields`, and none asks for a file's name. Each file version is one event: `file.created` when its created and modified times are equal, else `file.modified`, with the modified time, the modifying user, the owners and the MIME type. Its `source_ref` is `<file ID>@<modified time>`, so the same version from a backfill and a poll is stored once. Object refs are the file's `drive_file` ID and the modifying user's and owners' `email`s, which is how an email linking a file meets that file's changes. `discovery` reaches a source only through `connections`' `proxyGet(ctx, connectionId, …)`, and `connections` never imports `discovery`.
   - Recording a connection sends `connections/connection.recorded`, which starts the backfill job. It backfills each app still `backfilling` on the connection in turn: that app's cursor is read first, then one page per Inngest step, normalized in memory. Backfill and poll share a concurrency of one per connection and a per-org limit.
   - Polling: a cron every minute lists the orgs and, as each org's system ctx (ADR-0009), sends one `discovery/connection.poll-due` event per connection with an `active` app. The poll job asks each `active` app's connector for what's new since its cursor, normalizes it exactly as the backfill does, and stores the app's next cursor. Events are unique per connection on `source_ref`, so overlaps and re-runs store nothing twice.
   - An expired cursor (Gmail answers 404 for a history ID; Drive answers 400 blaming `pageToken`, or 404 / 410) recovers inside the same poll run, which already holds the connection's concurrency slot: read a fresh cursor, backfill the app page by page from a day before its latest stored event, then store the cursor.
   - Each ingested app's state lives in `connections`' `ingest_states` (one row per app the connection may use, cascading from it): `backfilling` with a count of stored messages or file versions, then `active` or `failed`, the cursor, and when it last polled. The connections page shows one row per account, with its apps and the furthest-behind app's status. Nango's `auth` / `refresh` webhook with `success: false` sets the connection's `needs_reauth`, which polling skips; reconnecting (a Nango reconnect session, then its `override` webhook, if it reached the same account) or a later successful refresh clears it.
   - **Ingest persists no text.** Events and object refs hold no subject, body, snippet or file name; the decoded body exists only while its object refs are extracted, and Drive is never asked for names or content.
2. **Normalize** into one event schema: `event_id, source, type, timestamp, actor, counterparty, direction, thread_id, text (cleaned, in memory only), object_refs, attachments_meta`. Strip quoted replies, signatures, and disclaimers.
3. **Object refs** (ADR-0008): deterministic links only. Structured fields (addresses, attendees, file IDs) and regex for IDs, merged on exact keys. No LLM entity pass and no fuzzy matching. An entity backbone (free-text extraction, resolution, lifecycle mining) comes after v1, and only if the discovery-lens experiment passes.
4. **Mine**: embed and cluster into intent clusters. For v1, clustering links events whose pgvector similarity is above a threshold and takes each connected group as a cluster. It sits behind one `clusterEvents` function so the method can change (ADR-0004). Have an LLM label only a few representatives per cluster. Detect templates (near-duplicate outbound messages with their slots), request→response pairs, periodic tasks, and chasing/follow-up patterns.
5. **Rank**: value = frequency × est. minutes × people. Feasibility = trigger type, variance, blast radius, context availability, write-API availability. Map to a starting rung.
6. **Shadow eval**: replay the candidate on held-out past cases (re-fetched) and compare with what the human actually did, using a `judge` model plus edit distance. Show the result on the suggestion.

- Discovery runs **nightly**. A dismissed suggestion comes back only if its frequency reaches **≥2×** the level when it was dismissed.
- Discovery uses credits. Show a cost estimate before the initial scan.

## Solution ladder (rungs)

0 rule/template (no AI) · 1 knowledge answer · 2 skill (human-invoked) · 3 triggered draft for approval · 4 autonomous with guardrails · 5 multi-step across people.

v1 supports rungs **0, 3, and 4 (reversible-internal actions only)**. Earned autonomy, meaning offers to promote a workflow based on how often drafts are sent unedited, comes after v1, but specs carry the `autonomy` block already.

## Workflow spec (`features/spec`)

Specs are JSON, validated by zod, and run by our own interpreter in `features/runtime`: each spec step executes as one Inngest step, so finished steps are never re-run and each step retries on its own (ADR-0006). Primitives: `trigger`, `classify`, `branch`, `extract`, `tool` (Nango action), `draft`, `approval`, `escalate`.

```json
{
  "specVersion": 1,
  "id": "pricing-inquiry-replies",
  "visibility": { "tags": ["sales"] },
  "credentials": "member",
  "budget": { "monthlyCredits": 500 },
  "trigger": { "type": "gmail.message_received" },
  "steps": [
    {
      "id": "classify",
      "type": "classify",
      "role": "classify",
      "question": "Is this a pricing inquiry?",
      "labels": ["yes", "no"]
    },
    {
      "id": "gate",
      "type": "branch",
      "when": { "step": "classify", "label": "yes", "minP": 0.85 },
      "else": "stop"
    },
    {
      "id": "prices",
      "type": "tool",
      "action": "google-sheet.read-range",
      "input": { "spreadsheetId": "sheet-1", "range": "Prices!A1:C50" }
    },
    {
      "id": "draft",
      "type": "draft",
      "role": "smart",
      "instructions": "Reply with our current prices.",
      "context": ["trigger.message", "prices"],
      "output": "google-mail.create-draft"
    },
    { "id": "approve", "type": "approval", "channel": "gmail_drafts" }
  ],
  "autonomy": { "rung": 3 }
}
```

**Shape and structure** (`validateSpec` in `features/spec`, pure): the schema refuses unknown step types and misspelled fields; step IDs are unique; a `branch`'s `when` names an earlier `classify` step and one of its labels, and when the condition fails the run stops (`else: "stop"`, status `skipped`) or escalates (`else: "escalate"`); `tool` inputs are literals or references `{ "from": "<step>.<field>" }` and `{ "from": "trigger.<field>" }`, and a `draft`'s `context` names earlier steps, `trigger.message` or `trigger.thread`, all only to steps before it. `org_memory` as context is refused until memory exists (M9). A `risk` field anywhere is accepted and ignored. Every issue comes back in one list, each with the path of its field.

**Validation before save:**

- every `action` exists in the catalog and the tenant has the connection
- every `role` resolves to a model
- tags exist
- `credentials` is allowed
- the policy engine computes the max risk level and inserts any approvals the spec is missing
- every step type and catalog action has a registered executor in `features/runtime`

**Capability requests:** when no catalog action fits, the builder emits a structured `capability_request` (API, operation, inputs, outputs) to an internal queue. Our team builds the Nango function. The interface stays the same so an auto-builder can take over later.

## Adding an app (ADR-0013)

Every app plugs in through the same four parts, so a new app is mostly catalog work by our team:

1. **Source:** a connector that reads what discovery needs, if anything (start cursor, backfill, poll). An app can act without being a source.
2. **Triggers:** what can start a run, such as a new email or a new Calendar invite.
3. **Catalog actions:** what a workflow may do in the app, each with a fixed risk level.
4. **Pending form:** where an `external_send` action waits for a person, inside the app itself. Mycel's **review** stores only a pointer to it and fetches it live.

| App      | Pending form                                               | Approving in Mycel                      |
| -------- | ---------------------------------------------------------- | --------------------------------------- |
| Gmail    | A draft                                                    | Sends the draft (or edit it, then send) |
| Calendar | The event on the person's calendar, with no guests yet     | Adds the guests and sends invitations   |
| Docs     | Suggested edits in the doc                                 | Not possible; the review links to Docs  |
| Tasks    | None needed: tasks on the person's own list are reversible |                                         |

A review ends as approved, edited and approved, declined (which deletes the waiting item, where the app allows), done in the app, or gone. An app with no natural pending form, such as Slack, waits until we design one.

## Risk policy (`features/policy`)

Each catalog action has a fixed level: `read` < `internal_reversible` < `external_send` < `financial` < `destructive`.

- `read`, `internal_reversible`: may run autonomously.
- `external_send`: must wait in the app's pending form for a person's review (ADR-0013). M3 approves by sending the Gmail draft; from M5 on, every review also appears on the Reviews page.
- `financial`, `destructive`: not available in v1.

The catalog is code (`features/policy/catalog.ts`), each action with its risk level, integration, the API host its proxy calls reach, the scopes that allow it, and input and output schemas. Outputs are derived data and IDs only (ADR-0012).

| Action                     | Risk level            | Host (on the one `google` integration) | Scope needed                             |
| -------------------------- | --------------------- | -------------------------------------- | ---------------------------------------- |
| `google-mail.read-message` | `read`                | Gmail                                  | `gmail.readonly` or `gmail.modify`       |
| `google-mail.read-thread`  | `read`                | Gmail                                  | `gmail.readonly` or `gmail.modify`       |
| `google-mail.add-label`    | `internal_reversible` | Gmail                                  | `gmail.modify`                           |
| `google-mail.create-draft` | `external_send`       | Gmail                                  | `gmail.modify` or `gmail.compose`        |
| `google-sheet.read-range`  | `read`                | Sheets                                 | Drive or Sheets, read-only or read-write |
| `google-sheet.append-row`  | `internal_reversible` | Sheets                                 | `spreadsheets`                           |

`maxRisk(spec)` is the highest level among the spec's `tool` actions and `draft` outputs; model steps count as `read`, and a `risk` field in the spec is ignored. `applyPolicy(spec)` refuses unknown actions, an `external_send` action in a `tool` step (in v1 the only way to send is a draft), and a `draft` output that isn't `external_send`. It inserts an `approval` step (`channel: "gmail_drafts"`) directly after any draft with no approval before or after it, and reports each insertion.

## Models (`features/runtime`)

- Roles: `classify` (Jev via AI Gateway, with structured-output LLM fallback), `fast`, `smart`, `judge`.
- Jev is called through the AI SDK's experimental `experimental_decide`, so its version is pinned exactly. An adapter normalises Jev's two output shapes into one `{ label, p }`. Specs never see Jev's own format.
- Use Jev's probabilities as confidence gates: high confidence proceeds, low confidence goes to a human. Treat a gate threshold (e.g. `0.85`) as a number tuned per workflow by shadow eval, not as a trusted calibrated probability.
- The per-org role→model table lives in the DB, with a global default table in config.

## Credits (`features/credits`)

- Every org has a credit balance. All model calls, discovery jobs, and evals debit the ledger.
- When the org balance is exhausted, **hard stop**: workflows pause and admins get an email.
- Admins can set **per-workflow monthly budgets**. A workflow that reaches its budget pauses on its own.

## Versioning

- Publishing an edited workflow creates a new **workflow version**. Members' enablements **auto-upgrade**.
- **Exception:** if the new version raises the max risk level or needs a new connection or data source, members' enablements **pause until they re-enable**. Keep everything else simple and automatic.

## Pausing

"Paused" is one state with four causes. The reason is always shown with it (e.g. "paused: out of credits").

| Cause                                             | What's paused             | How it resumes                                                           |
| ------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------ |
| Org credits exhausted                             | every workflow in the org | automatically, once credits are added                                    |
| Workflow budget reached                           | that workflow             | automatically next month, or immediately when an admin raises the budget |
| 3 consecutive failed runs                         | that workflow             | only when an admin resumes it manually                                   |
| New version raises risk or needs a new connection | each member's enablement  | only when that member re-enables                                         |

## Failures and observability

- Steps retry with backoff (3 attempts). Every failure is recorded in observability.
- After **3 consecutive failed runs**, the workflow pauses automatically and the owning admin gets an email. Members see a "paused" badge.
- Observability is **admin-only**: runs, step traces, inputs/outputs (scoped), cost, failures. It's built in our UI on our own `runs` and `run_steps` tables, written by the interpreter. Inngest's dashboard is for development and debugging only.

## Builder chat

- Admin-only agent. Its context: suggestions and mined patterns, existing workflows, the action catalog, org settings, and (once built) org-scope memories.
- Its output is always a spec diff for the admin to review, never a direct publish. The same spec can also be edited in a visual/JSON editor.

## Memory (after the core loop; `features/memory`)

- **Extraction:** after mining, a `smart` pass over request→response pairs and recurring threads extracts candidate facts ("refund window is 30 days", "Acme's billing contact is Dana"), each with `source_ref`, confidence, and `owner_scope`.
- **Filtering:** `classify` labels each fact as business knowledge or personal, and personal facts never get promoted.
- **Dedupe and supersede:** dedupe by embedding similarity. On contradiction, the newer fact supersedes the older one and history is kept.
- **Promotion:** a fact moves from member scope to org scope only if it is business knowledge and appears in multiple sources, or an admin approves it.

## Conventions

The always-on coding rules are in `AGENTS.md`. The detail (feature-directory shape, data access, migrations, config, tooling, naming) is in `docs/conventions.md`.

## Open questions

- Concrete model IDs per role (Jev is available on the AI Gateway; see the research file for pricing).
- Credit pricing and the free/included allowance.
- Admin-level data access (Reports API, domain-wide delegation) versus owner scopes: out of v1, revisit at M10 (ADR-0008).
