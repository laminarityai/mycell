# Support and commerce: Zendesk, Help Scout, Shopify

Researched 2026-10-21 against vendor docs (fetched the same day). Where a page shows a date, it is noted. Risk levels use Mycel's scale: `read` < `internal_reversible` < `external_send` < `financial` < `destructive`.

Cross-app findings in brief:

- **Help Scout has the best pending form.** Its native draft reply (`draft: true`) maps cleanly onto prepare and check. Approve is a two-call workaround (schedule the draft, then publish the schedule). Decline has no API at all: there is no endpoint to delete a thread.
- **Zendesk has no server-side draft-reply API.** Composer "draft mode" is a UI feature only. The best server-side pending form is an internal note (`public: false`) holding the draft; approve posts it as a public comment. The only way to put text into the reply box itself is a sidebar app (Zendesk Apps framework) acting on a ticket that is open in the browser.
- **Zendesk's push triggers are admin-only.** Webhooks, triggers and incremental export all need an admin, which runs into Mycel's non-goal 7 ("no admin-level data access"). An agent-level connection must poll Search or Views instead.
- **Shopify's draft order is a true pending form.** It is created silently, and `draftOrderInvoiceSend` emails the customer a checkout link. The cost of entry is public-app review, Level 2 protected customer data review, Shopify Billing for App Store apps, GraphQL only, and expiring tokens. Most Shopify write actions are `financial` (refunds, cancellations, order edits).

---

## Zendesk

### 1. Summary

Zendesk is a helpdesk: customer email, web forms and chat become **tickets** that agents work through. A comment is either a public reply (emailed to the requester) or an internal note. Supporting pieces are macros (canned responses and field changes), views (saved ticket lists), triggers and automations (admin-defined rules), and a Help Center (knowledge base). Zendesk claims 80k+ companies (see 00-ranking).

The workflows it most enables:

1. **Triage new tickets.** Classify a new ticket, then set tags, priority, group or assignee and custom fields (`internal_reversible`).
2. **Draft a reply.** Write a first reply from Help Center articles and macros, held for an agent to approve and send (`external_send`).
3. **Escalate and summarise.** Add an internal note with a summary and move the ticket to a group.
4. **Fill knowledge gaps.** Find repeated questions that no article answers and draft a Help Center article (internal until published).
5. **Chase stale tickets.** For tickets that have sat pending or open too long, draft a follow-up or set a reminder.

### 2. Capability table

Base URL `https://{subdomain}.zendesk.com`. An OAuth token acts as the authorising user, within that user's role.

| Operation                                                                      | API method                                                           | Proposed Mycel risk                                                         | Reaches people outside the user?                                                       | Notes                                                                                                                                                                      |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tickets**                                                                    |                                                                      |                                                                             |                                                                                        |                                                                                                                                                                            |
| Get, list or show many tickets                                                 | `GET /api/v2/tickets/{id}`, `GET /api/v2/tickets`, `show_many`       | read                                                                        | no                                                                                     | Listing past page 500 is limited to 50 req/min.                                                                                                                            |
| Search tickets, users or orgs                                                  | `GET /api/v2/search?query=type:ticket ...`                           | read                                                                        | no                                                                                     | Agent-level, so it is the polling fallback.                                                                                                                                |
| List a ticket's comments                                                       | `GET /api/v2/tickets/{id}/comments`                                  | read                                                                        | no                                                                                     | Holds message content: keep in memory only (invariant 8).                                                                                                                  |
| Ticket audits                                                                  | `GET /api/v2/tickets/{id}/audits`                                    | read                                                                        | no                                                                                     |                                                                                                                                                                            |
| Set tags, priority, status, type, group, assignee or custom fields             | `PUT /api/v2/tickets/{id}` (fields only, no comment)                 | internal_reversible                                                         | no, but see note                                                                       | Setting status to `solved` can fire the account's own triggers (e.g. CSAT or "solved" emails). Use `safe_update` + `updated_stamp` to avoid overwriting a concurrent edit. |
| Add an internal note                                                           | `PUT /api/v2/tickets/{id}` with `comment: {body, public: false}`     | internal_reversible                                                         | no (other agents see it)                                                               | Comments can't be deleted, only redacted. "Reversible" here means it can be hidden by redaction.                                                                           |
| **Add a public reply**                                                         | `PUT /api/v2/tickets/{id}` with `comment: {body, public: true}`      | **external_send**                                                           | **yes**: the requester and CCs are emailed through the account's notification triggers | No pending form in the API (see §3).                                                                                                                                       |
| Create a ticket                                                                | `POST /api/v2/tickets`                                               | internal_reversible if no requester email goes out; otherwise external_send | depends on the account's triggers                                                      | A "ticket received" trigger may email the requester.                                                                                                                       |
| Bulk update                                                                    | `PUT /api/v2/tickets/update_many`                                    | internal_reversible                                                         | no                                                                                     | Runs as an async job (max 30 concurrent jobs).                                                                                                                             |
| Merge tickets                                                                  | `PUT /api/v2/tickets/{id}/merge`                                     | **destructive**                                                             | can be: merge comments may be public                                                   | Cannot be undone.                                                                                                                                                          |
| Mark as spam                                                                   | `PUT /api/v2/tickets/{id}/mark_as_spam`                              | **destructive**                                                             | no                                                                                     | Also suspends the requester.                                                                                                                                               |
| Soft delete                                                                    | `DELETE /api/v2/tickets/{id}`, `destroy_many`                        | **destructive**                                                             | no                                                                                     | Restorable with `PUT /api/v2/deleted_tickets/{id}/restore` until the ticket is purged.                                                                                     |
| Permanent delete                                                               | `DELETE /api/v2/deleted_tickets/{id}`                                | **destructive**                                                             | no                                                                                     | Irreversible.                                                                                                                                                              |
| Make a comment private                                                         | `PUT /api/v2/tickets/{id}/comments/{cid}/make_private`               | internal_reversible                                                         | no                                                                                     | Docs don't say whether it can be reversed.                                                                                                                                 |
| Redact a comment                                                               | `PUT /api/v2/comment_redactions/{cid}`                               | **destructive**                                                             | no                                                                                     | "Permanent and can not be undone."                                                                                                                                         |
| **Side conversations**                                                         |                                                                      |                                                                             |                                                                                        |                                                                                                                                                                            |
| Start a side conversation (email to a third party, Slack, Teams, child ticket) | `POST /api/v2/tickets/{id}/side_conversations`                       | **external_send** (email)                                                   | **yes**                                                                                | Needs the **Collaboration add-on**. No draft state.                                                                                                                        |
| **Macros**                                                                     |                                                                      |                                                                             |                                                                                        |                                                                                                                                                                            |
| List, search or show macros                                                    | `GET /api/v2/macros`, `/macros/active`, `/macros/search`             | read                                                                        | no                                                                                     | Good grounding for reply drafting.                                                                                                                                         |
| Preview a macro on a ticket                                                    | `GET /api/v2/tickets/{tid}/macros/{mid}/apply`                       | read                                                                        | no                                                                                     | Returns the changed ticket and comment **without saving**, so it can serve as a pending-form helper.                                                                       |
| Create, update or delete a macro                                               | `POST`/`PUT`/`DELETE /api/v2/macros/{id}`                            | internal_reversible (delete: destructive)                                   | no                                                                                     | Changes team configuration: admin-type work.                                                                                                                               |
| **Views**                                                                      |                                                                      |                                                                             |                                                                                        |                                                                                                                                                                            |
| List a view's tickets                                                          | `GET /api/v2/views/{id}/tickets`, `/views/{id}/execute`              | read                                                                        | no                                                                                     | An agent-level polling trigger: "a new ticket in view X".                                                                                                                  |
| **Triggers and automations**                                                   |                                                                      |                                                                             |                                                                                        |                                                                                                                                                                            |
| List or show                                                                   | `GET /api/v2/triggers`, `/automations`                               | read                                                                        | no                                                                                     |                                                                                                                                                                            |
| Create, update or delete                                                       | `POST`/`PUT`/`DELETE /api/v2/triggers/{id}`                          | out of scope                                                                | can email                                                                              | Admin configuration. Mycel shouldn't author business rules.                                                                                                                |
| **Users and organizations**                                                    |                                                                      |                                                                             |                                                                                        |                                                                                                                                                                            |
| Show, search or list                                                           | `GET /api/v2/users/{id}`, `/users/search`, `/organizations/{id}`     | read                                                                        | no                                                                                     |                                                                                                                                                                            |
| Create or update a user or org; set tags or fields                             | `POST`/`PUT /api/v2/users`, `/organizations`                         | internal_reversible                                                         | creating a user may send a welcome email if Help Center sign-up is on                  | Update User is limited to 5 req/min per user.                                                                                                                              |
| Merge users                                                                    | `PUT /api/v2/users/{id}/merge`                                       | **destructive**                                                             | no                                                                                     | Irreversible.                                                                                                                                                              |
| Delete a user or org; permanently delete a user                                | `DELETE /api/v2/users/{id}`, `DELETE /api/v2/deleted_users/{id}`     | **destructive**                                                             | no                                                                                     |                                                                                                                                                                            |
| **Help Center (Guide)**                                                        |                                                                      |                                                                             |                                                                                        |                                                                                                                                                                            |
| List or search articles                                                        | `GET /api/v2/help_center/articles`, `/articles/search`               | read                                                                        | no                                                                                     | Scope `hc:read`.                                                                                                                                                           |
| Create an article as a draft; update a draft                                   | `POST /api/v2/help_center/sections/{id}/articles` with `draft: true` | internal_reversible                                                         | no                                                                                     | Scope `hc:write`.                                                                                                                                                          |
| Publish an article or translation                                              | update with `draft: false`                                           | **external_send** (public website)                                          | **yes**: public, or visible to signed-in users                                         | The Guide draft is the pending form.                                                                                                                                       |
| Delete or archive an article                                                   | `DELETE /api/v2/help_center/articles/{id}`                           | **destructive** (archived articles can be restored in the UI)               | yes                                                                                    |                                                                                                                                                                            |
| **Satisfaction ratings**                                                       | `GET /api/v2/satisfaction_ratings`                                   | read                                                                        | no                                                                                     |                                                                                                                                                                            |

