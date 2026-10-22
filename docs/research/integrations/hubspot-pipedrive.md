# CRMs: HubSpot and Pipedrive

Researched 2026-10-21 from vendor docs (HubSpot developer docs as served at `developers.hubspot.com/docs/llms-full.txt` on that date; Pipedrive developer docs, OpenAPI specs and changelog; Nango's providers.yaml and docs). Claims I could not check against a primary source are marked **unverified**.

## HubSpot

### 1. Summary

HubSpot is the small company's CRM and marketing tool. It holds contacts, companies, deals in pipelines, tickets, tasks, and a timeline of logged emails, calls, meetings and notes. A free tier gives full API access. The workflows it most enables:

1. **Lead follow-up.** A new contact or form lead arrives, gets enriched and assigned, and a follow-up email is drafted for the owner to approve.
2. **Deal hygiene.** A deal sits in a stage too long, so a task for the owner is created, a nudge email is drafted, or the stage and next-step fields are updated.
3. **Logging work.** After a Gmail thread or a Calendar meeting, the note or summary is logged against the right contact and deal, and a follow-up task is created.
4. **Quote preparation.** A deal reaches a stage, so a draft quote is built from line items for a person to publish.
5. **Inbox and ticket triage** (Service Hub, help desk): a ticket is classified and a reply is drafted as an internal comment.

### 2. Capability table

API paths use the date-versioned form `/…/2026-09/…` (the current version; see §8). Risk levels are proposals for the catalog.

| Resource                                      | Operation                                           | API method                                                                                                | Proposed Mycel risk                                           | Reaches people outside the user?                                | Notes                                                                                                                                                                             |
| --------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contacts, companies, deals, tickets, leads    | Read, list, batch read                              | `GET /crm/objects/2026-09/{type}/{id}`, `POST …/batch/read`                                               | `read`                                                        | No                                                              | Leads need Sales Hub Pro+ (`crm.objects.leads.*`).                                                                                                                                |
| Same                                          | Search                                              | `POST /crm/objects/2026-09/{type}/search`                                                                 | `read`                                                        | No                                                              | 5 requests/s per account, 10,000 results per query at most, ≤5 filterGroups × 6 filters (18 in total), 3,000-character body. `hs_email_html` and body previews can't be filtered. |
| Same                                          | Create, update, upsert (single and batch)           | `POST`/`PATCH /crm/objects/2026-09/{type}`, `…/batch/*`                                                   | `internal_reversible`                                         | No                                                              | Writes can fire the customer's own HubSpot workflows (for example a marketing email on lifecycle change). That is an indirect external effect Mycel can't see.                    |
| Same                                          | Delete (archive)                                    | `DELETE /crm/objects/2026-09/{type}/{id}`                                                                 | **`destructive`**                                             | No                                                              |                                                                                                                                                                                   |
| Same                                          | Merge two records                                   | `POST …/{type}/merge`                                                                                     | **`destructive`**                                             | No                                                              | Not undoable (**unverified**; I found no unmerge endpoint).                                                                                                                       |
| Custom objects                                | CRUD, search                                        | `/crm/objects/2026-09/{objectTypeId}`                                                                     | as above                                                      | No                                                              | **Enterprise only** (`crm.objects.custom.*`). Schemas: `/crm/objects/schemas`.                                                                                                    |
| Associations                                  | Read; create labeled or unlabeled; delete           | `/crm/associations/2026-09/{from}/{to}/batch/read` (≤1,000 ids), `…/batch/create`, `DELETE …`             | `read` / `internal_reversible`                                | No                                                              | Per-record association limits depend on tier.                                                                                                                                     |
| Properties                                    | Read definitions                                    | `GET /crm/properties/2026-09/{type}`                                                                      | `read`                                                        | No                                                              | The builder needs these to map fields.                                                                                                                                            |
| Properties                                    | Create or update a property                         | `POST`/`PATCH /crm/properties/2026-09/{type}`                                                             | `internal_reversible`                                         | No                                                              | A schema change. Suggest keeping it out of v1 (admin work).                                                                                                                       |
| Properties                                    | Delete a property                                   | `DELETE …`                                                                                                | **`destructive`**                                             | No                                                              | Exclude.                                                                                                                                                                          |
| Pipelines and stages                          | Read                                                | `GET /crm/pipelines/2026-09/{type}`                                                                       | `read`                                                        | No                                                              |                                                                                                                                                                                   |
| Pipelines and stages                          | Create, update, delete                              | `POST`/`PATCH`/`DELETE …`                                                                                 | `internal_reversible` / **`destructive`**                     | No                                                              | Admin work: exclude. Free has only the default pipeline (0 custom pipelines).                                                                                                     |
| Owners, users                                 | Read                                                | `GET /crm/owners/…`, `/crm/objects/2026-09/users`                                                         | `read`                                                        | No                                                              | Needed to assign tasks.                                                                                                                                                           |
| Notes                                         | Create or update on a record                        | `POST /crm/objects/2026-09/notes` with `associations`                                                     | `internal_reversible`                                         | No                                                              | Body `hs_note_body`.                                                                                                                                                              |
| Tasks                                         | Create, update, complete                            | `POST`/`PATCH /crm/objects/2026-09/tasks`                                                                 | `internal_reversible`                                         | No (notifies the internal assignee)                             | `hs_task_type` is `EMAIL`, `CALL` or `TODO`; `hs_task_status` is `NOT_STARTED` or `COMPLETED`. Task series: `/crm/objects/2026-09/tasks/series`.                                  |
| Calls, meetings                               | Log an engagement                                   | `POST /crm/objects/2026-09/calls`, `…/meetings`                                                           | `internal_reversible`                                         | No                                                              | Logging a meeting only records it; it doesn't send an invite.                                                                                                                     |
| Emails (1:1 engagements)                      | Log an email, read logged emails                    | `POST`/`GET /crm/objects/2026-09/emails`                                                                  | `internal_reversible` / `read`                                | **No: the API only logs emails.**                               | `hs_email_status` is `BOUNCED`, `FAILED`, `SCHEDULED`, `SENDING` or `SENT`. Reading bodies needs `sales-email-read`. **No public endpoint sends or drafts a 1:1 sales email.**    |
| Communications (SMS, WhatsApp, LinkedIn logs) | Log, read                                           | `/crm/objects/2026-09/communications`                                                                     | `internal_reversible`                                         | No                                                              |                                                                                                                                                                                   |
| Sequences                                     | List or read sequences; create or update a sequence | `/automation/sequences/2026-09/…`                                                                         | `read` / `internal_reversible`                                | No                                                              | Sales or Service Hub **Pro+ seat**. **User-level apps only.**                                                                                                                     |
| Sequences                                     | **Enroll a contact**                                | `POST /automation/sequences/2026-09/enrollments` with `sequenceId`, `contactId`, `senderEmail`            | **`external_send`**                                           | **Yes**: timed emails go out from the user's connected inbox    | 1,000 enrollments per inbox per day. The read, unenroll and pause endpoints don't support user-level apps yet. **No pending form** (§3).                                          |
| Email templates                               | Read, create, update                                | `/automation/email-templates/2026-09`                                                                     | `read` / `internal_reversible`                                | No                                                              |                                                                                                                                                                                   |
| Quotes                                        | Create (always `DRAFT`), update, read               | `POST /crm/objects/2026-09/quotes` (`hs_template_type: CPQ_QUOTE`)                                        | `internal_reversible`                                         | No                                                              | Needs line item, contact and deal associations before it can be published.                                                                                                        |
| Quotes                                        | **Publish**                                         | `PATCH` `hs_status` → `APPROVAL_NOT_NEEDED` (states: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`) | **`financial`** if payments are enabled, else `external_send` | Yes: creates a public `hs_quote_link` the buyer can sign or pay | The docs don't say whether publishing emails the buyer (**unverified**). The `cpq.quotes.*` scopes aren't allowed for user-level apps.                                            |
| Invoices, payments, subscriptions             | Read                                                | `/crm/objects/2026-09/invoices` etc.                                                                      | `read`                                                        | No                                                              | Writing them is **`financial`**: exclude.                                                                                                                                         |
| Marketing emails                              | Create or update a draft, read stats                | `/marketing/emails/2026-09`                                                                               | `internal_reversible`                                         | No                                                              | `marketing-email` scope.                                                                                                                                                          |
| Marketing emails                              | **Publish (send)**                                  | `…/publish`                                                                                               | **`external_send`** (bulk)                                    | Yes, to many people                                             | **Marketing Hub Enterprise** or the transactional add-on only.                                                                                                                    |
| Transactional single-send                     | Send                                                | Single-send API                                                                                           | **`external_send`**                                           | Yes                                                             | Marketing Hub Pro+ **with the Transactional Email add-on**. No draft state.                                                                                                       |
| Conversations inbox and help desk             | Read threads and messages                           | `/conversations/2026-09/conversations/threads…`                                                           | `read`                                                        | No                                                              | `conversations.read`.                                                                                                                                                             |
| Conversations                                 | Post an internal comment                            | same, comment-type message                                                                                | `internal_reversible`                                         | No                                                              | Docs: "Send an internal comment to an agent."                                                                                                                                     |
| Conversations                                 | **Send an outbound reply**                          | same, message-type                                                                                        | **`external_send`**                                           | Yes                                                             | `conversations.write`, available to all accounts.                                                                                                                                 |
| Scheduler                                     | Read meeting links and availability                 | `GET /scheduler/2026-09/meetings/meeting-links…`                                                          | `read`                                                        | No                                                              | Professional (`scheduler.meetings.meeting-link.read`).                                                                                                                            |
| Scheduler                                     | **Book a meeting**                                  | `POST /scheduler/2026-09/meetings/meeting-links/book`                                                     | **`external_send`**                                           | Yes (invite to the booker)                                      | Rarely needed.                                                                                                                                                                    |
| Lists                                         | Read; add or remove members                         | `/crm/lists/2026-09/…`                                                                                    | `read` / `internal_reversible`                                | Indirectly (lists drive marketing sends)                        |                                                                                                                                                                                   |
| Files                                         | Upload, read, download                              | `/files/2026-09/files`                                                                                    | `internal_reversible` / `read`                                | **Yes if `access` is `PUBLIC_*`**                               | Upload with `access: PRIVATE` only. `files.read`, `files.write`.                                                                                                                  |
| Files                                         | Delete                                              | `DELETE …`                                                                                                | **`destructive`**                                             | No                                                              | `files.delete`.                                                                                                                                                                   |
| Communication preferences                     | Subscribe or unsubscribe a contact                  | `/communication-preferences/…`                                                                            | Treat as **`destructive`**, or exclude                        | Affects consent                                                 | A legal and consent effect, not cleanly reversible.                                                                                                                               |
| Workflows v4 (beta)                           | Read, create, enroll                                | `/automation/v4/flows…`                                                                                   | Exclude                                                       | Possibly                                                        | Needs Pro+ (`automation`). Enrolling in a workflow can send emails Mycel can't see.                                                                                               |
| Users, teams, settings                        | Manage                                              | `settings.users.*`                                                                                        | Exclude                                                       | —                                                               | Intent non-goal 7 (no admin-level access).                                                                                                                                        |
| Imports, exports                              | Bulk                                                | `crm.import`, `crm.export`                                                                                | Exclude                                                       | —                                                               |                                                                                                                                                                                   |

### 3. Pending form

HubSpot has **no API to draft or send a 1:1 sales email**: the emails API only logs (§2). Each `external_send` maps as follows:

- **Follow-up email to a contact.** Recommended: **use Mycel's existing Gmail draft** (`google-mail.create-draft`). HubSpot then logs the sent email through the user's connected inbox or BCC address. This keeps one pending form for email. Alternative: a HubSpot task with `hs_task_type: EMAIL` and the draft text in `hs_task_body`. Prepare = `POST /crm/objects/2026-09/tasks`. Approve can't be done through the API: the person sends from HubSpot and completes the task. Check = `GET` the task: `NOT_STARTED` → `waiting`, `COMPLETED` → `done_in_app`, 404 or archived → `gone`. Decline = `DELETE` the task. This is a hand-off, not a true pending form.
- **Quote.**
  - Prepare: create the quote, which is always `DRAFT`, with its associations.
  - Approve: `PATCH hs_status=APPROVAL_NOT_NEEDED`. Accounts with quote approvals turned on use `PENDING_APPROVAL`, and HubSpot's own approvers then act.
  - Decline: `DELETE` the quote.
  - Check: `DRAFT` → `waiting`; `APPROVAL_NOT_NEEDED` or `APPROVED` set by someone else → `done_in_app`; 404 → `gone`.
  - Sharing the link with the buyer is a separate email, which would be a Gmail draft.
  - Classify as `financial` when `hs_payment_enabled` is true. This is a good native fit.
- **Help-desk or inbox reply.**
  - Prepare: an internal comment on the thread holding the drafted reply. The content stays in HubSpot, which fits invariant 8.
  - Approve: post an outbound message with that text, re-fetched at approval time.
  - Check: a later outbound message on the thread → `done_in_app`; thread archived → `gone`.
  - Decline: whether a comment can be deleted through the API is **unverified**.
  - This mirrors the Zendesk internal-note pattern.
- **Sequence enrollment: none, needs a design.** Enrolling starts automated sends. The closest native hold is a task "enroll X in sequence Y". Otherwise the Mycel review itself must hold the enrollment with no app-side form, which goes against ADR-0013.
- **Marketing email publish.** A draft marketing email is a natural pending form: prepare = create or update the draft; approve = `/publish`. But publishing through the API is Enterprise-only, and bulk sends are a poor v1 fit.
- **Booking a meeting: none, needs a design.** Use the Google Calendar no-guests pattern instead.

### 4. Triggers

**App webhooks** (developer platform `webhooks` component, or `/webhooks/2026-09/{appId}/…`):

- **Subscriptions are defined per app and apply to every account that installs it.** Up to 1,000 subscriptions per app.
- Classic types: `contact|company|deal|ticket|product|line_item` `.creation`, `.deletion`, `.propertyChange` (one named property per subscription), `.associationChange`, `.merge` and `.restore`; also `contact.privacyDeletion` and `conversation.*` (including `conversation.newMessage`).
- Generic `object.*` subscriptions cover: Appointment, Call, Cart, Commerce payment, Communication, Company, Contact, Course, Deal, Discount, Email, Fee, Feedback submission, Goal target, Invoice, Lead, Line item, Listing, Meeting event, Note, Order, Partner client, Postal mail, Product, Quote, Quote template, Service, Subscription, Task, Tax, Ticket and User.
  - Custom objects only for private apps.
  - No subscriptions on `hs_email_html` or `hs_email_subject`.
- Delivery:
  - Batches of up to 100 events.
  - Concurrency 10 by default (configurable; must be more than 5).
  - 5-second timeout.
  - Up to 10 retries spread over 24 hours.
  - Events can arrive out of order (use `occurredAt`) and can be duplicated.
  - Signed with `X-HubSpot-Signature` (v3 uses the client secret).
  - Settings are cached for up to 5 minutes.
  - Latency is near real time; HubSpot doesn't publish an SLA.
- **Webhooks don't work for user-level apps** (§5).

**Webhooks journal and management API (2026-09)**: a pull model.

- It authenticates with a **client-credentials token** (`developer.webhooks_journal.*`) rather than the install's token.
- Subscriptions are created **per installed account** (`portalId`).
  - Types: `OBJECT` (`CREATE`, `UPDATE`, `DELETE`, `MERGE`, `RESTORE`, `ASSOCIATION_ADDED`, `ASSOCIATION_REMOVED`, `SNAPSHOT`), `ASSOCIATION`, `LIST_MEMBERSHIP` and `APP_LIFECYCLE_EVENT` (install `4-1909196`, uninstall `4-1916193`).
  - Property filters can be attached (`CRM_OBJECT_PROPERTY` operators: OR across filters, AND within one).
- Read the journal with `GET /webhooks-journal/journal/2026-09/earliest`, `…/latest` and `…/offset/{offset}/next`. Each returns a short-lived file URL plus an offset.
- **3 days of retention.**
- This is the best fit for per-org triggers and for catching uninstalls, which invariant 3 deletion needs.

**Workflow webhooks** (the customer builds a workflow with a "Send a webhook" action):

- Needs **Data Hub Professional or Enterprise**, and workflows need Pro+ (Starter has none).
- The customer configures it, so it isn't something Mycel can set up.
- Custom workflow actions (the app defines an action customers drop into their workflows) need Pro+, the `automation` scope and an account-level app.

**Polling:** CRM search with `hs_lastmodifieddate` greater than a cursor, per object type. It is bounded by 5 requests/s per account and 10k results per query. Whether the search index lags behind writes is **unverified**.

### 5. Auth

**App model (developer platform; current version `2026.09`).** An app is a project, configured in `app-hsmeta.json` with `distribution` and `auth.type`.

- `distribution: marketplace` with `auth.type: oauth`:
  - **Up to 25 installs before listing**, unlimited after.
  - Listing requires:
    - at least 3 active installs in unaffiliated accounts within the last 30 days;
    - a manual review by the Ecosystem Quality team;
    - OAuth as the only authorization method;
    - only the scopes the app uses;
    - setup documentation, pricing, ToS and privacy pages;
    - the Technology Partner agreement.
- `distribution: private` with `oauth`: up to 10 allowlisted accounts. Fine for dogfooding.
- `static` auth: one account. Not usable for customers.
- Only a Super Admin, or a user with the _HubSpot Marketplace Access_ permission, can install an app.
- Access tokens last 30 minutes (`expires_in: 1800`); the refresh token is long-lived.
- The token URL is now date-versioned: Nango uses `https://api.hubapi.com/oauth/2026-09/token`.

**Account-level vs user-level access.** This is the key decision.

- **Account-level** (the default) gives one portal-wide grant. It maps to a Mycel **org connection** and supports app webhooks, custom workflow actions and app events.
- **User-level** (`isUserLevel: true`, platform `2026.09`, OAuth only) gives each user their own install, limited to that user's HubSpot permissions and audited as "[User] via [app]". It maps to a Mycel **member connection**.
  - **It doesn't support webhooks (v3/v4), custom workflow actions, app cards, agent tools or app objects.**
  - It covers only some APIs: the CRM objects, emails, notes, tasks and meetings work; pipelines are read-only; associations are single create and read only.
  - The scopes `cpq.quotes.*`, `cpq.quote_templates.read` and `crm.schemas.custom.write` aren't allowed.
  - An existing account-level app can't be converted; you must create a new app.
- **Sequences endpoints work only for user-level apps.**
- **Marketplace AI rule** (Marketplace restrictions page): apps where "an AI interprets natural language and decides which CRM actions to take must enforce user-level permissions… Standard OAuth tokens are not sufficient". Such apps must be built as an MCP auth app or a project MCP app with `isUserLevel: true`. The rule doesn't apply to "a static, pre-defined data sync that happens to use AI upstream".
  - Mycel's published workflows are fixed specs over fixed catalog actions, which arguably falls outside the rule. The builder chat is the grey area.
  - **Expect review friction. Whether an account-level Mycel app can be listed is unverified.**

**Scopes by capability group.** Scopes are granular. The `requiredScopes`, `optionalScopes` and `conditionallyRequiredScopes` lists let one app serve Free through Enterprise. Optional scopes are silently dropped when the account lacks the feature.

| Group                         | Scopes                                                                                                                         | Tier                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Contacts, companies, deals    | `crm.objects.{contacts,companies,deals}.read` / `.write`; `crm.schemas.{…}.read`                                               | All                                             |
| Owners, users                 | `crm.objects.owners.read`, `crm.objects.users.read`                                                                            | All                                             |
| Tickets                       | `crm.objects.tickets.read` / `.write` (the legacy `tickets` scope is still used by classic ticket webhooks)                    | All                                             |
| Leads                         | `crm.objects.leads.read` / `.write`                                                                                            | Sales Hub Pro+                                  |
| Custom objects                | `crm.objects.custom.read` / `.write`, `crm.schemas.custom.read`                                                                | **Enterprise**                                  |
| Notes, tasks, calls, meetings | Covered by the associated object's CRM scopes (**unverified**: no dedicated engagement scope appears in the scope list)        | All                                             |
| 1:1 email bodies              | `sales-email-read`                                                                                                             | All                                             |
| Sequences                     | `automation.sequences.read`, `automation.sequences.enrollments.write`                                                          | Sales or Service Pro+                           |
| Quotes                        | `crm.objects.quotes.read` / `.write`, `crm.objects.line_items.*`                                                               | All                                             |
| Conversations                 | `conversations.read`, `conversations.write`                                                                                    | All                                             |
| Files                         | `files.read`, `files.write`, `files.delete` (`files` is legacy)                                                                | All                                             |
| Lists                         | `crm.lists.read` / `.write`                                                                                                    | All                                             |
| Marketing email               | `marketing-email` (publishing needs Enterprise), `transactional-email` (add-on)                                                | Varies                                          |
| Workflows                     | `automation`                                                                                                                   | Pro+                                            |
| Sensitive data                | `crm.objects.*.sensitive.*` and `.highly_sensitive.*`                                                                          | Enterprise. Not allowed in apps with app cards. |
| Webhooks journal              | `developer.webhooks_journal.{read,subscriptions.read,subscriptions.write,snapshots.read,snapshots.write}` (client credentials) | —                                               |

HubSpot doesn't sort its scopes into sensitivity classes the way Google does. The review burden is the Marketplace listing review, not a security assessment.

### 6. Limits

- **Public (marketplace) OAuth apps: 110 requests per 10 seconds per installed account.** The API-limit add-on doesn't raise this. The usage page gives no daily cap for public apps.
- Private and static apps:
  - Free and Starter: 100 per 10 s, and 250,000 per day per account.
  - Pro: 190 per 10 s, and 625,000 per day.
  - Enterprise: 190 per 10 s, and 1,000,000 per day.
  - The add-on raises this to 250 per 10 s, plus 1M per day per add-on.
- Search: **5 requests/s per account**, no rate-limit headers, 10k-result cap.
- Errors should stay under 5% of daily requests (a certification criterion).
- Batch endpoints take up to 100 records (**unverified** for every object; association batch read takes 1,000 ids). Sequences: 1,000 enrollments per inbox per day.
- Webhooks: 1,000 subscriptions per app, batches of up to 100, concurrency 10, 5-second timeout.
- Workflows: Pro 300, Enterprise 1,000.
- Custom pipelines (shared across objects): Free 0, Starter 15, Pro 100 (350 on FSC portals), Enterprise 350.

### 7. Nango

- Provider `hubspot`: `OAUTH2`, with `connection_configuration: portalId`.
  - It has a `post_connection_script`, a `pre_connection_deletion_script` (deleting a connection revokes the refresh token by default; set `skipTokenRevocation` to keep it) and **`webhook_routing_script: hubspotWebhookRouting`**. Nango can therefore receive HubSpot's app-level webhooks at one URL and forward them to Mycel, attributed to the connection by portal.
  - Forwarded payloads look like `{type: "forward", connectionId, payload}`, signed with `X-Nango-Hmac-Sha256`. They are flagged `unverified` if the webhook secret isn't set.
- The proxy uses cursor pagination (`paging.next.after`) and reads `x-hubspot-ratelimit-remaining` for retries.
- Nango's docs list 10 prebuilt syncs and 40+ actions. **Installing from the HubSpot Marketplace isn't supported: connections must start in Nango's flow.** A listed app's "Install" button would need to land on a Mycel page that starts the Nango flow (**unverified** whether review accepts this).
- There is also a separate `hubspot-mcp` provider (`MCP_OAUTH2`, `mcp.hubspot.com`, user-level).
- Webhooks journal calls use the app's client-credentials token, which Nango doesn't hold per connection. Mycel would call the journal itself.

### 8. Gaps and gotchas

- **No 1:1 email send or draft API.** Email follow-ups have to go through the Gmail (or Outlook) draft. HubSpot is then a source of context and logging, not where the email waits.
- **Date-versioned APIs since 2026-03-30**:
  - New versions come every March and September. A version is current for 6 months, supported for 12 more, and unsupported after 18 months, when builds using it fail.
  - Legacy `v1`–`v4` paths "are still supported". Building on `2026-09` gives a support window to about March 2028, so expect an upgrade every year.
  - Developer platform versions: `2026.09` is current, `2026.03` and `2025.2` are supported (2025.2 through March 2027), `2025.1` was sunset on 2026-08-01, and `2023.2` on 2025-10-01.
  - Apps on an unsupported platform version can't be listed.
  - Legacy private apps can't be migrated; build new. Classic CRM cards have been unsupported since 2025-06-16.
- **The account-level vs user-level split is the biggest design question.**
  - Account-level gives webhooks and one org connection, but may collide with the AI-connector listing rule.
  - User-level fits member connections and the AI rule, but gives no push triggers. Polling or the journal would be needed; journal support for user-level apps is **unverified**.
  - Sequences need user-level.
- **The 25-install cap before listing** limits an unlisted rollout to 25 customer portals.
- Plan gates:
  - Workflows, sequences, the `automation` scope and scheduler links need Pro+.
  - Custom objects and sensitive-data scopes need Enterprise.
  - Sending marketing email through the API needs Enterprise; transactional email needs the add-on.
  - Free has only one deal pipeline.
- HubSpot workflows the customer already runs can turn an innocent `internal_reversible` property write into an outbound email. The policy engine can't see this.
- Email bodies can't be filtered in search, and webhooks can't fire on email subject or body. Classification must re-fetch content by id, which fits invariant 8.
- Deletion (invariant 3): an uninstall in HubSpot must be caught (the journal's `APP_LIFECYCLE_EVENT`, or a failed token refresh) so the connection and its data are deleted.

## Pipedrive

### 1. Summary

Pipedrive is a sales-pipeline CRM built for small and mid-sized companies. Its objects are deals in pipelines and stages, persons, organizations, leads (an inbox before deals), activities (calls, meetings, tasks and emails as to-dos), notes, products, files and projects. Every plan has the API, Lite included. The workflows it most enables:

1. **Stalled-deal nudge.** A deal hasn't moved in N days, so an activity is created for the owner and a follow-up email is drafted.
2. **After a meeting.** A Calendar or Gmail event ends, so a note is logged on the deal, the next-step activity is created and the stage is updated.
3. **Inbound lead intake.** A Gmail inquiry or form arrives, so a person, organization and lead are created and assigned, and a reply is drafted.
4. **Lead to deal conversion and handoff.** A lead is converted, the deal is set up, and a project is started on win (Projects is Premium+ or an add-on).
5. **Pipeline digest.** Deals at risk are summarized for the owner (read only).

### 2. Capability table

API v2 (`/api/v2/…`) is the current API for core objects. Many v1 core endpoints have been **out of support since 2026-08-01** (§8). The remaining v1 endpoints (notes, files, leads, mailbox, filters, goals, call logs, users, webhooks, recents) are still the only option for those resources.

| Resource                                                     | Operation                                                    | API method                                                                           | Proposed Mycel risk                               | Reaches people outside the user?                                                            | Notes                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deals                                                        | List (with `updated_since`, cursor), get, search             | `GET /api/v2/deals`, `GET /api/v2/deals/{id}`, `GET /api/v2/deals/search`            | `read`                                            | No                                                                                          | Results limited to what the authorizing user can see.                                                                                                |
| Deals                                                        | Create, update (stage, owner, value, custom fields)          | `POST`/`PATCH /api/v2/deals…`                                                        | `internal_reversible`                             | No                                                                                          | Pipedrive's own Automations (Growth+) may then send emails Mycel can't see.                                                                          |
| Deals                                                        | Delete                                                       | `DELETE /api/v2/deals/{id}`                                                          | **`destructive`**                                 | No                                                                                          |                                                                                                                                                      |
| Deals                                                        | Merge                                                        | v1 `PUT /deals/{id}/merge`                                                           | **`destructive`**                                 | No                                                                                          |                                                                                                                                                      |
| Deals                                                        | Products, discounts, installments on a deal                  | `/api/v2/deals/{id}/products`, `…/discounts`, `…/installments`                       | `internal_reversible`                             | No                                                                                          | These are internal records, not billing.                                                                                                             |
| Deals                                                        | Followers, participants                                      | v2 followers; v1 participants                                                        | `internal_reversible`                             | No                                                                                          |                                                                                                                                                      |
| Deals and leads                                              | Convert deal ↔ lead, check conversion status                 | `POST /api/v2/deals/{id}/convert/lead`, `POST /api/v2/leads/{id}/convert/deal`       | `internal_reversible`                             | No                                                                                          | Asynchronous: poll the status.                                                                                                                       |
| Persons, organizations                                       | List, get, search, create, update                            | `/api/v2/persons`, `/api/v2/organizations`, `…/search`                               | `read` / `internal_reversible`                    | No                                                                                          |                                                                                                                                                      |
| Persons, organizations                                       | Delete, merge                                                | v2 `DELETE`; v1 merge                                                                | **`destructive`**                                 | No                                                                                          |                                                                                                                                                      |
| Leads                                                        | List, get, create, update; labels, sources                   | v1 `/leads`, `/leadLabels`, `/leadSources`; v2 `/api/v2/leads/search`                | `read` / `internal_reversible`                    | No                                                                                          |                                                                                                                                                      |
| Leads                                                        | Delete                                                       | v1 `DELETE /leads/{id}`                                                              | **`destructive`**                                 | No                                                                                          |                                                                                                                                                      |
| Activities                                                   | List, get, create, update, mark done                         | `/api/v2/activities` (`done`, `type`, `due_date`, `deal_id`, `attendees`, …)         | `internal_reversible`                             | **Possibly**: activities with `attendees` may sync to the user's calendar and invite guests | Whether an API-created activity with external attendees sends invites is **unverified** (the docs are silent). Without attendees, treat as internal. |
| Activities                                                   | Delete                                                       | `DELETE /api/v2/activities/{id}`                                                     | **`destructive`**                                 | No                                                                                          |                                                                                                                                                      |
| Notes                                                        | List, get, create, update; comments on notes                 | v1 `/notes`, `/notes/{id}/comments`                                                  | `internal_reversible`                             | No                                                                                          | Notes attach to deals, persons, organizations or leads.                                                                                              |
| Notes                                                        | Delete                                                       | v1 `DELETE /notes/{id}`                                                              | **`destructive`**                                 | No                                                                                          |                                                                                                                                                      |
| Mail (synced inbox)                                          | Read threads, messages, messages per deal or person          | v1 `/mailbox/mailThreads…`, `/mailbox/mailMessages/{id}`, `/deals/{id}/mailMessages` | `read`                                            | No                                                                                          | `mail:read`. Email sync needs **Growth+**.                                                                                                           |
| Mail                                                         | Update a thread (link to a deal, mark read, archive)         | v1 `PUT /mailbox/mailThreads/{id}`                                                   | `internal_reversible`                             | No                                                                                          | `mail:full`.                                                                                                                                         |
| Mail                                                         | Delete a thread                                              | v1 `DELETE /mailbox/mailThreads/{id}`                                                | **`destructive`**                                 | No                                                                                          |                                                                                                                                                      |
| Mail                                                         | **Send or draft an email**                                   | —                                                                                    | —                                                 | —                                                                                           | **No API.** Not in the v1 or v2 OpenAPI path lists.                                                                                                  |
| Files                                                        | List, get, download, upload; link a remote Google Drive file | v1 `/files`, `/files/remote`, `/files/remoteLink`                                    | `read` / `internal_reversible`                    | No                                                                                          |                                                                                                                                                      |
| Files                                                        | Delete                                                       | v1 `DELETE /files/{id}`                                                              | **`destructive`**                                 | No                                                                                          |                                                                                                                                                      |
| Products                                                     | CRUD, search, variations, images                             | `/api/v2/products…`                                                                  | `internal_reversible` (delete: **`destructive`**) | No                                                                                          |                                                                                                                                                      |
| Pipelines, stages                                            | Read                                                         | `/api/v2/pipelines`, `/api/v2/stages`; v1 conversion and movement stats              | `read`                                            | No                                                                                          |                                                                                                                                                      |
| Pipelines, stages, fields                                    | Create, update, delete                                       | `/api/v2/pipelines…`, `/api/v2/dealFields…`                                          | Exclude (admin)                                   | —                                                                                           | `admin` scope (pipelines) or `*-fields:full`.                                                                                                        |
| Projects, tasks, boards, phases                              | CRUD, archive, search                                        | `/api/v2/projects`, `/api/v2/tasks`, `/api/v2/boards`, `/api/v2/phases`              | `internal_reversible` (delete: **`destructive`**) | No                                                                                          | Premium+, or add-on.                                                                                                                                 |
| Filters, goals                                               | Read, create                                                 | v1 `/filters`, `/goals`                                                              | `read` / `internal_reversible`                    | No                                                                                          |                                                                                                                                                      |
| Call logs                                                    | Add, attach audio                                            | v1 `/callLogs`                                                                       | `internal_reversible`                             | No                                                                                          | `phone-integration` scope.                                                                                                                           |
| Search                                                       | Across item types or by one field                            | `GET /api/v2/itemSearch`, `/api/v2/itemSearch/field`                                 | `read`                                            | No                                                                                          | Limited to 10 requests per 2 seconds.                                                                                                                |
| Recents (changelog feed)                                     | Changes since a timestamp                                    | v1 `GET /recents?since_timestamp=…&items=…`                                          | `read`                                            | No                                                                                          | `recents:read`. A polling source.                                                                                                                    |
| Users, roles, permissions                                    | Read, manage                                                 | v1 `/users`, `/roles`, `/permissionSets`                                             | Read only; exclude writes                         | —                                                                                           |                                                                                                                                                      |
| Webhooks                                                     | Create, list, delete                                         | v1 `/webhooks`                                                                       | — (infrastructure)                                | —                                                                                           | `webhooks:full`.                                                                                                                                     |
| Smart Docs (quotes, proposals, e-sign), Sequences, Campaigns | —                                                            | —                                                                                    | —                                                 | —                                                                                           | **No public API endpoints** (absent from the v1 and v2 OpenAPI path lists, 2026-10-21).                                                              |

### 3. Pending form

Pipedrive has almost no native outbound actions in its API, so few pending forms are needed:

- **Follow-up email: use Mycel's Gmail draft.** Pipedrive has no send or draft API. With email sync (Growth+), the sent email appears on the deal automatically. On Lite there is no email sync; log a note instead.
- **Meeting with an external attendee: none verified, needs a design.**
  - Possible shape: prepare = activity without `attendees`; approve = `PATCH` the attendees on.
  - It is unknown whether Pipedrive then emails invites, or only does so through calendar sync (**unverified**).
  - Safer: hold the meeting as a Google Calendar event with no guests (the existing ADR-0013 pattern) and log a Pipedrive activity.
- **Quotes and proposals (Smart Docs), sequences, campaigns: not reachable through the API.**
- **Hand-off pattern:** an activity of type `email` assigned to the owner, with the draft in its note. Check through `done` (`true` → `done_in_app`; 404 → `gone`). It is a reminder, not a true pending form.

### 4. Triggers

**Webhooks v2** (`POST /v1/webhooks`; v2 is the default for webhooks created since 2025-03-17, and v1 webhooks are "deprecated completely in 2026"):

- Events: `create`, `change` and `delete` on `activity`, `deal`, `deal_installment`, `deal_product`, `lead`, `note`, `organization`, `person`, `pipeline`, `product`, `stage`, `user`, `board`, `phase`, `project` and `task`. **There are no mail events**, so new synced email has to be polled.
- Payload: `meta` (action, entity, ids, timestamps, attempt count), `data`, and `previous` (only the changed fields).
- **Each webhook belongs to a user and only delivers events for objects that user can see.**
- Limits and delivery:
  - Up to 40 webhooks per user.
  - Basic HTTP auth on the target URL is supported.
  - Marketplace apps create `type: application` webhooks with `webhooks:full`, and can see or delete only their own.
  - Delivery is weak:
    - 10-second timeout, then only **3 retries** (after 3, 30 and 150 seconds).
    - **10 failures puts the webhook on a 30-minute ban during which events are lost.**
    - A webhook with no successful delivery for 3 consecutive days is deleted automatically.
  - Latency is near real time; there is no SLA.
- **Polling backstop needed:**
  - v2 lists take `updated_since` and `updated_until` with a `cursor`.
  - v1 `/recents?since_timestamp=` gives a cross-object change feed.
  - Synced mail: `/mailbox/mailThreads` per folder.
- Pipedrive Automations' "Webhook" action is configured by the customer. Its docs say "Advanced and higher" (old plan names); in current naming that is probably Growth+ (**unverified** mapping).

### 5. Auth

- An OAuth 2.0 app registered in **Developer Hub**. It needs a developer sandbox account.
- **Private (unlisted) app:** made live by the developer and shared "with any user/company in Pipedrive via a direct, unlisted installation link". The docs mention no review and no install cap.
- **Public Marketplace app:** reviewed by the Marketplace team, taking "up to 21 business days". It needs:
  - OAuth only;
  - a demo video and test accounts;
  - ToS, privacy and pricing pages;
  - the Developer Partner Agreement;
  - only the scopes it uses;
  - "no spam emails from connected accounts".
  - The docs state no AI-specific rule.
- **Authorization is per user, not per company.**
  - The token acts with the authorizing user's visibility.
  - An admin can add the app for "Specific users" or "All users", but each user must still authorize.
  - This maps cleanly to Mycel **member** connections. An org-wide view needs an admin user's connection, and Pipedrive's permission sets still apply.
- Tokens:
  - The access token expires after 60 minutes.
  - **The refresh token expires after 60 days without use**, so idle connections must be refreshed on a schedule.
  - Each token response carries `api_domain`, the company-specific base URL.
- Scopes. Users accept them all or none, and there's no optional-scope mechanism:
  - `base`
  - `deals:read` / `deals:full`
  - `contacts:read` / `contacts:full`
  - `activities:read` / `activities:full`
  - `leads:read` / `leads:full`
  - `mail:read` / `mail:full`
  - `products:read` / `products:full`
  - `projects:read` / `projects:full`
  - `users:read`, `recents:read`, `search:read`
  - `goals:read` / `goals:full`
  - `webhooks:read` / `webhooks:full`
  - `deal-fields:full`, `contact-fields:full`, `product-fields:full`, `project-fields:full`
  - `phone-integration`, `video-calls`, `messengers-integration`
  - **`admin` (requires an admin installer**: pipelines, stages, fields, activity types, users, roles, webhooks). Avoid it, per non-goal 7.
- A suggested v1 set: `base deals:full contacts:full activities:full leads:full mail:read search:read recents:read users:read webhooks:full`.
- Pipedrive has no sensitivity classes; the only burden is the Marketplace review, and only if listing.

### 6. Limits

- **Token-based daily budget per company: 30,000 × plan multiplier × seats**, plus purchased top-ups. Multipliers: Lite 1, Growth 2, Premium 5, Ultimate 7.
  - Per-call costs in v1: get one 2, list 20, update 10, delete 6, search 40. v2 endpoints cost less ("50% fewer tokens" per the deprecation post).
  - A 3-seat Lite company has 90,000 tokens a day, about 4,500 v1 list calls. Polling must be frugal.
- **Burst per 2 seconds, OAuth apps:** Lite 80, Growth 160, Premium 400, Ultimate 480. API-token users get a quarter of that.
- **Search: 10 requests per 2 seconds on every plan.**
- On exhaustion, 429. Sustained abuse gets a 403 Cloudflare block.
- Headers: `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`.
- Leads and deals per company: 2,500 × seats (Lite) up to 20,000 × seats (Ultimate), capped at 300,000. Active automations: Growth 50, Premium 150, Ultimate 250.

### 7. Nango

- Provider `pipedrive`: `OAUTH2` (basic auth at the token endpoint, PKCE disabled).
  - `token_response_metadata: api_domain`, and the proxy `base_url` is `${connectionConfig.api_domain}/api`.
  - Pagination is offset-based (`start`, `limit`, `data`). v2 endpoints use `cursor`, so pagination may need overriding (**unverified**).
- **No `webhook_routing_script`**, so Nango doesn't route Pipedrive webhooks. That doesn't matter much: webhooks are created per user through the API, so Mycel can register each one with a connection-specific URL and basic-auth credentials and receive them directly.
- Nango's docs list prebuilt syncs (activities, deals, leads, notes, organizations, persons, pipelines, products, stages, users) and 40+ CRUD actions.

### 8. Gaps and gotchas

- **No email send or draft API, and no API for Smart Docs (quotes, e-sign), Sequences or Campaigns.** Pipedrive is a system of record that Mycel updates directly (`internal_reversible`). Anything outbound goes through Gmail or Calendar pending forms.
- **API v1 deprecation:**
  - Selected v1 endpoints (activities, deals, persons, organizations, products, pipelines, stages, `itemSearch`) were deprecated from 2026-01-01 and are **out of support from 2026-08-01**, with no guaranteed further notice before removal.
  - Build only on v2 where it exists. Notes, files, leads CRUD, mailbox, filters, goals, recents and webhooks are still v1-only and supported.
  - The Channels API was deprecated 2026-02-01.
- **Plan gates:**
  - Lite has no email sync, templates, automations or sequences.
  - Smart Docs, Projects and LeadBooster are included in Premium+ and are add-ons below that.
  - Campaigns is an add-on on every plan.
  - Because the API is on every plan, actions must check what the account actually has.
- **Webhook reliability is poor** (3 retries, a 30-minute ban that loses events, auto-deletion). Combine webhooks with `updated_since` or `/recents` polling, and re-create webhooks that vanish.
- **Per-user visibility:** a member's connection only sees, and only gets events for, what that member can see. The "org" view depends on whose connection is used. This fits Mycel's member/org scope model, but promotion rules matter (invariant 2).
- The refresh token's 60-day idle expiry means a dormant connection silently dies unless it is refreshed.
- Deletion (invariant 3): I found no documented uninstall callback for OAuth apps (**unverified**). Detect `invalid_grant` on refresh, and delete on the user's revoke.

## Sources

HubSpot (developer docs as served 2026-10-21; per-page dates not shown unless noted):

- Versioning (platform `2026.09` available 2026-09-08): https://developers.hubspot.com/docs/developer-tooling/platform/versioning
- Usage guidelines and limits: https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines
- APIs by tier (the table renders client-side; not readable): https://developers.hubspot.com/docs/developer-tooling/platform/apis-by-tier
- Docs index and full text: https://developers.hubspot.com/docs/llms.txt · https://developers.hubspot.com/docs/llms-full.txt
- Authentication overview: https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/overview
- User-level apps: https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/user-level-apps
- Scopes: https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/scopes
- App configuration (distribution): https://developers.hubspot.com/docs/apps/developer-platform/build-apps/app-configuration
- Manage apps (install limits 10 / 25 / unlimited): https://developers.hubspot.com/docs/apps/developer-platform/build-apps/manage-apps-in-hubspot
- Migration overview: https://developers.hubspot.com/docs/apps/developer-platform/build-apps/migrate-an-app/overview
- Working with OAuth: https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/working-with-oauth
- Manage OAuth tokens (30-minute access token): https://developers.hubspot.com/docs/api-reference/latest/authentication/manage-oauth-tokens
- Marketplace listing requirements: https://developers.hubspot.com/docs/apps/developer-platform/list-apps/listing-your-app/app-marketplace-listing-requirements
- Marketplace restrictions (AI connectors): https://developers.hubspot.com/docs/apps/developer-platform/list-apps/listing-your-app/marketplace-restrictions
- Configure webhooks: https://developers.hubspot.com/docs/apps/developer-platform/add-features/configure-webhooks
- Webhooks API guide: https://developers.hubspot.com/docs/api-reference/latest/webhooks/guide
- Generic webhook subscriptions: https://developers.hubspot.com/docs/apps/legacy-apps/public-apps/create-generic-webhook-subscriptions
- Webhooks journal:
  - Overview: https://developers.hubspot.com/docs/api-reference/latest/webhooks-journal/guide
  - Subscriptions: https://developers.hubspot.com/docs/api-reference/latest/webhooks-journal/subscriptions/guide
  - Journal entries: https://developers.hubspot.com/docs/api-reference/latest/webhooks-journal/journal-entries/guide
- Emails (engagements): https://developers.hubspot.com/docs/api-reference/latest/crm/activities/emails/guide
- Tasks: https://developers.hubspot.com/docs/api-reference/latest/crm/activities/tasks/guide
- Meetings: https://developers.hubspot.com/docs/api-reference/latest/crm/activities/meetings/guide
- Sequences: https://developers.hubspot.com/docs/api-reference/latest/automation/sequences/guide
- Quotes:
  - Current: https://developers.hubspot.com/docs/api-reference/latest/crm/objects/quotes/guide
  - Legacy (`hs_status` states): https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/quotes/guide
- CRM search (limits): https://developers.hubspot.com/docs/api-reference/latest/crm/search-the-crm
- Associations: https://developers.hubspot.com/docs/api-reference/latest/crm/associations/associate-records/guide
- Conversations: https://developers.hubspot.com/docs/api-reference/latest/conversations/conversations/guide
- Meetings scheduler: https://developers.hubspot.com/docs/api-reference/latest/meetings/scheduler/guide
- Marketing emails: https://developers.hubspot.com/docs/api-reference/latest/marketing/marketing-emails/guide
- Files: https://developers.hubspot.com/docs/api-reference/latest/files/guide
- Workflow actions (last updated 2026-09-25): https://knowledge.hubspot.com/workflows/choose-your-workflow-actions
- Workflows FAQ (last updated 2026-08-03): https://knowledge.hubspot.com/workflows/workflows-faq
- Pipelines (last updated 2026-09-29): https://knowledge.hubspot.com/object-settings/set-up-and-customize-pipelines

Pipedrive:

- Rate limiting (updated 2026-09-17): https://pipedrive.readme.io/docs/core-api-concepts-rate-limiting
- Webhooks v2 guide (updated 2026-07-28): https://pipedrive.readme.io/docs/guide-for-webhooks-v2
- Webhooks v2 default (posted 2024-12-17): https://developers.pipedrive.com/changelog/post/breaking-change-webhooks-v2-will-become-the-new-default-version
- Webhook OAuth scopes: https://developers.pipedrive.com/changelog/post/introducing-new-oauth-scopes-for-webhooks
- Scopes (updated 2026-05-04): https://pipedrive.readme.io/docs/marketplace-scopes-and-permissions-explanations
- OAuth authorization (updated 2026-06-09): https://pipedrive.readme.io/docs/marketplace-oauth-authorization
- Registering a public app (updated 2026-09-21): https://pipedrive.readme.io/docs/marketplace-registering-the-app
- Registering a private app (updated 2025-11-12): https://pipedrive.readme.io/docs/marketplace-registering-a-private-app
- App approval process (updated 2025-11-12): https://pipedrive.readme.io/docs/marketplace-app-approval-process
- App sharing (updated 2026-04-08): https://pipedrive.readme.io/docs/app-sharing-adding-apps-to-multiple-users
- OpenAPI specs (path and operation lists, fetched 2026-10-21): https://developers.pipedrive.com/docs/api/v1/openapi.yaml · https://developers.pipedrive.com/docs/api/v2/openapi.yaml
- Deprecation of selected v1 endpoints: https://developers.pipedrive.com/changelog/post/deprecation-of-selected-api-v1-endpoints
- v1 endpoints out of support (posted 2026-07-29): https://developers.pipedrive.com/changelog/post/deprecated-apiv1-endpoints-become-out-of-support
- Changelog: https://developers.pipedrive.com/changelog
- Plan features: https://support.pipedrive.com/en/article/what-features-do-the-pipedrive-plans-have
- Automations webhook action: https://support.pipedrive.com/en/article/automations-webhook-requests

Nango:

- providers.yaml (`hubspot`, `hubspot-mcp`, `pipedrive` entries; fetched 2026-10-21): https://github.com/NangoHQ/nango/blob/master/packages/providers/providers.yaml
- HubSpot integration: https://nango.dev/docs/api-integrations/hubspot
- HubSpot app setup: https://nango.dev/docs/api-integrations/hubspot/how-to-register-your-own-hubspot-api-oauth-app
- Pipedrive integration: https://nango.dev/docs/api-integrations/pipedrive
- Webhook forwarding: https://nango.dev/docs/guides/platform/webhook-forwarding
