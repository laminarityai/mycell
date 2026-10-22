# Rest of Google Workspace reachable by a per-user OAuth connection

Scope of this part: Google Chat, Google Meet (REST API), Google Keep, Google Groups, Google Sites, Apps Script API, Workspace Events API, and Gemini / Workspace AI surfaces. Researched 2026-10-21 against Google's developer docs (most pages last updated Sept–Oct 2026).

Context from the repo: today's Google connection asks for `gmail.modify`, `drive.readonly`, `spreadsheets`, `calendar.events`, `documents`, `tasks` (`app/src/features/connections/types.ts`). `gmail.modify` and `drive.readonly` are already **restricted** scopes, so Mycel is already on Google's restricted-scope verification path. Adding new restricted scopes still means re-verifying.

## Verdict: what's usable under Mycel's rules

| App                                            | Usable with a normal user OAuth consent?                                                                                                                                                                                                                                                  | What else it needs                                                                                                                                                                                                                                         | Verdict for Mycel                                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Google Chat API** (user auth)                | Yes, for **Business or Enterprise Workspace accounts** (prerequisite in the user-auth guide). Read-only calls need only the API on plus an OAuth client. Create, update and delete calls also need the Chat API "configuration" (app name, avatar, description) in Mycel's Cloud project. | Restricted scopes to read messages. Messages sent as the user are **text only** (GA).                                                                                                                                                                      | **Usable** for reading and for posting as the user.                                                                                          |
| **Google Chat app** (app auth, cards, buttons) | Not by OAuth alone. It's a Chat app registration on Mycel's side, plus installation in the customer's Workspace.                                                                                                                                                                          | Other organizations can install it only through a **public Workspace Marketplace listing** (with Marketplace review). Their admin must allow users to install Chat apps, or install it for them. The `chat.app.*` scopes need one-time **admin approval**. | **Usable but heavy.** It's the only way to send an interactive approve card in Chat. Check whether it fits non-goal 3 ("nothing installed"). |
| **Google Meet REST API**                       | Yes. Sensitive scopes `meetings.space.readonly` / `meetings.space.created`.                                                                                                                                                                                                               | Recordings and transcripts exist only on **Business Standard and higher** (not Business Starter).                                                                                                                                                          | **Usable.** Good fit for "after the meeting, draft the follow-up".                                                                           |
| **Workspace Events API**                       | Yes, with user auth for Chat (space, all-spaces and user targets), Meet (space and user targets) and Drive.                                                                                                                                                                               | A **Pub/Sub topic in Mycel's GCP project**. Subscriptions expire.                                                                                                                                                                                          | **Usable.** It's the push trigger for Chat and Meet.                                                                                         |
| **Google Keep API**                            | **No.** Docs offer only domain-wide delegation (service account) or an OAuth client whose scopes "the Administrator approves".                                                                                                                                                            | Admin, which is ruled out by non-goal 7                                                                                                                                                                                                                    | **Not usable.**                                                                                                                              |
| **Google Groups**                              | Partly. The Cloud Identity Groups API has a "non-admin authorization" mode: anyone can read groups and memberships, and owners and managers can manage members.                                                                                                                           | No API to read group conversations. Posting is just email to the group address. Groups Settings API is for owners only.                                                                                                                                    | **Marginal.** Membership changes only. Posting goes through Gmail.                                                                           |
| **Google Sites**                               | **No API** for current Sites. The classic Sites API is deprecated and can't reach Sites rebuilt since 2016.                                                                                                                                                                               | n/a                                                                                                                                                                                                                                                        | **Not usable.** A Site shows up only as a Drive file (`application/vnd.google-apps.site`).                                                   |
| **Apps Script API**                            | Technically yes, but `scripts.run` only runs scripts that **share Mycel's Cloud project**. Each user must also switch on "Google Apps Script API" in their own settings.                                                                                                                  | It also clashes with invariant 5 (specs, not code).                                                                                                                                                                                                        | **Not usable** for running customers' scripts or generated scripts.                                                                          |
| **Gemini / Workspace AI**                      | Meet **smart notes** (Gemini "Take notes for me") can be read through the Meet API (GA since Apr 2026). The Workspace MCP servers use user OAuth but are in **Developer Preview**. Workspace Studio offers **no API for outside apps to create flows**.                                   | Smart notes need an eligible Gemini edition or plan.                                                                                                                                                                                                       | **Smart notes: usable as a source.** MCP: keep an eye on it, don't build on it.                                                              |

---

## Google Chat

### 1. Summary

Chat is a small company's internal chat: DMs, group chats and named spaces. Workflows it enables:

1. **Post a status or summary to a team space** (daily digest, "new order from X" alert). The message is sent as the user, text only.
2. **Notify or approve in Chat:** Mycel's Chat app sends a member a private card ("draft reply ready: Approve / Open in Mycel").
3. **Mine Chat for repetitive work** (discovery). It works like Gmail: `spaces.messages.search` across all spaces (`spaces/-`) and `messages.list`.
4. **React to messages:** triggers on new messages in a space or in all of a user's spaces, for example "when someone asks for X in #ops, draft the answer."
5. **Turn a Chat request into a task or doc:** the trigger is a message, and the action lives in another app.

### 2. Capability table

Auth: **U** = user OAuth (per-user Nango connection), **A** = app auth (Mycel's Chat app or service account).

| Resource    | Operation                                         | API method                                                                              | Auth                                                                                                             | Proposed risk                                                    | Reaches others?            | Notes                                                                                                                              |
| ----------- | ------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Spaces      | List the user's spaces                            | `spaces.list`                                                                           | U/A                                                                                                              | read                                                             | No                         |                                                                                                                                    |
| Spaces      | Search spaces                                     | `spaces.search`                                                                         | U                                                                                                                | read                                                             | No                         | GA Aug 4 2026                                                                                                                      |
| Spaces      | Get a space                                       | `spaces.get`                                                                            | U/A                                                                                                              | read                                                             | No                         |                                                                                                                                    |
| Spaces      | Find the DM with a person                         | `spaces.findDirectMessage`                                                              | U/A                                                                                                              | read                                                             | No                         |                                                                                                                                    |
| Spaces      | Find group chats                                  | `spaces.findGroupChats`                                                                 | U                                                                                                                | read                                                             | No                         | GA Apr 2026                                                                                                                        |
| Spaces      | Create a space with members                       | `spaces.setup` / `spaces.create`                                                        | U (A needs admin approval)                                                                                       | **external_send**                                                | Yes (members are notified) | A space with only the user is internal_reversible                                                                                  |
| Spaces      | Set up a DM between the user and Mycel's Chat app | `spaces.setup` with `singleUserBotDm: true`                                             | U (`chat.spaces.create`)                                                                                         | internal_reversible                                              | No                         | Opens the channel for approval cards (see the pending form)                                                                        |
| Spaces      | Update space name or description                  | `spaces.patch`                                                                          | U                                                                                                                | internal_reversible                                              | Yes (visible)              |                                                                                                                                    |
| Spaces      | **Delete a space**                                | `spaces.delete`                                                                         | U (`chat.delete`, restricted)                                                                                    | **destructive**                                                  | Yes                        |                                                                                                                                    |
| Members     | List members                                      | `spaces.members.list`                                                                   | U/A                                                                                                              | read                                                             | No                         |                                                                                                                                    |
| Members     | Add a person                                      | `spaces.members.create`                                                                 | U                                                                                                                | **external_send**                                                | Yes                        |                                                                                                                                    |
| Members     | Add Mycel's Chat app to a space                   | `spaces.members.create` with `users/app`                                                | U (`chat.memberships.app`)                                                                                       | internal_reversible                                              | Visible                    | Works in DMs between two humans too                                                                                                |
| Members     | **Remove a member**                               | `spaces.members.delete`                                                                 | U                                                                                                                | **destructive**                                                  | Yes                        |                                                                                                                                    |
| Messages    | List messages                                     | `spaces.messages.list` (filter `createTime`, `thread.name`; page size up to 1000)       | U (`chat.messages.readonly`, restricted); A (`chat.app.messages.readonly`, admin approval, public messages only) | read                                                             | No                         | Caller must be a member of the space                                                                                               |
| Messages    | Search messages                                   | `spaces.messages.search` (`parent=spaces/-` searches all spaces)                        | U                                                                                                                | read                                                             | No                         | GA Jul 30 2026. Leaves out private messages, messages posted by apps and muted spaces. Query up to 1,000 chars, up to 100 per page |
| Messages    | Get a message                                     | `spaces.messages.get`                                                                   | U/A                                                                                                              | read                                                             | No                         |                                                                                                                                    |
| Messages    | **Post as the user**                              | `spaces.messages.create`                                                                | U (`chat.messages.create`, sensitive)                                                                            | **external_send**                                                | Yes                        | **Text only** in GA. Cards with user auth are in Developer Preview (Mar 2026). `requestId` makes it idempotent                     |
| Messages    | Post as Mycel's app (cards, buttons)              | `spaces.messages.create`                                                                | A (`chat.bot`)                                                                                                   | **external_send** (internal_reversible if private to the member) | Yes, unless private        | The app must be a member of the space                                                                                              |
| Messages    | Private message to one person                     | `spaces.messages.create` with `privateMessageViewer`                                    | **A only**                                                                                                       | internal_reversible                                              | Only to that person        | No attachments allowed                                                                                                             |
| Messages    | Edit a message                                    | `spaces.messages.patch` / `update`                                                      | U/A                                                                                                              | **external_send**                                                | Yes                        |                                                                                                                                    |
| Messages    | **Delete a message**                              | `spaces.messages.delete` (`force` also deletes the thread's replies)                    | U: any message the user is allowed to delete; A: only the app's own                                              | **destructive**                                                  | Yes                        | Exception: deleting Mycel's own pending private card is the decline step                                                           |
| Reactions   | Add or remove a reaction                          | `spaces.messages.reactions.create` / `delete`                                           | U                                                                                                                | internal_reversible                                              | Visible                    | Arguably external_send. The catalog decides                                                                                        |
| Pins        | Pin or unpin a message                            | `spaces.messagePins.*`                                                                  | U                                                                                                                | internal_reversible                                              | Visible                    | GA Sep 2026                                                                                                                        |
| Attachments | Download or upload                                | `media.download` / `media.upload`, `attachments.get`                                    | U/A                                                                                                              | read / external_send                                             |                            |                                                                                                                                    |
| Events      | Space event history                               | `spaces.spaceEvents.list` / `get`                                                       | U/A                                                                                                              | read                                                             | No                         | Polling fallback for triggers                                                                                                      |
| Users       | Read state                                        | `users.spaces.getSpaceReadState` / `updateSpaceReadState`, `threads.getThreadReadState` | U                                                                                                                | internal_reversible                                              | No                         |                                                                                                                                    |
| Users       | Set availability (active, away, DND)              | `users.availability.*`                                                                  | U                                                                                                                | internal_reversible                                              | Visible                    | GA Jul 2026                                                                                                                        |
| Users       | Sidebar sections                                  | `users.sections.*`                                                                      | U                                                                                                                | internal_reversible                                              | No                         |                                                                                                                                    |
| Import      | Import a history                                  | `spaces.completeImport`, `chat.import`                                                  | U                                                                                                                | n/a                                                              |                            | Migration tool only. Not a workflow action                                                                                         |

### 3. Pending form

**There's no native pending, draft or scheduled-send state in the Chat API.** The Message resource has only create, update and delete times. The Chat UI keeps unsent drafts on the device, but they aren't exposed.

Possible designs, from simplest to most native:

- **A. The private card is the pending form** (fits ADR-0013 best, needs the Chat app):
  - prepare = Mycel's Chat app posts a `privateMessageViewer` message in the **target space**, visible only to the member. It shows the proposed text with **Approve / Edit / Decline** buttons. The draft content lives in Chat, not in Mycel (invariant 8).
  - approve = the button click reaches Mycel's interaction endpoint. Mycel posts the text **as the user** with `spaces.messages.create` (user auth), or as the app, then deletes the private card.
  - decline = `spaces.messages.delete` on the card (an app can delete its own messages).
  - check = `spaces.messages.get` on the card. Present means `waiting`, 404 means `gone`. `done_in_app` can't be detected, unless a search for a matching user message within the window counts as a heuristic.
  - Needs: the app must be a **member of the target space**, added with user auth and `chat.memberships.app`. That's visible to the space.
- **B. The DM with Mycel's app is the review inbox:** `spaces.setup(singleUserBotDm)` with user auth opens a 1:1 DM between the member and Mycel's app. Every review, from any app, can be posted there as a card linking to the Mycel Reviews page. Approving a Chat post then sends it as the user to the target space. This is a notification channel more than a Chat-native pending form. The card holds the text, so content still lives in Chat, not Mycel.
- **C. No Chat app:** with user auth only, there's no place to hold a draft. The proposed text would have to live in Mycel's database, which breaks invariant 8 and ADR-0013. **So posting to Chat without a Chat app is "none: needs a design".**

Interaction events (button clicks) arrive at an HTTP endpoint, Pub/Sub, Apps Script, or a Workspace add-on deployment. Requests are verified with a bearer token, and a synchronous response must come within 30 s (https://developers.google.com/workspace/chat/receive-respond-interactions). Under the repo rule that route handlers serve only webhooks, this counts as a webhook route.

### 4. Triggers

- **Push: Workspace Events API.** Events are delivered to Pub/Sub as CloudEvents.
  - Space target `//chat.googleapis.com/spaces/SPACE`: `google.workspace.chat.message.v1.created|updated|deleted`, `reaction.v1.created|deleted`, `membership.v1.created|updated|deleted`, `space.v1.updated|deleted`, plus batch variants.
  - **All of the user's spaces**: `//chat.googleapis.com/spaces/-` (user auth only, GA). This is one subscription per member covering every space they're in. Note that membership events for new DMs fire only after the first message.
  - User target `//cloudidentity.googleapis.com/users/USER`: membership and read-state events (read state GA Jul 2026).
  - Customer target: Developer Preview, app auth with admin approval. Ruled out by non-goal 7.
  - Lifetime: **up to 4 h with resource data, or 7 days with resource names only.** Renew by patching the TTL. Mycel needs a renewal job and a re-fetch with `messages.get`.
- **Polling:** `spaces.messages.list` with a `createTime > T` filter per space, or `spaces.messages.search` across `spaces/-` with `createTime`, or `spaces.spaceEvents.list`. There's no history token like Gmail's `historyId`.

### 5. Auth

| Scope                                                                   | Class              | Used for                                                 |
| ----------------------------------------------------------------------- | ------------------ | -------------------------------------------------------- |
| `chat.bot`                                                              | Non-sensitive      | App-auth messaging (Chat app only)                       |
| `chat.spaces.readonly`, `chat.spaces`, `chat.spaces.create`             | Sensitive          | Spaces                                                   |
| `chat.memberships`, `chat.memberships.readonly`, `chat.memberships.app` | Sensitive          | Members. `.app` adds Mycel's app                         |
| `chat.messages.create`                                                  | Sensitive          | Post as the user                                         |
| `chat.messages.readonly`, `chat.messages`                               | **Restricted**     | Read or search messages; full message CRUD               |
| `chat.delete`, `chat.import`                                            | **Restricted**     | Delete spaces, import                                    |
| `chat.app.*` (spaces, memberships, delete, messages.readonly)           | **Admin approval** | App acting without a user. Ruled out (non-goal 7 spirit) |

Verification: posting only (`chat.messages.create`) is sensitive, which means a brand verification-style review. Discovery over Chat messages adds a **restricted** scope, so the CASA security assessment must cover it. Chat API user auth needs **Business or Enterprise Workspace accounts**; consumer `@gmail.com` accounts aren't covered.

Chat app distribution: within Mycel's own domain (dogfood), the Chat API configuration can be made visible to up to 5 people or to Google Groups. For other organizations, a **public Marketplace listing with review** is needed, and the public/private choice can't be changed later. The customer admin must also turn on "Allow users to install Chat apps" or install the app for users.

### 6. Limits

From https://developers.google.com/workspace/chat/limits:

- Per project: 3,000 message writes per minute, 3,000 message reads per minute, 60 space writes per minute, 300 membership writes per minute.
- **Per space: 1 write per second, 15 reads per second.**
- **Per user: 1 write per second, 15 reads per second.**
- Going over returns 429. Back off exponentially.

Workspace Events API (https://developers.google.com/workspace/events/guides/limits): 600 subscription writes per minute per project and **100 per minute per user**. Renewal storms are cheap.

### 7. Nango

`google-chat` exists in Nango's providers.yaml (`alias: google`, proxy base `https://chat.googleapis.com`). It's an alias of the generic Google OAuth provider, so the single Google connection from ADR-0014 can just add Chat scopes and proxy to `chat.googleapis.com`. There are no pre-built syncs worth relying on. Workspace Events goes to **Mycel's own Pub/Sub**, not through Nango, and Chat app interaction events come straight to Mycel. Nango is involved only for the user token used to create subscriptions and to post as the user. App auth uses Mycel's own service account, outside Nango.

### 8. Gaps and gotchas

- No drafts and no scheduled send in the API.
- User-authored messages are text only. Interactive cards need the Chat app.
- Private messages and cards need **app auth**, and the app must be in the space.
- Read scopes are restricted.
- Chat MCP server (Developer Preview): from Nov 11 2026, OAuth clients calling it must be marked "agentic". It's read-heavy; its tools include `search_messages` and `send_message` (May 2026 preview).
- Since Jan 2026, a Chat app can be built as a Workspace add-on. That doesn't change distribution: it's still a Marketplace install.
- The Chat app question is a product decision. The only approval UX that lives in Chat needs something "installed" in the customer's Workspace. Non-goal 3 names browser extensions, desktop apps and Gmail add-ons. A Chat app isn't listed, but it's in the same spirit.

---

## Google Meet (REST API v2)

### 1. Summary

Meetings via Calendar-linked Meet links. Workflows:

1. **After a meeting, draft the follow-up email.** Trigger on transcript or smart notes ready. Read the transcript entries or Gemini notes plus the participants, then prepare a Gmail draft (existing pending form) to the attendees.
2. **Extract action items into Tasks or Sheets** from the transcript.
3. **Log attendance or meeting time** to a Sheet (participants, participant sessions).
4. **Create a Meet link for a new event.** Usually done better through Calendar `conferenceData`, which Mycel already has.
5. **Pre-configure a meeting** to auto-transcribe or auto-take-notes (`spaces.patch` `artifactConfig`).

### 2. Capability table

| Resource           | Operation                                                                                | API method                                                                                             | Proposed risk       | Reaches others?                           | Notes                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| Spaces             | Create a meeting space (link)                                                            | `spaces.create`                                                                                        | internal_reversible | No (nobody is notified)                   | `meetings.space.created`                                                                  |
| Spaces             | Get a space                                                                              | `spaces.get`                                                                                           | read                | No                                        |                                                                                           |
| Spaces             | Update config: access type, moderation, **auto recording / transcription / smart notes** | `spaces.patch`                                                                                         | internal_reversible | Affects attendees                         | Turning recording or transcription on has privacy weight. Consider requiring review       |
| Spaces             | **End the active conference**                                                            | `spaces.endActiveConference`                                                                           | **destructive**     | Yes (ends the call for everyone)          |                                                                                           |
| Members            | Pre-assign co-host or member                                                             | `spaces.members.create` / `patch` / `delete` / `batchUpdate`                                           | internal_reversible | Docs don't say whether anyone is notified | GA Sep 11 2026                                                                            |
| Conference records | List or get past or ongoing calls                                                        | `conferenceRecords.list` (filter `space.name`, `space.meeting_code`, `start_time`, `end_time`) / `get` | read                | No                                        | **Records are deleted 30 days after the conference ends** (`expireTime`)                  |
| Participants       | Who attended, and their sessions                                                         | `conferenceRecords.participants.list` / `get`, `participantSessions.list` / `get`                      | read                | No                                        |                                                                                           |
| Recordings         | Recording metadata plus Drive file pointer                                               | `conferenceRecords.recordings.list` / `get`                                                            | read                | No                                        | File is in the organizer's Drive. Download needs a Drive scope                            |
| Transcripts        | Transcript metadata plus Docs pointer                                                    | `conferenceRecords.transcripts.list` / `get`                                                           | read                | No                                        | `state`: STARTED → ENDED → FILE_GENERATED. `docsDestination` points to the Google Doc     |
| Transcript entries | Speaker-attributed text segments                                                         | `conferenceRecords.transcripts.entries.list` / `get`                                                   | read                | No                                        | **Entries deleted 30 days after the conference.** Needs only a Meet scope, no Drive scope |
| Smart notes        | Gemini notes metadata plus Doc pointer                                                   | `conferenceRecords.smartNotes.list` / `get`                                                            | read                | No                                        | GA Apr 2 2026                                                                             |

There's nothing to send from Meet itself, so **no external_send needs a Meet pending form**. Follow-ups go out through Gmail drafts. Ending a call is the only effect on others, and it's destructive.

### 3. Pending form

None needed for reads. If the catalog includes "set this meeting to auto-record" or "add co-host", treat those as internal_reversible, or require review because of the privacy weight. Calendar's guest-less event remains the pending form for "schedule a meeting".

### 4. Triggers

- **Push: Workspace Events API**, all events v2 (https://developers.google.com/workspace/events/guides/events-meet):
  - `conference.v2.started|ended`
  - `participant.v2.joined|left`
  - `recording.v2.started|ended|fileGenerated`
  - `transcript.v2.started|ended|fileGenerated`
  - `smartNote.v2.started|ended|fileGenerated`
  - Targets:
    - Meeting space `//meet.googleapis.com/spaces/SPACE`.
    - User `//cloudidentity.googleapis.com/users/USER`, which covers **all spaces the user owns**. That's usually the organizer of the Calendar event.
  - **Calendar invitees and other participants receive only `conference.v2.started` and `transcript.v2.fileGenerated`.** So for a member who didn't organize the meeting, `transcript.fileGenerated` is the one useful event.
  - Payloads carry **resource names only, with no resource data**, so the subscription can last up to **7 days** and must be renewed.
- **Delay:** the docs say only that artifacts are "usually ready to be fetched soon after a conference ends". The help center notes that longer meetings take longer to process. No figure is published. Design for minutes to hours, and keep a polling fallback.
- **Polling:** `conferenceRecords.list` with `end_time > T`, then `transcripts.list` until `state = FILE_GENERATED`. This must run within 30 days of the meeting.

### 5. Auth

| Scope                     | Class          | Used for                                                              |
| ------------------------- | -------------- | --------------------------------------------------------------------- |
| `meetings.space.created`  | Sensitive      | Create and manage spaces the app created, plus their records          |
| `meetings.space.readonly` | Sensitive      | Read any space, record, transcript or smart notes the user can access |
| `meetings.space.settings` | Non-sensitive  | User's Meet settings                                                  |
| `drive.meet.readonly`     | **Restricted** | Download Meet-created Drive files                                     |
| `drive.readonly`          | **Restricted** | Already granted to Mycel. Covers recording and transcript files       |

Transcript text through `transcripts.entries` needs only `meetings.space.readonly` (sensitive). That's the cheapest addition to the existing connection. Domain-wide delegation is also supported but ruled out.

**Edition requirements** (the deciding factor for small companies):

- **Transcripts:** Business Standard, Business Plus, Enterprise Starter, Standard and Plus, some Education editions, and Workspace Individual (https://support.google.com/meet/answer/12849897).
- **Recording:** Business Standard and Plus, Essentials, Enterprise tiers, Education Plus, and Google One 2 TB+ (https://support.google.com/meet/answer/9308681).
- **Business Starter has neither.**
- Smart notes require "an eligible Google Workspace edition or Google AI plan" (https://support.google.com/meet/answer/14754931). The specific editions aren't listed on that page.
- Transcripts must be switched on in the meeting, or auto-enabled through `artifactConfig`. When host management is on, only hosts and co-hosts can switch them on.
- All artifacts are saved to the **organizer's** Drive.

### 6. Limits

The Meet REST API's per-method quotas weren't found in the pages fetched; check https://developers.google.com/workspace/meet/api/guides/limits before building. Retention bites harder than quotas: conference records and transcript entries are deleted 30 days after the meeting.

### 7. Nango

`google-meet` exists in providers.yaml (alias `google`, base `https://meet.googleapis.com`). Same story as Chat: add scopes to the single Google connection and proxy. Events go through Mycel's Pub/Sub.

### 8. Gaps and gotchas

- No transcript means no workflow: Business Starter customers and meetings where no one switched transcription on.
- The member must be the organizer, or an invitee who still gets `transcript.fileGenerated`. External organizers' transcripts live in **their** Drive, and access depends on their sharing.
- Speaker names for external or anonymous participants may be thin. Participants are typed as signed-in, anonymous or phone users.
- **Meet Media API** (real-time audio and video) is "no longer accepting new signups" (page updated Oct 1 2026). It's not an option.
- Invariant 8: the transcript text is fetched into memory to derive the summary. Mycel stores `conferenceRecords/…/transcripts/…` plus the `docsDestination.document` id as `source_ref`. Watch the 30-day expiry of the entries pointer; the Docs copy in Drive persists.

---

## Workspace Events API (the trigger plumbing for Chat, Meet and Drive)

- **What:** subscriptions to Chat, Meet and **Drive** events (Drive GA since May 18 2026: file created, moved, contentChanged, trashed and more, plus comment, reply, permission, access proposal and approval events). Delivered to a **Google Cloud Pub/Sub topic** as CloudEvents. Pub/Sub is the only notification endpoint documented.
- **Auth:** user OAuth with the app's own scopes (Meet `meetings.space.*`; Chat `chat.*`; Drive `drive.file` non-sensitive, or `drive` / `drive.readonly` restricted). App auth for Chat spaces needs admin approval; the customer target is Developer Preview plus admin.
- **Lifetime:** up to 4 h with resource data (24 h with domain-wide delegation, which is ruled out), and up to 7 days with names only. Mycel needs a renewal job; a `subscriptions.reactivate` method exists for suspended subscriptions.
- **Limits:** 600 writes and 600 reads per minute per project; 100 writes and 100 reads per minute per user.
- **Fit:** this is a cleaner push trigger for Drive than the Drive `changes.watch` channels Mycel may use today. It gives one consistent renewal model across Drive, Chat and Meet. Gmail and Calendar are **not** covered; they keep `users.watch` and `events.watch`.
- **Deletion (invariant 3):** deleting a connection must also delete its Workspace Events subscriptions (`subscriptions.delete`) while the token still works. A revoked token leaves orphaned subscriptions that expire on their own within ≤7 days.

---

## Google Keep

- **API:** `notes.create`, `get`, `list` (filter `createTime`, `updateTime`, `trashTime`, `trashed`), `delete`; `notes.permissions.batchCreate` / `batchDelete`; `media.download`. There's **no update or patch**: a note can't be edited, only created or deleted. Notes are text (under 20,000 chars) or one-level checklists. Scopes are `keep` and `keep.readonly`; their sensitivity class isn't stated on the pages fetched.
- **Access:** the overview describes it as an API "for enterprise administrators". Authorization is "domain-wide delegation using a service account or an OAuth client ID", the latter for "enterprise applications where the Administrator approves scopes for users". **There's no documented path for a third-party app with plain user consent.**
- **Verdict: not usable** (non-goal 7). Workflows that want "a checklist" should use Google Tasks (already in the catalog).

## Google Groups

- **No API reads group conversations.** The Groups Migration API only _inserts_ messages into a group's archive (`archive.insert`, scope `apps.groups.migration`), and it's a migration tool. **Posting to a group means emailing the group address**, which the Gmail draft pending form already covers.
- **Cloud Identity Groups API, non-admin authorization:** any user can read groups and memberships. **Managers** can manage non-owner memberships. **Owners** can edit metadata, delete the group, and manage all memberships. Scopes: `cloud-identity.groups.readonly` and `cloud-identity.groups` (sensitivity class not stated on pages fetched). Group creation through the API needs the customer ID ("C…" from the Admin console) and the `discussion_forum` label; `EMPTY` initial config is for admins only.
- Possible catalog actions:
  - list groups and members: read
  - add a member: **external_send**, since that person starts receiving the group's mail
  - **remove a member or delete a group: destructive**
- **Groups Settings API** (`apps.groups.settings`): owners can change a group's settings. It's niche.
- **Verdict:** the read side is usable for routing ("who's in sales@?"). The write side is low value. The Directory API for the same data is Admin SDK, which is ruled out.

## Google Sites

- **There's no API for current Google Sites.** The FAQ, last updated Oct 6 2026, says "Sites API is deprecated and might stop working at any time" and "can only access classic Sites", not the rebuilt Sites launched Nov 22 2016.
- A Site exists as a Drive file (`application/vnd.google-apps.site`), so Drive can find, share or trash it, but not read or edit its content.
- **Verdict: not usable.** If a customer keeps an intranet FAQ on Sites, the Drive sharing actions are the only reach.

## Apps Script API

- **Can:**
  - create and update script projects and their content (`projects.create`, `updateContent`)
  - manage versions and deployments
  - read processes and metrics
  - **run a function** with `scripts.run`
- **Blocks for Mycel:**
  - `scripts.run` requires the script and the caller's OAuth client to "share a common Google Cloud project". The script must be deployed as an API executable. The token must carry every scope the script uses. Runs time out at 6 min. Service accounts aren't supported.
  - Each user must switch on "Google Apps Script API" at script.google.com/home/usersettings.
  - Writing or deploying scripts is generating code, against **invariant 5 and non-goal 4**.
- Scopes: `script.projects`, `script.deployments`, `script.processes`, `script.metrics`. Sensitivity class not stated on the pages fetched.
- **Verdict: not usable.** At most, discovery could notice that a team relies on scripts: Drive lists them as `application/vnd.google-apps.script`. That's a signal for capability requests, not a catalog action.

## Gemini / Workspace AI surfaces

- **Meet smart notes** ("Take notes for me"): readable through `conferenceRecords.smartNotes` (GA Apr 2026), with `smartNote.v2.fileGenerated` events. The notes Doc is in the organizer's Drive. This is the one Gemini output a third-party app can read through a normal API. It can cut Mycel's own model spend on meeting summaries, but it depends on edition.
- **Workspace MCP servers** (Gmail, Drive, Docs, Sheets, Slides, Calendar, Chat, People, Classroom at `https://<product>mcp.googleapis.com/mcp/v1`):
  - **Developer Preview.** Public developer preview since May 1 2026.
  - User OAuth. Clients must be marked "Use this client for an AI-powered agent", required by Nov 11 2026.
  - The Chat and People servers are read-only, though a May 2026 note lists a Chat `send_message` tool in preview.
  - Nango already lists `google-calendar-mcp`.
  - Not a basis for the catalog (preview, and tool behaviour isn't fixed), but it's worth watching.
- **Workspace Studio** (Google's own no-code AI flows):
  - Available on Business Starter and up, plus Enterprise and Education editions.
  - Custom starters and steps (GA Sep 2026), webhooks, and 8 third-party integrations in beta.
  - **No API for outside apps to create or run flows.** Outside apps can only plug in as a Workspace add-on that supplies custom steps or starters.
  - It's a direct competitor to Mycel's builder, not an integration target.
- **Gemini in Gmail and Docs** (summaries, help me write): no API.
- **Gemini API** (`generativelanguage.googleapis.com`; Nango `google-gemini`, API key): a model provider, which doesn't act on user data. That belongs to model roles (invariant 6), not to this catalog.
- **Quota tiering (May 1 2026):** Google introduced a standard quota tiering model for Gmail, Calendar and Drive. It applies to new projects from May 1 2026; existing projects got 60 days' notice. It's not specific to the apps here, but worth checking for Mycel's project.

---

## Sources

- Chat API auth overview, scopes and sensitivity (updated 2026-10-09): https://developers.google.com/workspace/chat/authenticate-authorize
- Chat user auth prerequisites, Business/Enterprise (updated 2026-10-12): https://developers.google.com/workspace/chat/authenticate-authorize-chat-user
- Configure the Chat API, read-only vs write, visibility (updated 2026-10-16): https://developers.google.com/workspace/chat/configure-chat-api
- Chat REST reference index: https://developers.google.com/workspace/chat/api/reference/rest
- `spaces.messages` resource: https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages
- `messages.create`: https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages/create
- `messages.list`: https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages/list
- `messages.search`: https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages/search
- `messages.delete`: https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages/delete
- `spaces.setup` (`singleUserBotDm`): https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces/setup
- Create messages, private messages and cards (updated 2026-10-09): https://developers.google.com/workspace/chat/create-messages
- Add members, including the app (`users/app`): https://developers.google.com/workspace/chat/create-members
- Receive and respond to interactions: https://developers.google.com/workspace/chat/receive-respond-interactions
- Chat limits (updated 2026-10-09): https://developers.google.com/workspace/chat/limits
- Publish Chat apps: https://developers.google.com/workspace/chat/apps-publish
- Publish to the Marketplace: https://developers.google.com/workspace/marketplace/how-to-publish
- Admin: allow users to install Chat apps: https://knowledge.workspace.google.com/admin/chat/allow-users-to-install-chat-apps
- Meet REST overview (updated 2026-09-14): https://developers.google.com/workspace/meet/api/guides/overview
- Meet artifacts (updated 2026-09-14): https://developers.google.com/workspace/meet/api/guides/artifacts
- Meet scopes (updated 2026-09-14): https://developers.google.com/workspace/meet/api/guides/authenticate-authorize
- Meet REST reference index: https://developers.google.com/workspace/meet/api/reference/rest
- Meet `conferenceRecords` (30-day `expireTime`): https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords
- Meet `conferenceRecords.list`: https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords/list
- Meet transcripts: https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords.transcripts
- Meet spaces: https://developers.google.com/workspace/meet/api/reference/rest/v2/spaces
- Meet `spaces.members`: https://developers.google.com/workspace/meet/api/reference/rest/v2/spaces.members
- Meet Media API (updated 2026-10-01): https://developers.google.com/workspace/meet/media-api/guides/overview
- Meet transcripts editions: https://support.google.com/meet/answer/12849897
- Meet recording editions: https://support.google.com/meet/answer/9308681
- Take notes for me: https://support.google.com/meet/answer/14754931
- Workspace Events overview (updated 2026-09-03): https://developers.google.com/workspace/events and https://developers.google.com/workspace/events/guides
- Events: Meet: https://developers.google.com/workspace/events/guides/events-meet
- Events: Chat: https://developers.google.com/workspace/events/guides/events-chat
- Events: Drive: https://developers.google.com/workspace/events/guides/events-drive
- Events scopes: https://developers.google.com/workspace/events/guides/auth
- Events limits: https://developers.google.com/workspace/events/guides/limits
- Keep API overview (updated 2026-09-03): https://developers.google.com/workspace/keep/api/guides
- Keep REST reference: https://developers.google.com/workspace/keep/api/reference/rest
- Keep `notes.list`: https://developers.google.com/workspace/keep/api/reference/rest/v1/notes/list
- Keep note resource: https://developers.google.com/workspace/keep/api/reference/rest/v1/notes
- Cloud Identity auth, non-admin mode (updated 2026-10-13): https://docs.cloud.google.com/identity/docs/concepts/auth
- Create Google Groups: https://docs.cloud.google.com/identity/docs/how-to/create-google-groups
- Groups Migration `archive.insert`: https://developers.google.com/admin-sdk/groups-migration/v1/reference/archive/insert
- Groups Settings: https://developers.google.com/workspace/admin/groups-settings/v1/reference/groups
- OAuth scopes list: https://developers.google.com/identity/protocols/oauth2/scopes
- Sites FAQ (updated 2026-10-06): https://developers.google.com/sites/faq
- Drive MIME types: https://developers.google.com/workspace/drive/api/guides/mime-types
- Apps Script API concepts (updated 2026-09-03): https://developers.google.com/apps-script/api/concepts
- Apps Script execute: https://developers.google.com/apps-script/api/how-tos/execute
- Workspace MCP servers: https://developers.google.com/workspace/guides/configure-mcp-servers
- Agent tools and tiering announcement (May 2026): https://workspaceupdates.googleblog.com/2026/05/agent-tools-and-security-updates-for-workspace-developers.html
- Workspace Studio custom starters and steps (Sep 2026): https://workspaceupdates.googleblog.com/2026/09/automate-workflows-with-custom-starters-and-steps-third-party-integrations-and-webhooks-in-Workspace-Studio.html
- Workspace developer release notes: https://developers.google.com/workspace/release-notes
- Nango providers.yaml (`google`, `google-chat`, `google-meet`, `google-calendar-mcp`, `google-gemini`): https://github.com/NangoHQ/nango/blob/master/packages/providers/providers.yaml