Sources: Tickets, Ticket Comments, Macros, Side Conversations, Triggers and Rate Limits API references, and the OAuth scopes reference (see Sources).

### 3. Pending form

**Verdict: Zendesk has no API-level draft reply.**

- Composer "draft mode" lets an agent "refine your public replies in tickets before sending them". The Help Center article says nothing of server storage or an API, and the Tickets API has no draft field. Comments are created only through ticket create or update, with `public` true or false.
- Copilot's "suggested first replies" is UI-only, and Zendesk is **discontinuing it on 2027-01-19**. I found no public suggested-reply or draft API for Copilot or AI agents.

The options, best first:

**A. Internal note as the holder (recommended; works with plain REST).**

- **prepare**: `PUT /api/v2/tickets/{id}` with `comment: {public: false, html_body: "<draft>"}`, plus `safe_update`. The note body starts with a marker such as "Mycel draft reply, awaiting approval". Mycel stores the ticket ID, the comment ID (from the audit in the response) and `source_ref`.
- **approve**: re-fetch the note from `GET .../comments`, which keeps the content in memory only (invariant 8). Then `PUT /api/v2/tickets/{id}` with `comment: {public: true, html_body: <note body minus marker>}`. This fires the account's normal notification triggers, so the requester is emailed.
  - Optionally redact the draft note afterwards to avoid a visible duplicate. That makes approve partly destructive, so don't by default.
- **decline**: add a short internal note ("Declined in Mycel"), or redact the draft note (`PUT /api/v2/comment_redactions/{cid}`, permanent).
- **check**:
  - `done_in_app`: a public agent comment was added after the note was created. This is a heuristic: Mycel can't tell whether the agent sent our text.
  - `gone`: the note was redacted, or the ticket was deleted, merged or closed.
  - `waiting`: neither of the above.
- **Weaknesses:**
  - An agent who wants to send it must copy and paste the note, or approve in Mycel.
  - Notes are visible to every agent, which may be fine.
  - Approving changes the author to the token's user.

**B. A Zendesk Apps framework sidebar app (Marketplace "public app").** The client-side API (`comment.appendText` / `appendHtml` / `appendMarkdown`, `ticket.editor.targetChannel`) can put Mycel's draft into the composer of a ticket that is open in the agent's browser. The agent then edits and sends natively, which is the closest thing to a Gmail draft. Costs:

- a front-end app to build and pass through Marketplace review
- it acts only while the ticket is open
- Mycel learns about the send only through a later comment event

Good as a v2 add-on to A, not a replacement.

**C. Macro preview.** `GET /tickets/{tid}/macros/{mid}/apply` shows what a macro would do without saving. This suits suggesting "apply macro X" rather than free text.

Side-conversation emails and ticket creation that emails a requester have no pending form. They would need option A ("approve, then Mycel creates it") or a new design.

### 4. Triggers

**Push.** Webhooks (`/api/v2/webhooks`):

- **Who can set them up.** Creating a webhook is admin-only ("Admins, with restrictions"). It can subscribe to:
  - **event types**: `zen:event-type:ticket.created`, `ticket.comment_added`, `ticket.status_changed`, `ticket.tags_changed`, `ticket.group_assignment_changed`, `ticket.agent_assignment_changed`, `ticket.custom_field_changed`, `ticket.priority_changed`, `ticket.merged`, `ticket.soft_deleted`, `ticket.permanently_deleted`, `ticket.csat_received` and about 25 more ticket events; also `user`, `organization`, `article`, `agent` availability and `messaging` families
  - **`conditional_ticket_events`**: the webhook is wired to a trigger or automation, which an admin also creates
- **Signing.** Requests can be HMAC-signed with a signing secret. Auth to our endpoint can be basic, bearer or API key.
- **Delivery.**
  - 12 s timeout, and timeouts are retried up to 5 times.
  - A 409 response is retried up to 3 times.
  - 429 and 503 are retried only when `retry-after` is under 60 s.
  - A circuit breaker opens when 70% of requests error, or 1,000+ errors occur, within 5 min (only above 100 requests in 5 min). It pauses delivery for 5 s.
  - Trial accounts are capped at 10 webhooks.
