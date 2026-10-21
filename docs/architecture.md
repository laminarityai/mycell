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
   - **Gmail** (on `gmail.googleapis.com`): the cursor is the history ID; the backfill lists messages with `after:` and fetches each in full; polling reads `history.list` (`messageAdded` only). Both skip spam, trash and drafts (each draft save is a new message ID).
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
  "specVersion": 2,
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
      "mode": "first",
      "paths": [
        {
          "id": "gate-yes",
          "name": "Pricing",
          "condition": {
            "combine": "all",
            "checks": [{ "classify": "classify", "is": "yes", "minP": 0.85 }]
          },
          "steps": [
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
          ]
        }
      ],
      "otherwise": { "id": "gate-otherwise", "steps": [] }
    }
  ],
  "autonomy": { "rung": 3 }
}
```

**Branches and paths** (ADR-0015): a `branch` holds its paths nested inside it and is the last step of its list. Each path has an ID, a name, a condition and its own steps; the `otherwise` path runs when no path's condition holds, and with no steps the run stops there (status `skipped`). A condition is `all` or `any` of its checks: a classify answer (`{ "classify": "<step>", "is": "<label>", "minP": 0.85 }`) or a value (`{ "subject": { "from": "<step>.<field>" | "trigger.<fact>" }, "op": …, "value"? }`, the operator typed by the value: text, number, yes/no, or empty). `mode` is `first` (the first path that holds, left to right) or `every`. Step and path IDs share one namespace. A branch has 1 to 10 paths besides otherwise, each condition at least one check, and branches nest at most 3 deep (checked on save, so a converted v1 spec deeper than that still runs). Until the rest of M12 lands, validation accepts only first match, and a value check tests an extract step's field, its operator fitting the field's declared type (`spec/conditions.ts`: `subjectType`, `operatorsFor`, `describeCheck`). Text checks ignore case and surrounding spaces; a missing or blank value is empty and fails every other check. The branch step (`runtime/lib/conditions.ts`) checks paths left to right and stops at the first that holds; each path then sees the outputs as of the branch plus its own, never a sibling's. Its record keeps the path taken and each checked path's ID and pass or fail, never the values tested; an approval records the drafts above it on its own path since the approval above it.

**Specs from before** (`specVersion: 1`, a gate with `when` and `else`) are converted when read, never migrated: `readStoredSpec` (`spec/stored.ts`) runs `upgradeSpec` (`spec/upgrade.ts`) at every place a stored spec is read, so code past the read sees v2 only, and saving writes v2. A gate becomes a first-match branch with the gate's ID and one path holding every step after it; `else: "stop"` becomes an empty otherwise path, and `else: "escalate"` one escalate step with fixed words. Every v1 step ID is kept, so published v1 versions run with the same step IDs, and a run memoized part-way through one resumes on the matching path (the walker reads a memoized `{ passed }`). `validateSpec` accepts v1 input and returns it upgraded, naming each issue where the input wrote it (`issuesAsWritten`); the workflow editor's form still shows v1's one list for a spec it can express that way.

**Shape and structure** (`validateSpec` in `features/spec`, pure): the schema refuses unknown step types and misspelled fields; step and path IDs are unique; a branch is the last step of its list; a classify check names a `classify` step above the branch and one of its labels, and a value check a field of a step above the branch on its own path; `tool` inputs are literals or references `{ "from": "<step>.<field>" }` and `{ "from": "trigger.<field>" }`, and a `draft`'s `context` names steps above it on its own path, `trigger.message` or `trigger.thread`. `org_memory` as context is refused until memory exists (M9). A `risk` field anywhere is accepted and ignored. Every issue comes back in one list, each with the path of its field.

**Validation before save:**

- every `action` exists in the catalog and the tenant has the connection
- every `role` resolves to a model
- tags exist
- `credentials` is allowed
- the policy engine computes the max risk level and inserts any approvals the spec is missing
- every step type and catalog action has a registered executor in `features/runtime`

**Switching on and triggering:**

- A member-credential workflow is switched on by an **enablement** (`enablements`, unique on workflow and user) on the enabling user's own member connection; an org-credential workflow by its one switch, recorded on `workflows` as the org connection it runs on and since when. Either follows the latest version, and switching on checks that version against the chosen connection alone (Gmail allowed, every action's scope granted). Switching off deletes the enablement or clears the switch; deleting the connection does too. In M3 only admins switch anything.
- Only polled mail triggers: when a poll (or an expired-cursor recovery) newly inserts an inbound Gmail message that isn't a draft, `discovery` sends `discovery/gmail.message_received` (`src/lib/events.ts`, shared so `runtime` needn't import `discovery`). The backfill sends nothing, and neither does a re-read.
- `runtime`'s fan-out, as the system ctx, starts one run per enablement or org switch on that connection whose switch-on came at or before the message's `occurredAt` and whose trigger labels (default `INBOX`) the message carries. Each run is unique on (enablement or org workflow, `source_ref`) through `runs.trigger_key`, and its run event's ID is the run's, so a resent trigger starts nothing twice.
- Before each step, a triggered run checks its enablement or org switch is still on for its connection; if not, it ends `cancelled` after the step it was on.
- Storing and sending are separate steps. The poll step (or a recovery's page step) hands on the inbound, non-draft Gmail messages its insert newly created, as IDs, times and labels only; the step after it (`gmail-poll-announce`, or `<prefix>page-<n>-announce`) sends them. A failed send is retried with the memoized messages, so none is lost, and only newly inserted rows are ever sent.

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

`maxRisk(spec)` is the highest level among the spec's `tool` actions and `draft` outputs; model steps count as `read`, and a `risk` field in the spec is ignored. `applyPolicy(spec)` refuses unknown actions, an `external_send` action in a `tool` step (in v1 the only way to send is a draft), and a `draft` output that isn't `external_send`. It inserts an `approval` step (`channel: "gmail_drafts"`) directly after any draft with no approval on its own path (above it, or after it in its list; one on a sibling path, or on a path below the draft, doesn't count), and reports each insertion. Max risk covers every path.

## Models (`features/runtime`)

- Roles: `classify` (Jev via AI Gateway, with structured-output LLM fallback), `fast`, `smart`, `judge`.
- Jev is called through the AI SDK's experimental `experimental_decide`, so its version is pinned exactly. An adapter normalises Jev's two output shapes into one `{ label, p }`. Specs never see Jev's own format.
- Use Jev's probabilities as confidence gates: high confidence proceeds, low confidence goes to a human. Treat a gate threshold (e.g. `0.85`) as a number tuned per workflow by shadow eval, not as a trusted calibrated probability.
- The per-org role→model table lives in the DB, with a global default table in config.
- Every call goes through one gateway client (`callModel` and `classify` in `runtime`), which resolves the role, checks credits, calls with the SDK's retries off (the run's step retries instead), records the cost, and turns any failure into a `ModelCallError` holding only codes, never the model's output (invariant 8). A caller that streams (the builder chat) opens `openMeteredStream` instead: the same role resolution and credit check, then one usage entry with the summed cost of the steps it metered, however the stream ended.
- `classify` falls back to a structured-output call on `fast` when Jev fails, refuses, answers without probabilities or with a label it wasn't offered, or when the org's classify model isn't a decision model. The answer is marked as a fallback, and its `p` is the model's stated confidence.

## Credits (`features/credits`)

- Every org has a credit balance. All model calls, discovery jobs, and evals debit the ledger.
- When the org balance is exhausted, **hard stop**: workflows pause and admins get an email.
- Admins can set **per-workflow monthly budgets**. A workflow that reaches its budget pauses on its own.
- **M3's thin slice** (ADR-0010): `credit_ledger` holds grants and one usage entry per model call; the balance is their sum. Before each call, `checkCredits` needs the balance to cover a per-role estimate from config, or throws `OutOfCreditsError` and nothing is sent. After it, the call's gateway cost (`providerMetadata.gateway.cost`, US dollars) is converted at the config's credits-per-dollar ratio and recorded, failed calls included. Our team grants credits with `pnpm credits:grant <orgId> <credits>`. A usage entry made by "Try it" is marked `dry_run`.
- **Known gap:** a call that fails with a gateway error carries no cost, so it's recorded at 0 with its `generationId`. The gateway reports that cost later, asynchronously, by generation ID; reconciling it is M7's job.

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

- Steps retry with backoff (3 attempts). The attempts run inside the step's Inngest step, so each step's record counts them, and a step whose last attempt fails records the failure and ends the run `failed` instead of throwing. Some failures aren't retried: out of credits, a connection that's gone (the run ends `cancelled`), an action whose executor isn't built yet, a bad reference, and Gmail having no such message. Every failure is recorded in observability.
- **Checks:** a step may carry `checks: { schema?, minP?, requiredFields? }`, run on the output it hands on. `schema` is a JSON Schema subset (`type`, `enum`, `properties`, `required`, `additionalProperties`, `items`, `minimum`/`maximum`, `minLength`/`maxLength`, `minItems`/`maxItems`); validation refuses any other keyword, `minP` off a classify, and a required field the extract doesn't have. A failed check records the step `check_failed` with `check_schema`, `check_min_p` or `check_required_fields`, isn't retried, and fails the run. A model answer that doesn't fit the step's own schema is a failed `schema` check when the step has one, and a retried `model_off_schema` otherwise.
- **Failure records:** each failed step keeps an error code, a message built from codes, field paths and value types (never values), its attempt count and when its last attempt began (`last_attempt_at`). The step returns `{ ended: "failed" }` to Inngest rather than throwing, so the step state holds no error at all.
- **Run records** (`runs`, `run_steps`) cascade from their connection and hold derived data only: labels and probabilities, IDs, counts, an `extract` step's field names and whether each was filled (never the values, ADR-0012), error codes and messages built from codes, the model role and ID, and cost. A run is read only by whoever may read its connection (connections' `readableConnectionIds`): an admin sees runs on org connections and on their own member connection, never on another user's. The message is fetched through the Nango proxy inside each step that reads it, and its text never leaves that step.
- **Writes are idempotent per step.** Nango's proxy doesn't retry a POST (`proxyPost`), since a write whose answer was lost may still have happened; instead each write action checks for its own earlier result before acting. `add-label` finds the label by name before creating it and skips `messages.modify` when the message already has it. A `draft` step fetches its context, generates on its role and creates the draft in one step, so the text never reaches Inngest's state or the run records; the draft carries an `X-Mycel-Draft: <run ID>/<step ID>` header, and a retry that finds a draft with its marker in the thread (via `threads.get` with `format=metadata`, then `drafts.list` for the draft's ID) records that draft instead of generating again. The draft replies to `Reply-To` or else `From`, with `Re:` on the subject and `In-Reply-To` and `References` from the original. `append-row` writes `RAW` (so a value is never read as a formula), with a marker cell `mycel:<run ID>/<step ID>` after the row's last value; before appending it reads the range's whole sheet for a row holding its marker and records that row instead. Both Sheets actions take a range that names its sheet (`Sheet1!A:C`); save-time validation refuses a literal range without one, at the input's path, as it does any literal input the action's schema refuses. A `read-range` step records the range and its row and column counts, never the values; a `draft` step that names it as context re-reads the range inside the draft step. A Sheets 404 (`source_item_missing`), 400 (`invalid_input`) or 403 (`source_forbidden`) isn't retried. An `approval` step (`gmail_drafts`) records the drafts before it that await a person, who approves by sending one. It doesn't end the run: a run never sends a Gmail draft, so the draft is itself what awaits approval, and the steps after the approval (a log row, say) still run, as does a draft after an approval.
- After **3 consecutive failed runs**, the workflow pauses automatically and the owning admin gets an email. Members see a "paused" badge.
- Observability is **admin-only**: runs, step traces, inputs/outputs (scoped), cost, failures. It's built in our UI on our own `runs` and `run_steps` tables, written by the interpreter. Inngest's dashboard is for development and debugging only.

## Builder chat (`features/builder`)

- Admin-only agent. Its output is always a **proposal** for an admin to accept or reject, never a direct publish or an automatic merge. The same working spec can also be edited in a visual/JSON editor.
- **Builder conversations** belong to the org, record the admin who started one, and may be about one workflow. Any admin can open and continue any of the org's conversations; members get `ForbiddenError` on the page, the route and every `builder` function.
- **A turn** is one `streamText` call on the `smart` role (resolved per org, invariant 6), at most 8 model steps, run by the streaming route `POST /api/builder/turn`, which resolves the session to `ctx` and calls `streamTurn(ctx, conversationId, message)`. `runtime`'s `openMeteredStream` resolves the role and passes the credit pre-flight before the first model call; the turn sums each step's `providerMetadata.gateway.cost` and records one ledger entry when it ends, including a turn that fails partway (the failed step reports no cost). Out of credits, no model is called, and the conversation and the stream get an `out_of_credits` notice. The turn runs to its end even if the page goes away, so its reply is still stored.
- **Context providers** (`builder/lib/context.ts`) are functions `(ctx, turn) => { title, content }` called when a turn starts, each a section of the agent's instructions: org settings, the action catalog (each action's app, description, inputs, outputs, fixed risk level and, for an external send, its pending form), the org's workflows (with the conversation's workflow's whole working spec), the admin's own and the org's connections with their granted apps (other members' connections as a count only, ADR-0001), and tags, and what became of the conversation's proposals. Discovery's suggestions and mined patterns join in M2, and org memory in M9, as more providers.
- **Tools** (`builder/lib/tools.ts`) run with the admin's `ctx`, so the agent reaches only what the admin could. Each says what the conversation stores of its result. `get_workflow` reads the current working spec, hand edits included. `propose_spec({ workflowId?, spec, summary })` takes a whole spec, never a patch, and validates it as saving would (`workflows`' `checkWorkflowSpec`: the schema, the policy engine, the org's connections and scopes) plus a spec ID no other workflow has. Its issues go back to the model to repair; after 3 failed calls in a turn it tells the model to stop and explain, and the admin sees the issues. A spec that passes is stored as a **proposal**; nothing else is. `read_examples` (`builder/lib/read-examples.ts`) runs a live Gmail search through runtime's `searchMessages` and `readMessage` on the admin's own connection or an org connection granted Gmail, and hands the model up to 5 messages' sender, date, subject and truncated body. Any other member connection, another admin's own included, is `NotFoundError` (ADR-0001), and the connections context lists exactly the IDs it accepts.
- **Proposals** (`builder_proposals`) hold the proposed working spec, the workflow it changes (none for a new one), the revision and working spec it was made against, what the policy engine made of it (max risk, inserted approvals), and a status: `proposed`, `accepted`, `rejected` or `stale`. The conversation shows each as a card: the structural diff of base and proposal (`spec`'s `diffSpecs`, steps paired by ID) in plain words (`spec`'s `describeSpec`), each step's catalog risk level, and "waits for review (required by policy)" on the approvals the engine inserted, which can't be removed. Accepting a new-workflow proposal creates the workflow unpublished and links the conversation to it; accepting one for an existing workflow saves its working spec with the base revision (`saveWorkflow`'s `baseRevision`), never its published version. A working spec saved since (by hand or by another proposal) has a newer revision, so the save throws `ConflictError`, the proposal becomes `stale`, nothing is merged, and the next turn's context ("Proposals in this conversation") tells the agent to propose again from the current spec. The conversation shows M3's Publish once the workflow's working spec differs from its latest version (`unpublishedChanges`).
- **The workflow editor** (`workflows/lib/spec-editor.tsx`, on the workflow page and New workflow) edits the same working spec by hand, as a form or as JSON, switchable at any time; JSON that doesn't parse, or isn't an object with a list of steps (`spec`'s `readSpecJson`), can't switch back to the form. The form has the settings at the top (spec ID, credentials, trigger labels, rung, budget) and one panel per step type with add, remove and reorder (`spec/edit.ts`, pure). A tool step picks from the catalog actions the connections the spec could run on were granted (`policy`'s `actionsAllowedBy`, over `workflows`' `editorConnections`). A debounced Server Action runs `checkWorkflowSpec` as the admin types, and each issue shows on the step and field its path names (`issuesByStep`); a spec with issues can't be saved. The approvals the policy engine inserts aren't in the working spec, so the form shows them after their draft as "waits for review (required by policy)", with no Remove. Saving passes the revision the editor opened, so a working spec saved since (by another admin or an accepted proposal) is refused with `ConflictError`, never overwritten.
- **Try it** (`runtime`'s `dryRun(ctx, spec, { connectionId, sourceRef, workflowId? })`) runs a working spec on one message in memory: no Inngest, no `runs` or `run_steps`. It validates the spec as saving would and runs the policy-applied spec with the interpreter's own step executors, but with a dry action registry (`runtime/lib/dry-run-actions.ts`, typed so a new catalog action needs an entry): read actions run for real, and `add-label`, `append-row` and `create-draft` read only what they need and report what they would have done (the label, the row, the draft's recipient, subject and generated text), writing nothing. Approvals, the policy engine's included, are reported as "would wait for a review" and the run goes on. The connection must be the admin's own (member credentials) or an org connection (org credentials), granted Gmail; any other member's is `NotFoundError`. Out of credits it's refused before anything runs; each model call passes the usual pre-flight and its ledger entry is marked `dry_run`, with no run ID. The picker (`recentMessages`) lists each such connection's 20 newest inbox messages, their subjects and senders fetched through the proxy for display only, and only once the admin opens the panel (`?try`). The whole result goes back to the page and is never stored; a branch's entry lists its paths (`taken`, `not_taken`, `not_checked` after an earlier path ran, or `not_needed` for an otherwise path another path made unnecessary), each check in words with whether it passed and why, quoting the value it tested. From the chat, `builder`'s `tryInConversation` tries the conversation's workflow's working spec and posts a content-free summary as the admin's message (`try_it` part: labels chosen, the path each branch took, each path's status and its checks in the spec's words with pass or fail, "drafted a reply", rows counted, never message content, draft text, row values or the values a check tested), which the agent reads on the next turn. The workflow page composes its panel in the page, since `workflows` can't import `runtime`.
- **Conversations hold no source content (invariant 8).** A message stores its text, and each tool call with its input and its result as the tool stores it (`read_examples` keeps only the source refs it returned). Messages carry `org_id` but no `connection_id`, so disconnecting leaves them alone. Reopening a conversation rebuilds the model's context from what's stored.

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