- **Expiry and renewal.** Docs mention none.
- **Implication for Mycel.** Push needs an admin to connect, or an admin-installed webhook. That conflicts with non-goal 7 unless an org connection made by a Zendesk admin is acceptable as an "org connection" (ADR-0008).

**Polling.**

- **Incremental exports**: `GET /api/v2/incremental/tickets/cursor`, `/incremental/ticket_events`, `/incremental/users/cursor`, `/incremental/organizations`.
  - Cursor-based, up to 1,000 per page.
  - Data from the last minute is excluded.
  - **Admin only.** 10 req/min (30 with the High Volume add-on); the users cursor allows 20/min.
- **Agent-level alternatives**:
  - Search `type:ticket updated>{ts}`, at the account's general rate limit.
  - A view's ticket list (`/views/{id}/tickets`), e.g. a "Mycel inbox" view.

### 5. Auth

- **Grant.** OAuth 2.0 authorization code (PKCE supported), per subdomain.
- **Scopes.**
  - Broad: `read`, `write`, `impersonate` (admins acting as end users).
  - Resource scopes take the form `resource:read|write`, for `tickets`, `users`, `organizations`, `groups`, `macros`, `triggers`, `automations`, `webhooks`, `apps`, `targets`, `requests`, `satisfaction_ratings`, `dynamic_content`, `custom_objects`, `brands`, `account_settings`, `hc` (Help Center) and others.
  - Least privilege for Mycel: `tickets:read tickets:write users:read organizations:read macros:read hc:read`, plus `hc:write` for article drafts, and `webhooks:write` only for an admin org connection.
- **No sensitivity tiers like Google's.** The real gate is the user's Zendesk role: an agent token can't do admin things.
- **Global OAuth client (required to serve more than one customer).**
  - Since **2025-08-12**: "All apps and integrations built for distribution to multiple Zendesk customers must be submitted to the Zendesk Marketplace for review and approval" and must use a **global OAuth client**.
  - Each API request must also carry the Marketplace identification headers (integration name, organization ID, app ID).
  - Process:
    1. Build against a local OAuth client whose unique identifier starts with `zdg-`. Fill every field, including the optional ones. Use one client per app and a representative name.
    2. Work from a sponsored developer account whose subdomain starts with `d3v-`.
    3. Submit through the Marketplace portal (Global OAuth > Request new OAuth), asking only for the scopes you need.
    4. Zendesk converts the client to global and **pins the allowed scopes**. Asking for others fails with `400 invalid_scope`.
    5. Only Zendesk's Marketplace Operations team can edit the client afterwards; scope changes go through Zendesk Support.
  - The integration also needs a Marketplace "integration app" listing that discloses which data is accessed and why.
  - Customers' internal private apps are exempt. Mycel dogfooding on its own Zendesk could use a local client.
- **Token expiry (recent change).**
  - Global clients had to support the refresh-token flow by **2026-01-31**.
  - Since **2026-02-02**, Zendesk enforces default TTLs on new or inactive global clients: access tokens 30 min (5 min to 48 h), refresh tokens 30 days (7 to 90 days).
  - Local clients follow in waves from 2026-06-30 to **2027-04-01**.
  - Password and basic access to the API is being removed.

### 6. Limits

- **Account-wide, per minute.** Suite Team 200, Growth and Professional 400, Enterprise 700, Enterprise Plus 2,500. The High Volume add-on raises Growth and above to 2,500 and needs at least 10 seats. Legacy Support Essential is 10/min.
- **Per endpoint.**
  - **Update Ticket**: 30 updates per 10 min per user per ticket, and 100 req/min per account. This one bites bulk triage.
  - Incremental export: 10/min.
  - Update User: 5/min per user.
  - Jobs: 30 concurrent.
- A 100,000 req/min account spike guard also applies.

### 7. Nango

- **Providers.** `zendesk` (OAUTH2, connection config `subdomain`) is set up with `expires_in: 1800` on both the token and refresh calls, so it already follows the refresh-token regime. The proxy paginates by link (`next_page`) and retries on `retry-after`. `zendesk-api-key` (basic) also exists, but breaks the "OAuth only" rule.
- **Webhooks.** There is **no `webhook_routing_script`**, so Nango doesn't route Zendesk webhooks. Mycel would receive them directly.
- **Credentials.** Nango's setup guide covers registering our own OAuth app. The client still has to become global through Zendesk's approval.

### 8. Gaps and gotchas

- There is no draft-reply API (§3). Copilot suggested replies have no API and are being retired on 2027-01-19.
- Webhooks, triggers and incremental export are admin-only. An agent-level member connection must poll Search or Views, which adds latency of minutes and burns rate limit.
- Public-comment emails go out through the customer's own triggers, which Mycel doesn't control. Some accounts' trigger setups may email on internal changes too.
- Comments can't be deleted, only redacted (permanently). Merges, spam marking and permanent deletes are irreversible.
- Side conversations need the Collaboration add-on. The Help Center needs a plan that includes Guide.
- Marketplace listing and global-client approval are a gate with no published timeline. The docs give no review SLA.

---

## Help Scout

### 1. Summary

Help Scout is a shared inbox and helpdesk aimed at small teams: email **conversations**, made of **threads** (customer messages, replies, notes, chats, phone), plus customers, organizations, tags, saved replies, workflows and a Docs knowledge base. It claims 12,000+ teams (see 00-ranking).

The workflows it most enables:

1. **Draft replies** to new conversations for a person to approve. This is a native draft: an exact Gmail-draft analogue.
2. **Triage**: tag a conversation, assign it to a user or team, set status, move it between inboxes.
3. **Write internal notes**: summaries, context from other systems, escalation notes.
4. **Follow up** on pending or snoozed conversations with a drafted nudge.
5. **Keep customer and organization records up to date** from email signatures and CRM data.

### 2. Capability table

Inbox API 2.0, base `https://api.helpscout.net/v2`.

| Operation                                                      | API method                                                                                                                                           | Proposed Mycel risk                                                                         | Reaches people outside the user?                       | Notes                                                                                                                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Conversations**                                              |                                                                                                                                                      |                                                                                             |                                                        |                                                                                                                                                         |
| List or get conversations                                      | `GET /conversations` (v3 list since 2026-09-23: typed filters, cursor pagination, `inboxId`/`assignedId`), `GET /conversations/{id}` (also a v3 get) | read                                                                                        | no                                                     |                                                                                                                                                         |
| List threads; get a thread's original source                   | `GET /conversations/{id}/threads` (also v3), `.../threads/{tid}/original-source`                                                                     | read                                                                                        | no                                                     | Thread `state` is one of `draft`, `published`, `hidden`, `review`, `bounced`.                                                                           |
| Change subject, customer, status or assignee; move inbox       | `PATCH /conversations/{id}` (JSON Patch on `/subject`, `/primaryCustomer.id`, `/status`, `/assignTo`, `/mailboxId`)                                  | internal_reversible                                                                         | no                                                     | Closing doesn't email the customer.                                                                                                                     |
| Set tags                                                       | `PUT /conversations/{id}/tags` (replaces the full set)                                                                                               | internal_reversible                                                                         | no                                                     |                                                                                                                                                         |
| Set custom fields                                              | `PUT /conversations/{id}/fields`                                                                                                                     | internal_reversible                                                                         | no                                                     |                                                                                                                                                         |
| Snooze                                                         | snooze endpoints (2024-05-31)                                                                                                                        | internal_reversible                                                                         | no                                                     |                                                                                                                                                         |
| **Delete a conversation**                                      | `DELETE /conversations/{id}`                                                                                                                         | **destructive**                                                                             | no                                                     |                                                                                                                                                         |
| Create a conversation (inbound record or outbound)             | `POST /conversations`                                                                                                                                | internal_reversible if `imported: true` or a draft; external_send if outbound and published | outbound: yes                                          | "To create a draft conversation, use the reply thread type with `draft` set to true."                                                                   |
| **Threads**                                                    |                                                                                                                                                      |                                                                                             |                                                        |                                                                                                                                                         |
| Add a note                                                     | `POST /conversations/{id}/notes`                                                                                                                     | internal_reversible                                                                         | no                                                     | Notes notify teammates, not customers.                                                                                                                  |
| **Reply**                                                      | `POST /conversations/{id}/reply`                                                                                                                     | **external_send**                                                                           | **yes**: emails the customer, with optional `cc`/`bcc` | `draft: true` makes it a pending form (§3).                                                                                                             |
| Add a customer, phone or chat thread                           | `POST .../customer`, `.../phone`, `.../chat`                                                                                                         | internal_reversible                                                                         | no                                                     | Usually logging; `imported: true` suppresses emails.                                                                                                    |
| Edit thread text; hide or unhide                               | `PATCH /conversations/{id}/threads/{tid}` (`/text`, `/hidden`)                                                                                       | internal_reversible                                                                         | no                                                     | Hiding applies only to non-draft customer or reply threads. The original text is kept in history.                                                       |
| Schedule, reschedule or unschedule a draft                     | `PUT`/`DELETE .../threads/{tid}/schedule`                                                                                                            | internal_reversible                                                                         | no, until it fires                                     | Unscheduling "converts it into a standard draft thread".                                                                                                |
| Publish a scheduled draft                                      | `PATCH .../threads/{tid}/schedule` with `{op: replace, path: /state, value: published}`                                                              | **external_send**                                                                           | **yes**                                                | "The message is sent to the customer."                                                                                                                  |
| **Customers and organizations**                                |                                                                                                                                                      |                                                                                             |                                                        |                                                                                                                                                         |
| List or get customers and organizations                        | `GET /customers` (v3 list), `/organizations`                                                                                                         | read                                                                                        | no                                                     | Since **2026-10-15**, _listing_ needs the user permission "Access the contacts and companies directory" (403 otherwise). Single lookups are unaffected. |
| Create or update a customer, org, emails, phones, properties   | `POST`/`PUT`/`PATCH /customers...`, `/organizations`                                                                                                 | internal_reversible                                                                         | no                                                     | Customers with 5,000+ conversations have update restrictions (2025-06-10).                                                                              |
| Delete a customer or org                                       | `DELETE /customers/{id}`, `/organizations/{id}`                                                                                                      | **destructive**                                                                             | no                                                     |                                                                                                                                                         |
| **Workflows**                                                  |                                                                                                                                                      |                                                                                             |                                                        |                                                                                                                                                         |
| List workflows                                                 | `GET /workflows`                                                                                                                                     | read                                                                                        | no                                                     |                                                                                                                                                         |
| Run a manual workflow                                          | `POST /workflows/{id}/run` with `conversationIds` (max 50)                                                                                           | depends on the workflow's actions: treat as external_send                                   | can, if the workflow emails                            | Only manual workflows. Mycel can't see what the workflow does without reading its config.                                                               |
| Activate or deactivate a workflow                              | `PATCH /workflows/{id}`                                                                                                                              | out of scope                                                                                |                                                        | Admin configuration.                                                                                                                                    |
| **Other**                                                      |                                                                                                                                                      |                                                                                             |                                                        |                                                                                                                                                         |
| Inboxes, folders, saved replies, custom fields, routing (read) | `GET /mailboxes...`, saved replies                                                                                                                   | read                                                                                        | no                                                     | Saved replies help ground drafts.                                                                                                                       |
| Users, teams, user status                                      | `GET /users`, `/teams`, status endpoints (2026)                                                                                                      | read (status changes: internal_reversible)                                                  | no                                                     |                                                                                                                                                         |
| Reports, ratings                                               | `GET /reports/...`, ratings                                                                                                                          | read                                                                                        | no                                                     | Reports are unavailable on the Standard plan.                                                                                                           |
| Webhooks                                                       | `GET`/`POST`/`PUT`/`DELETE /webhooks`                                                                                                                | infrastructure                                                                              | no                                                     |                                                                                                                                                         |

Help Scout Docs (the knowledge base) is a **separate API (Docs API) that uses an API key only**. Nango's `helpscout-docs` uses BASIC auth, so it breaks the OAuth-only rule.

### 3. Pending form

**A native draft reply exists.**

- **prepare**: `POST /v2/conversations/{id}/reply` with `{customer: {id}, text, draft: true}`, plus optional `user`, `cc`/`bcc` and `attachments`. The 201 response's `Resource-ID` header gives the thread ID. The draft appears in the conversation for any agent to edit and send.
- **approve**: there is no "publish draft" operation on a reply thread. The documented route is two calls:
  1. `PUT /v2/conversations/{id}/threads/{tid}/schedule` with `{scheduledFor: <now + a few s>, unscheduleOnCustomerReply: true, sendAsCreator: true|false}`.
  2. `PATCH .../threads/{tid}/schedule` with `{op: "replace", path: "/state", value: "published"}`. This turns "the draft thread into a reply/forward thread" and sends it.

  For a brand-new outbound **draft conversation**, `PATCH /v2/conversations/{id}` with `/draft` = "Publish draft" is the documented call. Test both paths in a sandbox: the docs don't say whether publishing a schedule works on a draft that was scheduled seconds earlier, though the schedule docs imply it does.

- **decline**: **no API to delete or discard a draft thread.** There's no Delete Thread endpoint, and `/hidden` applies only to non-draft threads. Options:
  - leave the draft and close the review as declined, with an optional internal note
  - overwrite its text via `PATCH .../threads/{tid}` `/text` (whether that works on drafts is not documented)
  - ask the person to discard it in Help Scout

  This needs a design decision.

- **check**: `GET /v2/conversations/{id}/threads` and find the thread ID.
  - `state: draft` means `waiting`.
  - `state: published` means `done_in_app`, if Mycel didn't publish it. The thread's `scheduled` object shows a pending schedule.
  - Thread missing, conversation deleted, or `301` merged means `gone`.
- **Attribution.** Drafts are attributed to `user`, defaulting to the token owner. `sendAsCreator` decides whose name is on the sent email.

### 4. Triggers

**Push.** Webhooks, created in the UI (Workspace > Apps) or through the Webhooks API:

- **Events.**
  - Conversations: `convo.created`, `convo.customer.reply.created`, `convo.agent.reply.created`, `convo.note.created`, `convo.assigned`, `convo.status`, `convo.tags`, `convo.custom-fields`, `convo.moved`, `convo.merged`, `convo.deleted`, `convo.ai-answers.created`.
  - Customers: `customer.created`, `customer.updated`, `customer.deleted`.
  - Organizations: `organization.created`, `organization.updated`, `organization.deleted`.
  - Tags: `tag.created`, `tag.updated`, `tag.deleted`.
  - Other: `satisfaction.ratings`, Beacon chat events, `message.survey.response.received`, `user.status.changed` (2026-02-06).
- **Signing and payload.** HMAC-SHA1 signature in `X-HelpScout-Signature`. A `mailboxIds` filter exists (2025-07-28).
  - **Payload V3** (2026-05-20) keeps `system_user` types so AI agents can be told apart. V2 is the default but is deprecated.
- **Delivery.** Retried up to 10 times with growing back-off, then discarded. A webhook is **deactivated after 10 or more discarded events**, or when it gets a `410`. Docs don't mention expiry.
- **Who may create webhooks.** The docs don't say which role can create one through the API.
- **Draft events.** Whether `convo.agent.reply.created` fires for drafts or only for published replies is not documented. Assume published only, and keep polling as the backstop for check.

**Polling.** The v3 list conversations endpoint takes typed filters and a cursor, newest first. There's no documented `modifiedSince` delta token; filter by status, folder, or date fields where available.

### 5. Auth

- **Grants.** OAuth 2.0 authorization code for third-party apps; client credentials for internal use. Apps are registered self-serve (Your Profile > My Apps). **No app review or marketplace approval is documented.**
- **No scopes.** The token carries the full permissions of the authorising user. This is simple, but Mycel can't ask for less than "everything this user can do". Mycel's own catalog has to be the least-privilege layer.
- **Tokens.** Access tokens are "valid for 2 days" and are refreshed with the refresh token. Token length may change.
- **Plans.** The Free plan has no API ("The Free plan does not include access to the API or integrations"; help article updated 2025-01-11).

### 6. Limits

- **Per account, across all users.** Standard 200 calls/min, Plus 400, Pro 800 (help article, 2025-01-11). Plan names may have changed since; check before relying on them.
- Write requests (POST, PUT, PATCH, DELETE) **count as 2**. A 429 response comes with `X-RateLimit-Retry-After`.
- Running a workflow takes at most 50 conversations per call.

### 7. Nango

- **`helpscout-mailbox`.** OAUTH2 with refresh, proxy base `https://api.helpscout.net`, and retry on `x-ratelimit-retry-after`. There's **no `webhook_routing_script`**, so Mycel receives Help Scout webhooks itself.
- **`helpscout-docs`.** BASIC (API key), so it breaks the OAuth-only rule.

### 8. Gaps and gotchas

- Publishing a draft takes two calls, and discarding one has no endpoint (§3).
- The lack of OAuth scopes means every connection is all-or-nothing, which a security-minded customer may ask about.
- The Docs knowledge base can only be reached with an API key.
- There's no API on the Free plan, and reports aren't on Standard.
- Since 2026-10-15, listing customers or organizations needs a directory permission, so some member connections will get 403s.
- Running a manual workflow is a black box. Its actions may email customers, so treat it as external_send or leave it out.
- AI features (AI Answers, drafts) show up only as the `convo.ai-answers.created` event. I found no API to invoke Help Scout's own AI drafting.

---

## Shopify

### 1. Summary

Shopify runs a company's online store: products and inventory, orders and fulfilment, customers, discounts, and draft orders (manual or B2B quotes and invoices). Shopify reports "millions of merchants" (see 00-ranking).

The workflows it most enables:

1. **Order exceptions.** When an order is flagged, unpaid, or stuck unfulfilled, tag and note it, alert the team, and draft a customer email (in Gmail).
2. **Quotes and invoices from email.** A customer asks for a quote by email; Mycel builds a **draft order** and a person approves sending the invoice. This is the best fit for the pending form.
3. **Refund and return requests.** Collect the facts and propose a refund or return for approval (`financial`).
4. **Inventory watch.** Low-stock or out-of-stock events trigger a reorder note, task or supplier email draft.
5. **Customer upkeep.** Tag customers, update notes and metafields, and segment for follow-up.

### 2. Capability table

GraphQL Admin API only for new public apps. Latest version **2026-10**. Endpoint `POST https://{shop}.myshopify.com/admin/api/{version}/graphql.json`.

| Operation                                              | API method                                                                                                   | Proposed Mycel risk                                                                | Reaches people outside the user?                                  | Notes                                                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Orders**                                             |                                                                                                              |                                                                                    |                                                                   |                                                                                                                                              |
| Read orders, transactions, fulfillments, refunds       | `orders`, `order` queries                                                                                    | read                                                                               | no                                                                | `read_orders` covers **only the last 60 days**. `read_all_orders` needs Shopify approval. Customer fields need protected-data approval (§5). |
| Tag, note, or set metafields on an order               | `tagsAdd`/`tagsRemove`, `orderUpdate`, `metafieldsSet`                                                       | internal_reversible                                                                | no                                                                |                                                                                                                                              |
| Edit an order (lines, quantities, discounts, shipping) | `orderEditBegin` → `orderEditAddVariant`/... → `orderEditCommit(notifyCustomer, staffNote)`                  | **financial**                                                                      | yes, if `notifyCustomer` is true                                  | Can create a balance due or a refund. Only unfulfilled lines can change.                                                                     |
| Send an order invoice                                  | `orderInvoiceSend(id, email)`                                                                                | **external_send** (also financial: it asks for payment)                            | **yes**                                                           | `from`/`bcc` must be store or staff addresses.                                                                                               |
| Mark as paid                                           | `orderMarkAsPaid`                                                                                            | **financial**                                                                      | no                                                                |                                                                                                                                              |
| Close or reopen                                        | `orderClose`/`orderOpen`                                                                                     | internal_reversible                                                                | no                                                                |                                                                                                                                              |
| **Cancel an order**                                    | `orderCancel(orderId, reason, restock, refundMethod, notifyCustomer, staffNote)`                             | **destructive + financial**                                                        | yes, if notifying                                                 | "Order cancellation is irreversible." Runs async (returns a `Job`). Can refund.                                                              |
| **Create a refund**                                    | `refundCreate`                                                                                               | **financial**                                                                      | yes: money goes back, and the customer may be notified            | Moves money. From **2026-04** the `@idempotent` directive is required.                                                                       |
| Create an order directly                               | `orderCreate`                                                                                                | financial                                                                          | possibly                                                          | Prefer draft orders.                                                                                                                         |
| **Draft orders**                                       |                                                                                                              |                                                                                    |                                                                   |                                                                                                                                              |
| Create, update, duplicate, calculate                   | `draftOrderCreate`, `draftOrderUpdate`, `draftOrderDuplicate`, `draftOrderCalculate`                         | internal_reversible                                                                | **no**: "creating a draft order doesn't send emails to customers" | Scope `write_draft_orders`. Optional `reserveInventoryUntil`.                                                                                |
| Preview the invoice                                    | `draftOrderInvoicePreview`                                                                                   | read                                                                               | no                                                                | Useful on the review screen.                                                                                                                 |
| **Send the draft-order invoice**                       | `draftOrderInvoiceSend(id, email)`                                                                           | **external_send** (it asks for payment, but money moves only if the customer pays) | **yes**: the customer gets an email with a checkout link          | Status becomes `INVOICE_SENT`.                                                                                                               |
| Complete a draft (turn it into an order)               | `draftOrderComplete`                                                                                         | **financial**                                                                      | may notify                                                        | Can mark it paid or set payment terms.                                                                                                       |
| Delete a draft                                         | `draftOrderDelete`                                                                                           | internal_reversible (it was never sent)                                            | no                                                                | Drafts created since 2025-04-01 are **auto-purged after 1 year of inactivity**.                                                              |
| **Customers**                                          |                                                                                                              |                                                                                    |                                                                   |                                                                                                                                              |
| Read customers                                         | `customers`, `customer`                                                                                      | read                                                                               | no                                                                | Name, email, phone and address need **Level 2** protected data.                                                                              |
| Create or update a customer; tags, notes, metafields   | `customerCreate`, `customerUpdate`, `tagsAdd`, `metafieldsSet`                                               | internal_reversible                                                                | no                                                                |                                                                                                                                              |
| Update marketing consent                               | `customerEmailMarketingConsentUpdate` / SMS variant                                                          | internal_reversible (legally sensitive)                                            | no                                                                | Consent changes should be human-only.                                                                                                        |
| Send an account invite                                 | `customerSendAccountInviteEmail`                                                                             | external_send                                                                      | yes                                                               |                                                                                                                                              |
| Delete a customer; request data erasure                | `customerDelete`, `customerRequestDataErasure`                                                               | **destructive**                                                                    | no                                                                |                                                                                                                                              |
| **Products and inventory**                             |                                                                                                              |                                                                                    |                                                                   |                                                                                                                                              |
| Read products, variants, inventory                     | `products`, `productVariants`, `inventoryItems`, `inventoryLevel`; `bulkOperationRunQuery` for large exports | read                                                                               | no                                                                |                                                                                                                                              |
| Create or update a product (as draft status)           | `productCreate`, `productUpdate` (`status: DRAFT`)                                                           | internal_reversible                                                                | no                                                                |                                                                                                                                              |
| Publish or unpublish a product to a sales channel      | `publishablePublish`/`publishableUnpublish`, `productUpdate(status: ACTIVE)`                                 | external_send (public storefront)                                                  | yes                                                               | A `DRAFT` product status is its own pending form.                                                                                            |
| Change price                                           | `productVariantsBulkUpdate`                                                                                  | financial (affects revenue)                                                        | yes (storefront)                                                  |                                                                                                                                              |
| Adjust or set inventory                                | `inventoryAdjustQuantities`, `inventorySetQuantities`                                                        | internal_reversible                                                                | no, but it affects what the storefront sells                      |                                                                                                                                              |
| Delete a product                                       | `productDelete`                                                                                              | **destructive**                                                                    | yes (storefront)                                                  |                                                                                                                                              |
| **Fulfillment and returns**                            |                                                                                                              |                                                                                    |                                                                   |                                                                                                                                              |
| Read fulfillment orders                                | `fulfillmentOrders`                                                                                          | read                                                                               | no                                                                |                                                                                                                                              |
| Fulfil (mark shipped, add tracking)                    | `fulfillmentCreate`, `fulfillmentTrackingInfoUpdate`                                                         | external_send (shipping confirmation email)                                        | yes, if notifying                                                 | Needs the `fulfill_and_ship_orders` permission. Hold/release: `fulfillmentOrderHold`/`ReleaseHold` (internal_reversible).                    |
| Cancel a fulfillment                                   | `fulfillmentCancel`                                                                                          | internal_reversible                                                                | possibly                                                          |                                                                                                                                              |
| Returns                                                | `returnCreate`, `returnRequest`, approve and decline variants; `returnProcess` (2026-10, can issue refunds)  | `returnProcess` is **financial**; approve and decline are external_send            | yes, if `notifyCustomer`                                          |                                                                                                                                              |
| **Discounts, gift cards, store credit**                |                                                                                                              |                                                                                    |                                                                   |                                                                                                                                              |
| Create a discount code                                 | `discountCodeBasicCreate`, `discountCodeFreeShippingCreate`, ...                                             | **financial**                                                                      | not by itself (someone has to share the code)                     | Scope `write_discounts`.                                                                                                                     |
| Deactivate or delete a discount                        | `discountCodeDeactivate`, `discountCodeDelete`                                                               | internal_reversible / destructive                                                  | no                                                                |                                                                                                                                              |
| Issue a gift card or store credit                      | `giftCardCreate`, `storeCreditAccountCredit`                                                                 | **financial**                                                                      | may notify                                                        |                                                                                                                                              |
| **Metafields and metaobjects**                         | `metafieldsSet`, `metafieldsDelete`, `metaobjectUpsert`                                                      | internal_reversible (delete: destructive)                                          | no                                                                | Handy for storing Mycel's derived pointers on Shopify objects.                                                                               |
| **Payments**                                           | Disputes (`read_shopify_payments_disputes`), payouts                                                         | read                                                                               | no                                                                | Evidence scopes need approval.                                                                                                               |

There is **no customer-messaging API** (Shopify Inbox chat). Customer emails go through the merchant's own email (Gmail drafts).

### 3. Pending form

**Draft orders: an excellent native pending form.**

- **prepare**: `draftOrderCreate` (silent: no customer email) with line items, `customerId` or `email`, discount, note, tags, and optionally `reserveInventoryUntil`. Store the draft-order GID as `source_ref`.
- **approve**: `draftOrderInvoiceSend(id, email: {subject, customMessage})` emails a secure checkout link. Status becomes `INVOICE_SENT`. Completing as paid (`draftOrderComplete`) is a separate **financial** step: keep it out of v1, or catalog it separately.
- **decline**: `draftOrderDelete`, or leave it with a `declined` tag.
- **check**: query the `draftOrder(id)` `status` and `invoiceSentAt`.
  - `OPEN` and not sent by Mycel means `waiting`.
  - `INVOICE_SENT` or `COMPLETED` that Mycel didn't trigger means `done_in_app`.
  - Not found means `gone` (deleted, or purged after a year).

  Webhooks `draft_orders/update` and `draft_orders/delete` can make check event-driven.

**Other natural holders:**

- product `status: DRAFT`, approved by setting `ACTIVE` and publishing
- `fulfillmentOrderHold`, approved by releasing the hold and fulfilling

**No native pending form** for refunds, cancellations, order edits, discount creation, or `orderInvoiceSend`. Those are `financial` (a v1 non-goal), so leave them out or build a Mycel review that holds only parameters, not content. Customer-facing emails about orders should be **Gmail drafts**.

### 4. Triggers

**Push.** Webhooks, subscribed per app in `shopify.app.toml` or per shop through `webhookSubscriptionCreate`. Delivery goes to HTTPS, **Google Pub/Sub**, or **Amazon EventBridge**.

- **Topics:**
  - orders: `ORDERS_CREATE`, `ORDERS_UPDATED`, `ORDERS_PAID`, `ORDERS_FULFILLED`, `ORDERS_CANCELLED`, `ORDER_TRANSACTIONS_CREATE`, `REFUNDS_CREATE`
  - draft orders: `DRAFT_ORDERS_CREATE`, `DRAFT_ORDERS_UPDATE`, `DRAFT_ORDERS_DELETE`
  - customers: `CUSTOMERS_CREATE`, `CUSTOMERS_UPDATE`, `CUSTOMERS_DELETE`, tags and consent topics
  - products and inventory: `PRODUCTS_CREATE`, `PRODUCTS_UPDATE`, `PRODUCTS_DELETE`, `INVENTORY_LEVELS_UPDATE`, `VARIANTS_OUT_OF_STOCK`
  - fulfilment and returns: `FULFILLMENTS_CREATE`, `FULFILLMENTS_UPDATE`, `RETURNS_REQUEST`, `RETURNS_APPROVE`, `RETURNS_PROCESS`
  - app: `APP_UNINSTALLED`
- **Mandatory compliance webhooks**: `customers/data_request`, `customers/redact`, `shop/redact`. Combined with the 30-day deletion rule, these line up with invariant 3.
- **Delivery.**
  - Filters (`filter`, `include_fields`) can narrow deliveries.
  - HMAC is in `X-Shopify-Hmac-Sha256`; `X-Shopify-Webhook-Id` is for de-duplication.
  - There's no ordering guarantee; use `X-Shopify-Triggered-At` or `updated_at` to order events.
  - Shopify waits **5 s** for a response, then retries **8 times over 4 hours**. Subscriptions created through the Admin API are **deleted after 8 consecutive failures**.
  - "Webhook delivery isn't always guaranteed": Shopify recommends reconciliation jobs.
  - Subscriptions don't expire.

**Polling.** Query with `query: "updated_at:>'{ts}'"` on orders, customers or products. Use `bulkOperationRunQuery` for large backfills (no cost limit).

### 5. Auth

- **Grants.** OAuth authorization code per shop (`https://{shop}.myshopify.com/admin/oauth/authorize`), or token exchange for embedded apps.
- **Expiring tokens (recent change).**
  - **New public apps since 2026-04-01** must use **expiring offline tokens**: access 1 h, refresh 90 days.
  - All public apps must by **2027-01-01**.
- **Scopes Mycel would need**, each split into `read_`/`write_` (Shopify docs: "Only use this data if it's required"):
  - `orders` (60-day window; `read_all_orders` needs approval)
  - `draft_orders`
  - `customers`
  - `products`
  - `inventory`
  - `merchant_managed_fulfillment_orders`
  - `returns`
  - `discounts`
  - `metaobjects`
  - `order_edits`
- **Protected customer data.**
  - **Level 1**: any customer data other than the four fields below. Requires data minimisation, transparency, purpose limits, consent, retention and encryption.
  - **Level 2**: name, email, phone, address. Adds encrypted backups, separate test and production environments, DLP, restricted staff access, strong passwords, access logs and an incident-response policy.
  - **Public apps need review for both levels**, requested in the Partner Dashboard. **Custom-distribution apps have both levels "always available"** with no review. Development stores need no review.
- **Distribution.**
  - **Public** (App Store, full or limited visibility): Shopify review; must use **Shopify Billing** to charge merchants; OAuth immediately on install; session tokens; embedded App Bridge expected; **GraphQL only** for apps submitted since **2025-04-01**.
  - **Custom distribution**: one store, or the stores of one Plus organization. No review, no Shopify Billing.
  - **Admin-created custom apps can no longer be created (since 2026-01-01)**. Merchants now create apps in the Dev Dashboard, which uses the client-credentials grant (Nango `shopify-cc`).
- **AI clause.** API terms (updated **2026-10-07**, §2.3.24) forbid using API, merchant or derived data to "create, develop, train, fine tune, or improve" AI or ML models, including LLMs. A 2026-02-27 PPA update made this explicit, with an exception if the merchant (for its own data) or Shopify consents.
  - Inference-only use is outside the clause's wording. Mycel must make sure its model providers don't train on the data.
  - §6.2.3: delete merchant data within 30 days of uninstall. §6.2.8: no transfer to third parties except as needed to run the service.

### 6. Limits

- **GraphQL Admin cost points per second.** Standard 100, Advanced 200, Plus 1,000, Enterprise (Commerce Components) 2,000. Uses a leaky bucket per app and store. **A single query may cost at most 1,000.**
- Input arrays are capped at 250 items. Pagination is capped at 25,000 objects. There are variant-creation throttles on very large catalogs.
- Bulk operations skip cost limits.
- `read_orders` alone sees only 60 days of orders.

### 7. Nango

- **`shopify`.** OAUTH2 with `subdomain` config and `token_params.expiring: 1`, so it is ready for expiring tokens. It **has a `webhook_routing_script: shopifyWebhookRouting`**, so Nango can receive and forward Shopify webhooks.
- **Others.**
  - `shopify-cc`: client credentials, for Dev Dashboard merchant apps.
  - `shopify-api-key`: an admin token pasted by the merchant, with webhook routing. Breaks the OAuth-only rule.
  - `shopify-partner` and `shopify-scim`: not relevant here.

### 8. Gaps and gotchas

- **Up-front compliance cost before the first public customer:** App Store review, Level 2 protected-data review, the Shopify Billing requirement, embedded-app expectations and GraphQL only.
  - **Billing conflicts with Mycel's own credits model.** It needs a decision: custom distribution per merchant, or Shopify Billing plans.
  - The cheap path for early customers is a **custom-distribution app per merchant**: no review, protected data always available. It doesn't scale past a handful of stores.
- Most valuable write actions are `financial`: refunds, cancellations, order edits, discounts, completing a draft. Shopify-side v1 value is mostly reads, tags and notes, plus draft orders.
- Without `read_all_orders` there is no order history beyond 60 days.
- There is no API to message customers. The customer conversation lives in Gmail, so pair Shopify reads with Gmail drafts.
- Webhooks aren't guaranteed, and subscriptions created through the API are deleted after failures. A reconciliation poll is required.
- The AI-training clause applies. Inference is fine, but Mycel's model providers must not train on the data, and data must be deleted within 30 days of uninstall.
- Inactive draft orders auto-purge after a year, which a check must treat as `gone`.

---

## Sources

Zendesk:

- Set up a global OAuth client: https://developer.zendesk.com/documentation/marketplace/building-a-marketplace-app/set-up-a-global-oauth-client/
- Developer update, enhanced security guidelines for third-party apps (2025-08-12): https://support.zendesk.com/hc/en-us/articles/9590471542170-Developer-update-Enhanced-security-guidelines-for-third-party-apps-integrations-and-bots
- Required expiration of global OAuth tokens (2026-02-02): https://support.zendesk.com/hc/en-us/articles/10212201463962-Announcing-the-required-expiration-of-global-OAuth-access-and-refresh-tokens
- Refresh token support: https://support.zendesk.com/hc/en-us/articles/9182123625370-Announcing-support-for-OAuth-refresh-token-grant-type-and-OAuth-access-and-refresh-token-expirations
- OAuth tokens for grant types (scopes, TTL parameters): https://developer.zendesk.com/api-reference/ticketing/oauth/grant_type_tokens/
- OAuth tokens: https://developer.zendesk.com/api-reference/ticketing/oauth/oauth_tokens/
- Marketplace overview: https://developer.zendesk.com/documentation/marketplace/
- Rate limits: https://developer.zendesk.com/api-reference/introduction/rate-limits/
- Tickets API: https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/
- Ticket comments: https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_comments/
- Macros: https://developer.zendesk.com/api-reference/ticketing/business-rules/macros/
- Triggers: https://developer.zendesk.com/api-reference/ticketing/business-rules/triggers/
- Side conversations: https://developer.zendesk.com/api-reference/ticketing/side_conversation/side_conversation/
- Incremental exports: https://developer.zendesk.com/api-reference/ticketing/ticket-management/incremental_exports/
- Webhooks API: https://developer.zendesk.com/api-reference/webhooks/webhooks-api/webhooks/
- Webhook event types: https://developer.zendesk.com/api-reference/webhooks/event-types/webhook-event-types/
- Ticket events: https://developer.zendesk.com/api-reference/webhooks/event-types/ticket-events/
- Creating and monitoring webhooks (retries, circuit breaker): https://developer.zendesk.com/documentation/webhooks/creating-and-monitoring-webhooks/
- Ticket sidebar client API (`comment.appendText` and related): https://developer.zendesk.com/api-reference/apps/apps-support-api/ticket_sidebar/
- Writing drafts of public replies (composer draft mode): https://support.zendesk.com/hc/en-us/articles/5627101293722-Writing-drafts-of-public-replies-in-tickets
- Turning on suggested first replies (discontinued 2027-01-19): https://support.zendesk.com/hc/en-us/articles/8037936748570-Turning-on-suggested-first-replies
- Using AI to generate a first reply: https://support.zendesk.com/hc/en-us/articles/7041677653914-Using-AI-to-generate-a-first-reply-in-a-ticket

Help Scout:

- Inbox API 2.0 overview: https://developer.helpscout.com/mailbox-api/
- Create reply thread (`draft`): https://developer.helpscout.com/mailbox-api/endpoints/conversations/threads/reply/
- Update thread: https://developer.helpscout.com/mailbox-api/endpoints/conversations/threads/update/
- Update, publish and delete thread schedule: https://developer.helpscout.com/mailbox-api/endpoints/conversations/threads/schedule/update/ · https://developer.helpscout.com/mailbox-api/endpoints/conversations/threads/schedule/publish/ · https://developer.helpscout.com/mailbox-api/endpoints/conversations/threads/schedule/delete/
- Update conversation (`/draft` publish): https://developer.helpscout.com/mailbox-api/endpoints/conversations/update/
- Create conversation: https://developer.helpscout.com/mailbox-api/endpoints/conversations/create/
- List threads (`state`): https://developer.helpscout.com/mailbox-api/endpoints/conversations/threads/list/
- Create note: https://developer.helpscout.com/mailbox-api/endpoints/conversations/threads/note/
- Run manual workflow: https://developer.helpscout.com/mailbox-api/endpoints/workflows/run/
- Changelog (2024 to 2026-10-15): https://developer.helpscout.com/mailbox-api/changelog/
- Authentication: https://developer.helpscout.com/mailbox-api/overview/authentication/
- Rate limiting: https://developer.helpscout.com/mailbox-api/overview/rate-limiting/
- Plan API access and limits (updated 2025-01-11): https://docs.helpscout.com/article/1140-mailbox-api
- Webhooks: https://developer.helpscout.com/webhooks/

Shopify:

- GraphQL requirement for new public apps (2025-04-01): https://shopify.dev/changelog/starting-april-2025-new-public-apps-submitted-to-shopify-app-store-must-use-graphql
- Expiring offline tokens (new public apps from 2026-04-01; all public apps by 2027-01-01): https://shopify.dev/changelog/posts/expiring-offline-access-tokens-required-for-public-apps-april-1-2026 · https://shopify.dev/changelog/posts/expiring-offline-access-tokens-required-for-all-public-apps-as-of-january-1-2027
- Access tokens: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens
- Protected customer data: https://shopify.dev/docs/apps/launch/protected-customer-data
- Distribution: https://shopify.dev/docs/apps/launch/distribution
- Legacy custom apps ending 2026-01-01 (Shopify staff announcement): https://community.shopify.dev/t/starting-january-1-2026-you-will-not-be-able-to-create-new-legacy-custom-apps-this-will-not-impact-any-existing-apps/26798
- App Store requirements checklist: https://shopify.dev/docs/apps/launch/app-requirements-checklist
- Access scopes: https://shopify.dev/docs/api/usage/access-scopes
- GraphQL Admin rate limits: https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits
- API limits: https://shopify.dev/docs/api/usage/limits
- DraftOrder object: https://shopify.dev/docs/api/admin-graphql/latest/objects/DraftOrder
- draftOrderCreate: https://shopify.dev/docs/api/admin-graphql/latest/mutations/draftOrderCreate
- draftOrderInvoiceSend: https://shopify.dev/docs/api/admin-graphql/latest/mutations/draftOrderInvoiceSend
- draftOrderComplete: https://shopify.dev/docs/api/admin-graphql/latest/mutations/draftOrderComplete
- refundCreate: https://shopify.dev/docs/api/admin-graphql/latest/mutations/refundCreate
- orderCancel: https://shopify.dev/docs/api/admin-graphql/latest/mutations/orderCancel
- orderEditCommit: https://shopify.dev/docs/api/admin-graphql/latest/mutations/orderEditCommit
- orderInvoiceSend: https://shopify.dev/docs/api/admin-graphql/latest/mutations/orderInvoiceSend
- fulfillmentCreate: https://shopify.dev/docs/api/admin-graphql/latest/mutations/fulfillmentCreate
- returnProcess: https://shopify.dev/docs/api/admin-graphql/latest/mutations/returnProcess
- Webhook topics: https://shopify.dev/docs/api/admin-graphql/latest/enums/WebhookSubscriptionTopic
- Webhooks overview: https://shopify.dev/docs/apps/build/webhooks
- Troubleshooting webhooks (retries, removal): https://shopify.dev/docs/apps/build/webhooks/troubleshooting-webhooks
- API License and Terms of Use (updated 2026-10-07): https://www.shopify.com/legal/api-terms

Nango:

- providers.yaml (`zendesk`, `zendesk-api-key`, `helpscout-mailbox`, `helpscout-docs`, `shopify`, `shopify-cc`, `shopify-api-key`; fetched 2026-10-21): https://github.com/NangoHQ/nango/blob/master/packages/providers/providers.yaml

Not individually fetched, and given from the API reference families above: the Zendesk Help Center article endpoints (the `hc:read`/`hc:write` scopes are confirmed in the grant-type tokens reference); the Zendesk users and organizations merge and delete endpoints; and the Shopify mutation names in the capability table beyond those linked (`productCreate`, `tagsAdd`, `metafieldsSet`, `discountCodeBasicCreate`, `giftCardCreate`, `storeCreditAccountCredit`, `fulfillmentOrderHold`, `customerDelete`). Verify these against https://developer.zendesk.com/api-reference/ and https://shopify.dev/docs/api/admin-graphql/latest before building.
