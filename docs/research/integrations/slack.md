# Slack

Researched 2026-10-21 against docs.slack.dev (the developer docs moved there from api.slack.com in 2025), Slack's API Terms of Service, the Slack Help Center, and Nango's docs. Most docs.slack.dev reference pages show no last-updated date. Where one is shown, it is noted.

## 1. Summary

In a small company Slack is where the team talks: channels per team or customer, DMs, threads, and a bot or two posting alerts. It is also where requests arrive ("can someone send X to Y?"), not only where people chat. For Mycel it is mainly a **trigger source and output channel**, with a much weaker **discovery source**. History reads are throttled hard for apps like ours (§6), and Slack's terms restrict copying message data (§8).

Workflows it most enables:

1. **Notify and route**: post a summary, alert or digest into a channel or a person's DM when something happens in Gmail, Sheets or Calendar (for example "new invoice from a client → post to #finance").
2. **Answer or act on a mention or DM**: someone @-mentions the Mycel bot or DMs it ("what's the status of order 123?") → read Sheets/Gmail → reply in thread.
3. **Draft a reply as the person**: a message arrives in a member's DM or a channel → Mycel prepares a reply that the person approves (needs a pending form; see §3).
4. **Triage**: react with an emoji, add an item to a Slack List, or open a Google Task from a message in a channel such as #support or #requests.
5. **Housekeeping**: create a channel for a new client and invite people, set its topic, add bookmarks, post a canvas with the brief.

## 2. Capability table

Proposed risk levels follow Mycel's scale. One Slack-specific point: **almost every Slack write is visible to other people**, unlike a Gmail label. For an action that is visible to colleagues, reversible, and clearly comes from the Mycel bot (for example an emoji acknowledgement), I propose `internal_reversible`. For anything posted _as the person_, or anything that delivers content to others, I propose `external_send`. This is a policy call for our team (invariant 4).

"Reaches outside the user" means people other than the connected person, colleagues included.

Token column: **B** = bot token (`xoxb-`), **U** = user token (`xoxp-`).

### Messages

| Operation                                 | API method                                                               | Token | Proposed risk                                                                              | Reaches others?      | Notes                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read channel/DM history                   | `conversations.history`                                                  | B, U  | read                                                                                       | no                   | Scopes `channels:history`, `groups:history`, `im:history`, `mpim:history`. Limit max 999, **but 1 req/min and 15 objects for non-Marketplace distributed apps** (§6).                                                                                                                                    |
| Read a thread                             | `conversations.replies`                                                  | B, U  | read                                                                                       | no                   | Same scopes; documented as Tier 3, limit max 1000. Same non-Marketplace cut applies.                                                                                                                                                                                                                     |
| Get a permalink                           | `chat.getPermalink`                                                      | B, U  | read                                                                                       | no                   | Lets Mycel store a pointer that people can open.                                                                                                                                                                                                                                                         |
| Post a message to a channel or thread     | `chat.postMessage`                                                       | B, U  | external_send                                                                              | yes                  | `chat:write`. With a U token it posts **as the person**. `chat:write.public` lets the bot post to public channels it hasn't joined. `chat:write.customize` changes name/icon. `thread_ts` plus `reply_broadcast`. About 1 msg/sec/channel. Text should stay under 4,000 characters; truncated at 40,000. |
| DM a person                               | `chat.postMessage` (channel = user ID) or `conversations.open` then post | B, U  | external_send                                                                              | yes                  | `im:write` to open DMs. A bot can't post into a user-to-user DM it isn't part of.                                                                                                                                                                                                                        |
| Ephemeral message (only one user sees it) | `chat.postEphemeral`                                                     | B, U  | internal_reversible if sent to the connected person; external_send if sent to someone else | the target user only | Tier 4. Not persisted ("do not persist across reloads, desktop and mobile apps, or sessions"). Delivery not guaranteed. Can't be updated with `chat.update`. Target must be in the channel.                                                                                                              |
| Edit a message                            | `chat.update`                                                            | B, U  | external_send (changes what others read)                                                   | yes                  | Only messages the token's own identity posted. Bot edits show no "(edited)" label. Fails if the edit window has closed or the channel is archived.                                                                                                                                                       |
| Delete a message                          | `chat.delete`                                                            | B, U  | **destructive**                                                                            | yes                  | Bot: only its own messages. User: only what that user may delete in Slack.                                                                                                                                                                                                                               |
| Schedule a message                        | `chat.scheduleMessage`                                                   | B, U  | external_send                                                                              | yes, when it fires   | Up to **120 days** ahead. No more than **30 per channel per 5 minutes**. Supports `thread_ts`. Messages scheduled with `metadata` **won't post**. No edit method exists.                                                                                                                                 |
| List scheduled messages                   | `chat.scheduledMessages.list`                                            | B, U  | read                                                                                       | no                   | Returns `id`, `channel_id`, `post_at`, `date_created`, `text`. **Only messages scheduled via the API with the same token, not ones scheduled in the Slack UI.**                                                                                                                                          |
| Delete a scheduled message                | `chat.deleteScheduledMessage`                                            | B, U  | internal_reversible                                                                        | no                   | **Fails within 60 seconds of `post_at`** (`invalid_scheduled_message_id`).                                                                                                                                                                                                                               |
| Message metadata                          | `metadata` on post/update                                                | B, U  | n/a                                                                                        |                      | Structured event data on a message. Can't be combined with scheduling.                                                                                                                                                                                                                                   |
| Unfurl links                              | `chat.unfurl` (`links:write`), `link_shared` event (`links:read`)        | B     | external_send                                                                              | yes                  |                                                                                                                                                                                                                                                                                                          |

### Reactions, pins, bookmarks, saved items, reminders

| Operation              | API method                                   | Token                 | Proposed risk                                                           | Reaches others?        | Notes                                                                                                                                                                                     |
| ---------------------- | -------------------------------------------- | --------------------- | ----------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add/remove a reaction  | `reactions.add` / `reactions.remove`         | B, U                  | internal_reversible as the bot; external_send as the person (debatable) | visible in the channel | `reactions:write`. `reactions.get`/`list` for reading (`reactions:read`).                                                                                                                 |
| Pin/unpin              | `pins.add` / `pins.remove`                   | B, U                  | internal_reversible                                                     | visible                | `pins:write`                                                                                                                                                                              |
| Channel bookmarks      | `bookmarks.add` / `edit` / `remove` / `list` | B, U                  | internal_reversible                                                     | visible                | `bookmarks:write` / `bookmarks:read`                                                                                                                                                      |
| Save for later (stars) | `stars.add` / `list` / `remove`              | U                     | n/a: **don't build**                                                    |                        | Since the "Later" feature (rolled out from March 2023), stars calls "will have no user-facing impact". `stars.list` is "frozen in time". They will eventually return `method_deprecated`. |
| Reminders              | `reminders.add` etc.                         | U (`reminders:write`) | n/a: **don't build**                                                    |                        | "Retirement of API methods for interfacing with reminders began March 2023 … degraded or useless". The `user` param is no longer supported. Use a scheduled DM, or Google Tasks, instead. |

### Channels (conversations)

| Operation                            | API method                                         | Token                                                                                         | Proposed risk                                                                   | Reaches others?               | Notes                                                                                                   |
| ------------------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| List/info/members                    | `conversations.list`, `.info`, `.members`          | B, U                                                                                          | read                                                                            | no                            | `channels:read`, `groups:read`, `im:read`, `mpim:read`                                                  |
| Create channel                       | `conversations.create`                             | B (`channels:manage` or `channels:write`/`groups:write`), U (`channels:write`/`groups:write`) | internal_reversible                                                             | yes: visible in the workspace | Workspace preference can block it (`restricted_action`).                                                |
| Join a channel                       | `conversations.join`                               | B (`channels:join`)                                                                           | internal_reversible                                                             | no                            | Public channels only                                                                                    |
| Invite / remove people               | `conversations.invite` / `conversations.kick`      | B, U                                                                                          | invite: external_send (notifies people); kick: **destructive**                  | yes                           | `channels:write.invites` / `groups:write.invites` for invite; `channels:manage`/`groups:write` for kick |
| Set topic/purpose, rename            | `conversations.setTopic`, `.setPurpose`, `.rename` | B, U                                                                                          | internal_reversible                                                             | visible                       | `channels:write.topic` (topic/purpose)                                                                  |
| Archive / unarchive                  | `conversations.archive` / `.unarchive`             | B, U                                                                                          | archive: **destructive** (reversible, but it cuts the channel off for everyone) | yes                           | Can't archive #general or required channels                                                             |
| Slack Connect invite (external orgs) | `conversations.inviteShared`                       | **B only** (`conversations.connect:write`)                                                    | external_send (**reaches outside the company**)                                 | yes, external                 | Paid plans only (`not_paid`). Bots must name recipients by `user_ids`/`emails`.                         |

### Files, canvases, Lists

| Operation               | API method                                                                                                                                                                                                    | Token | Proposed risk                                                        | Reaches others?               | Notes                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload a file           | `files.getUploadURLExternal` then `files.completeUploadExternal`                                                                                                                                              | B, U  | external_send if shared to a channel                                 | yes                           | `files:write`. **`files.upload` was sunset on 2025-11-12.**                                                                                                |
| Read files              | `files.list`, `files.info`                                                                                                                                                                                    | B, U  | read                                                                 | no                            | `files:read`. Gets extra Marketplace scrutiny (§5).                                                                                                        |
| Delete file             | `files.delete`                                                                                                                                                                                                | B, U  | **destructive**                                                      | yes                           |                                                                                                                                                            |
| Create canvas           | `canvases.create` (standalone), `conversations.canvases.create` (channel canvas)                                                                                                                              | B, U  | internal_reversible if private; external_send if shared to a channel | depends                       | `canvases:write`, Tier 2. Free plans: no standalone canvases, one canvas tab per channel, `channel_id` required. Content max 1 MiB per `document_content`. |
| Edit canvas             | `canvases.edit`, `canvases.sections.lookup`                                                                                                                                                                   | B, U  | external_send if shared                                              | depends                       |                                                                                                                                                            |
| Share or unshare canvas | `canvases.access.set` / `.delete`                                                                                                                                                                             | B, U  | external_send                                                        | yes                           |                                                                                                                                                            |
| Delete canvas           | `canvases.delete`                                                                                                                                                                                             | B, U  | **destructive**                                                      |                               |                                                                                                                                                            |
| Read canvas content     | none documented                                                                                                                                                                                               |       |                                                                      |                               | The canvas docs only point to `files.list` filtered to `canvas`. They document no method that returns canvas content.                                      |
| Lists (Sept 2025)       | `slackLists.create`, `.update`, `.items.create`, `.items.update`, `.items.delete`, `.items.deleteMultiple`, `.items.list`, `.items.info`, `.download.start`, `.download.get`, `.access.set`, `.access.delete` | B, U  | create/update item: internal_reversible; delete: **destructive**     | visible to people with access | `lists:read` / `lists:write`. Tier 2. **Paid plans only.**                                                                                                 |

### People and groups

| Operation                      | API method                                                                     | Token                              | Proposed risk                                                    | Reaches others? | Notes                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------- | ---------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Users list/info, find by email | `users.list`, `users.info`, `users.lookupByEmail`                              | B, U                               | read                                                             | no              | `users:read`, `users:read.email`. Useful for mapping Gmail senders to Slack users.                                                                                                      |
| Set own status/profile         | `users.profile.set`                                                            | **U only** (`users.profile:write`) | internal_reversible                                              | visible         | 10 updates per user per minute; 30 profiles per minute per token. Changing others' profiles needs a paid plan and an admin role (an admin-level capability; excluded by intent note 7). |
| Do Not Disturb                 | `dnd.setSnooze` / `endSnooze`                                                  | U (`dnd:write`)                    | internal_reversible                                              | no              |                                                                                                                                                                                         |
| User groups                    | `usergroups.create`, `.update`, `.users.update`, `.disable`/`.enable`, `.list` | B, U                               | update membership: internal_reversible; disable: **destructive** | yes             | `usergroups:write`. **Paid plans only** (`paid_teams_only`). The workspace setting can restrict who manages groups (`permission_denied`).                                               |

### Search

| Operation                | API method                 | Token                                                                                                                                      | Proposed risk | Reaches others? | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search messages (legacy) | `search.messages`          | **U only** (`search:read`)                                                                                                                 | read          | no              | Tier 2. Marked "legacy"; Slack recommends `assistant.search.context`. **`search:read` is banned for Marketplace apps** (§5).                                                                                                                                                                                                                                                                                                                                                |
| Real-time Search API     | `assistant.search.context` | B (`search:read.public`, `search:read.files`, `search:read.users`) or U (adds `search:read.private`, `search:read.im`, `search:read.mpim`) | read          | no              | **Only for Marketplace-listed ("directory-published") and internal apps; unlisted distributed apps can't use it.** A bot-token call needs an `action_token`, which only comes from a user event (`app_mention`, `message.im`, …), so background search with a bot token is impossible. About 10 req/min per user. **"You must not store or copy any of the data retrieved from this API."** Semantic search needs Business+/Enterprise+; keyword search works on all plans. |

### Interactivity and app surfaces (no risk level; plumbing for approvals)

| Operation                           | API method                                                                                               | Notes                                                                                                                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buttons/menus in messages           | Block Kit `actions` blocks, delivered as `block_actions` payloads to the app's Interactivity Request URL | Ack within **3 s**. `response_url` usable **5 times within 30 min**. Payloads are signed (verify the signing secret).                                                                                 |
| Modals (e.g. "edit before sending") | `views.open` / `views.update`                                                                            | Needs a `trigger_id`, which "expire[s] in three seconds" and is single-use.                                                                                                                           |
| App Home tab                        | `views.publish`                                                                                          | A per-user home page in Slack; could show a person's waiting reviews.                                                                                                                                 |
| Agent DM experience                 | `agent_view` manifest, `agents.sessions.setStatus`, `chat.startStream`/`appendStream`/`stopStream`       | `assistant_view` is deprecated **February 2027**, in favour of Agent Sessions (changelog 2026-08-20). It is not a pending form, but relevant if Mycel ever offers a chat-with-Mycel-in-Slack surface. |

**Financial actions:** none exist in Slack.
**Destructive actions:** `chat.delete`, `conversations.archive`, `conversations.kick`, `files.delete`, `canvases.delete`, `slackLists.items.delete`/`deleteMultiple`, `usergroups.disable`. v1 has no destructive actions, so none should be catalogued.

## 3. Pending form: Slack has none, so it needs a design

**There is still no draft API in 2026.** The full Web API method index (checked 2026-10-21) has no `draft` method. The only method families that hold an unsent message are `chat.scheduleMessage`, `chat.scheduledMessages.list` and `chat.deleteScheduledMessage`. "Save for later" (`stars.*`) only bookmarks existing items and is effectively retired. The 2025–2026 agent features (Agent Sessions, streaming, plan/task-card blocks) add no draft or approval primitive.

Every Slack `external_send` (`chat.postMessage`, threaded replies, DMs, `conversations.invite`, `conversations.inviteShared`, canvas sharing, file shares) therefore needs a designed pending form. Four candidates follow.

### Option A: Parked scheduled message (the far-future schedule)

| Operation | Calls                                                                                                                                                                                                                                               |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| prepare   | `chat.scheduleMessage(channel, text/blocks, thread_ts, post_at = now + N days)`, with N ≤ 120. U token to send as the person, B token for an org connection. Review pointer: `{channel, scheduled_message_id, post_at}`.                            |
| check     | `chat.scheduledMessages.list(channel, same token)`. If the id is present: `waiting`. If absent: `gone`. Slack exposes no link from a posted message back to its schedule id (and `metadata` breaks scheduling), so `done_in_app` can't be detected. |
| approve   | Fetch `text` live from `chat.scheduledMessages.list`, then `chat.postMessage` now, then `chat.deleteScheduledMessage`. To approve an edit, delete and re-schedule or post: there is no update method.                                               |
| decline   | `chat.deleteScheduledMessage`                                                                                                                                                                                                                       |

- **Invariant 8:** satisfied. Slack holds the content, and Mycel re-fetches `text` at approval.
- **Fatal flaw: it fails open.** An unresolved review sends itself at `post_at`. Mycel downtime, a bug, a forgotten review, or a **revoked token or deleted connection** (after which Mycel can't call delete) all lead to a message nobody approved. Slack's docs don't say whether scheduled messages are cancelled when the token is revoked or the app uninstalled; this needs testing. A sweeper that deletes at review expiry shrinks the window but doesn't close it. That conflicts with intent note 1 ("no unsupervised external effects") and with invariant 3: deleting the connection should not trigger a send.
- **No editing in Slack.** The docs don't say whether API-scheduled messages appear in the person's own "Scheduled" list in the Slack client. `chat.scheduledMessages.list` explicitly can't see UI-scheduled ones, so assume the person can't see or edit them in Slack. That removes the main reason ADR-0013 prefers app-native forms.
- Other limits: 30 per channel per 5 minutes; delete fails in the last 60 s before `post_at` (irrelevant far out).
- **Verdict: reject.**

### Option B: Preview message with Block Kit Approve / Edit / Decline (recommended for org connections)

| Operation | Calls                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| prepare   | The bot posts a preview: `chat.postMessage` to the member's DM with the app (`channel = user_id`, `im:write`, `chat:write`), or to a private **review channel** for org-credential workflows. It holds the draft text plus `actions` buttons whose `value` carries the review id. Pointer: `{channel, ts}`.                                                             |
| check     | Mostly **pushed**: `block_actions` payloads arrive at the Interactivity Request URL. To confirm the preview still exists, fetch one message with `conversations.history(channel, latest=ts, inclusive, limit=1)` or `conversations.replies`. Subject to the non-Marketplace 1 req/min limit (§6), so check sparingly. `message_deleted` events can also mark it `gone`. |
| approve   | From Slack: a `block_actions` payload (ack in < 3 s), then Mycel reads the draft from the payload's `message.blocks`. From the Reviews page: Mycel fetches the preview message live. Then `chat.postMessage` to the real destination (U token = as the person; B token = as the bot), and `chat.update` the preview to "Sent ✓ by X".                                   |
| edit      | The Edit button calls `views.open` (needs `trigger_id` within 3 s) with a modal pre-filled from the preview. On `view_submission`, `chat.update` the preview.                                                                                                                                                                                                           |
| decline   | `chat.update` the preview to "Declined" (keeps an audit trail), or `chat.delete` it.                                                                                                                                                                                                                                                                                    |

- **Invariant 8:** satisfied. The content lives in a Slack message, and Mycel stores `{channel, ts}` and re-fetches. Text passes through Mycel memory only during approve.
- **Fails closed.** Nothing reaches the destination unless someone approves.
- Matches ADR-0013's org-credential rule: post to a review channel of tag members plus admins, and the first click wins. Mycel enforces that by updating the preview atomically, before it posts.
- Costs:
  - An Interactivity Request URL with signature verification. That is a route handler, which counts as a webhook under CLAUDE.md. Nango forwards Events API webhooks; its Slack docs don't cover interactivity payloads, so assume Mycel receives these itself.
  - Approving in Slack splits review across two surfaces. Mitigation: keep the Reviews page as the source of truth and treat Slack buttons as a shortcut, or omit the buttons and link to the review.
  - The preview is a copy, not "the real message". Posting it is a copy step, like Calendar's "add the guests".

### Option C: Self-DM note as the person (candidate for member connections; needs testing)

Uses only the member's U token: `chat:write`, `im:write`, `im:history`.

| Operation | Calls                                                                                                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| prepare   | `chat.postMessage` into the person's own self-DM (their "notes to self"). The text is prefixed with the destination ("Reply to #sales thread …"). Pointer: `{channel, ts, destination}`. |
| check     | Fetch the one message by `ts`. Present: `waiting`. Absent: `gone` (the person deleted it).                                                                                               |
| approve   | Fetch the current text live (picking up any edit the person made in Slack), `chat.postMessage` it to the destination as the person, then `chat.delete` the note.                         |
| decline   | `chat.delete` the note.                                                                                                                                                                  |

- **Invariant 8:** satisfied. **Fails closed.**
- **The person can edit it with Slack's own composer**, the closest thing to a Gmail draft. No interactivity endpoint is needed.
- Unverified: the docs don't explicitly cover posting to one's own self-DM via `chat.postMessage` with a user token. Test this.
- Each check is a history read, so it hits the 1 req/min limit (§6).

### Option D: Hold the prepared action in Mycel

This is ADR-0013's rejected option. It violates invariant 8, and would need a new ADR (for example, encrypted with a short TTL). Not recommended.

### Recommendation for the ADR

- **Org connections (bot):** Option B with a review channel.
- **Member connections (as the person):** Option C if testing confirms self-DM posting works. Otherwise Option B, delivered as a DM from the bot to the person.
- **Don't use Option A.** Its failure mode is an unapproved send.

On all three options, the Reviews page stays the main screen and the Slack-side holder is the pending form. Low-risk bot posts to a channel the admin designated (pure notifications that carry no person's voice) could arguably be `internal_reversible`. That is a policy decision; flag it in the ADR.

## 4. Triggers

**Push: Events API over HTTP** (Mycel would receive it via Nango's webhook forwarding, §7).

- **Useful events:**
  - Messages: `message.channels` / `message.groups` / `message.im` / `message.mpim`, needing the matching `*:history` scope.
  - `app_mention` (`app_mentions:read`).
  - `reaction_added` / `reaction_removed` (`reactions:read`).
  - Channels and people: `member_joined_channel`, `channel_created` / `channel_archive` / `channel_rename`, `team_join`, `user_change`.
  - Files: `file_shared` / `file_created` / `file_deleted` (`files:read`).
  - `link_shared` (`links:read`), `app_home_opened`.
  - Lifecycle, needed for invariant 3: `tokens_revoked` (lists the user IDs whose U or B tokens were revoked) and `app_uninstalled`.
  - Lists and canvas events: not verified in this pass.
- **Delivery:**
  - The app must return 2xx **within 3 seconds**.
  - Retries come about immediately, then after 1 minute, then after 5 minutes, with `x-slack-retry-num` and `x-slack-retry-reason` headers. `x-slack-no-retry: 1` suppresses them.
  - Subscriptions are auto-disabled if more than 95% of deliveries fail within 60 minutes (only for apps receiving at least 1,000 events per hour).
  - An opt-in "retry delayed events" feature adds hourly retries for 24 h; the default cutoff for late events is 2 h.
  - **30,000 events per workspace per app per 60 minutes**, after which `app_rate_limited` events are sent.
  - Latency isn't documented beyond "real time".
- **No expiry or renewal.** Subscriptions are configured once in the app's settings or manifest. This is much simpler than Gmail watch or Graph subscriptions.
- **Multi-user installs:** "You'll receive a single event for a piece of data intended for multiple users in a workspace, rather than a message per user." The `authorizations` field names _one_ installation. `apps.event.authorizations.list` (app-level `xapp-` token, `authorizations:read`, 600/min) returns all of them. This matters when several members connect in one workspace (§7).
- **Socket Mode:** a WebSocket instead of a public URL. Up to 10 connections, refreshed every few hours. **Apps using Socket Mode are "not currently allowed in the public Slack Marketplace."** Use HTTP.

**Polling:** `conversations.history` with an `oldest` cursor is the only delta mechanism; Slack has no history ID or sync token. Polling is **impractical for a non-Marketplace distributed app** at 1 req/min and 15 messages per call (§6). Treat Slack as push-only unless Mycel is listed on the Marketplace.

## 5. Auth

**Token types and Mycel's connections**

| Mycel concept                                | Slack mechanism                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Org connection** (shared bot)              | An app install with **bot scopes** (`scope=` on `oauth/v2/authorize`), which yields an `xoxb-` token. The bot only sees channels it has joined, or was invited to for private ones. It posts as "Mycel".                                                                                                                                    |
| **Member connection** (acting as the person) | The same OAuth flow with **user scopes** (`user_scope=`). It returns `authed_user.access_token` (`xoxp-`), which has "the same access a user has to a workspace", and writes are "performed as if by the user themselves". Each member who authorizes gets their own U token. The response also returns the workspace's (shared) bot token. |

- One OAuth app can request both kinds of scope in one flow.
- **Optional scopes** (2026) let installers decline some scopes, and the app must cope gracefully.
- **Token rotation** is optional (`token_rotation_enabled`). With it, access tokens expire after **12 h** and refresh tokens are single-use. Nango refreshes both B and U tokens.
- PKCE is GA (2026 changelog).
- **Deletion (invariant 3):**
  - Deleting a member connection should `auth.revoke` **only that person's `xoxp-` token**.
  - Revoking the `xoxb-` token "will … deactivate the bot user and remove its channel memberships" for the whole workspace, breaking the org connection and every other member's bot-side features. The shared bot token must be owned by the org connection, not by each member connection.

**Scopes per capability group** (B = bot scope, U = user scope)

| Capability                                   | Scopes                                                                                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Post / schedule / edit / delete own messages | `chat:write` (B, U). Optionally `chat:write.public` and `chat:write.customize` (B).                                                                        |
| Open DMs                                     | `im:write` (B, U). `mpim:write` for group DMs.                                                                                                             |
| Read history                                 | `channels:history`, `groups:history`, `im:history`, `mpim:history` (B, U)                                                                                  |
| List channels                                | `channels:read`, `groups:read`, `im:read`, `mpim:read`                                                                                                     |
| Manage channels                              | `channels:manage` (B), `channels:write` (U), `groups:write`, `channels:join` (B), `channels:write.invites`, `groups:write.invites`, `channels:write.topic` |
| Reactions / pins / bookmarks                 | `reactions:read`, `reactions:write`; `pins:write`; `bookmarks:read`, `bookmarks:write`                                                                     |
| Files / canvases / Lists                     | `files:read`, `files:write`; `canvases:read`, `canvases:write`; `lists:read`, `lists:write`                                                                |
| People                                       | `users:read`, `users:read.email`; `users.profile:write` (U only); `dnd:write` (U); `usergroups:read`, `usergroups:write`                                   |
| Search                                       | `search:read` (U, legacy); `search:read.public`, `.private`, `.im`, `.mpim`, `.files`, `.users` (Real-time Search)                                         |
| Mentions / links                             | `app_mentions:read`, `links:read`, `links:write`                                                                                                           |
| Slack Connect                                | `conversations.connect:write` (B only)                                                                                                                     |

**Sensitivity and review burden.** Slack has no Google-style sensitive or restricted classes. The burden comes from three places:

1. **Workspace app approval.** Owners can require approval before members install apps. It is off by default and available on all plans. Approval covers the scopes the app will use.
2. **Free-plan cap** of 10 third-party apps.
3. **Marketplace review**, which is effectively mandatory for Mycel:
   - Slack's **API Terms of Service (effective 2025-10-10)** say: "You may not Commercially Distribute an Application that integrates with the Slack APIs unless you are authorized to do so under a separate agreement". The authorized route is the Marketplace.
   - "Commercially Distribute" covers any app where "users could pay fees for your product", including "a free App that connects to a paid product".
   - The exemption covers apps "created for use only by a single third party": our dogfood workspace, or one customer.
   - Marketplace requirements:
     - At least **10 active workspace installs** (active = used in the past 28 days), kept up throughout review. Raised back to 10 in the 2026-09-01 changelog.
     - Preliminary review takes up to 10 business days; functional review up to **10 weeks** for new apps (6 weeks for updates).
     - **No `search:read`, `admin.*`, `identity.*`.**
     - `*:history` and `files:read` get "enhanced scrutiny without demonstrated necessity".
     - User tokens only "when your app is acting as your authenticating user".
     - "Do not use Slack data to train Large Language Models".
     - AI apps must disclose the model, retention, tenancy and residency.
     - **No Socket Mode.**
     - A privacy policy with access and deletion requests.
   - Unlisted distribution ("public distribution" switched on, no review) works technically. But for a paid product it conflicts with the ToS, and it gets the crippled history limits.

## 6. Limits

| Limit                                                                                   | Value                                                                                                                                                                                                                                                      | Bites Mycel?                                                                                                                                                               |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web API tiers                                                                           | Tier 1 = 1+/min, Tier 2 = 20+/min, Tier 3 = 50+/min, Tier 4 = 100+/min, per method per workspace per app                                                                                                                                                   | Rarely                                                                                                                                                                     |
| **`conversations.history` / `conversations.replies`, non-Marketplace distributed apps** | **1 request per minute, max 15 objects per request** (from 2025-05-29 for new apps and _new installations_). Marketplace apps are unchanged. **Internal customer-built apps are exempt** and keep "1,000 messages per request at 50+ requests per minute". | **Yes, badly.** Discovery over Slack history and polling triggers are impractical. Even fetching one message for a review check competes for the 1/min budget. See note 1. |
| `chat.postMessage`                                                                      | About 1 message/sec per channel, plus a workspace-wide limit                                                                                                                                                                                               | Digests to one channel: fine                                                                                                                                               |
| `chat.scheduleMessage`                                                                  | 30 per channel per 5 min; ≤ 120 days ahead                                                                                                                                                                                                                 | Only for Option A                                                                                                                                                          |
| Events API                                                                              | 30,000 deliveries per workspace per app per hour                                                                                                                                                                                                           | Fine for small companies                                                                                                                                                   |
| Real-time Search                                                                        | About 10 req/min (user-level cap 10/min)                                                                                                                                                                                                                   | Low; also Marketplace or internal only                                                                                                                                     |
| `users.profile.set`                                                                     | 10/user/min; 30 profiles/min/token                                                                                                                                                                                                                         | n/a                                                                                                                                                                        |
| Socket Mode                                                                             | ≤ 10 connections                                                                                                                                                                                                                                           | n/a (HTTP recommended)                                                                                                                                                     |
| Free plan                                                                               | **90 days** of visible history; content older than **1 year deleted**; no Lists, no user groups, canvases only in channels and DMs, Slack Connect 1:1 only; 10 apps max                                                                                    | Many small companies are on Free                                                                                                                                           |

Notes:

1. **The changelog page has changed over time.** It now says "The new rate limits will not be applied to existing installations of unlisted, distributed applications". Earlier versions, visible in search snippets, gave enforcement dates for existing installs of 2025-09-02 and later 2026-03-03. Mycel would be a _new_ app with _new_ installs, so the limit applies either way.
2. **Unclear:** whether Mycel installed in its own workspace counts as "internal customer-built" once public distribution is switched on. The docs don't say. A separate, undistributed app for dogfooding keeps us clearly exempt.

## 7. Nango

- **Provider exists:** `slack`.
  - OAuth redirect: `https://api.nango.dev/oauth/callback`.
  - The proxy is at `api.nango.dev/proxy/...`.
  - Prebuilt syncs: channels, messages-received, users, conversations.
  - About 57 prebuilt actions (post message, create or archive channel, lookup by email, streaming). Nango documents `start-stream` as DM-only.
- **Bot vs user tokens:**
  - Nango **uses the bot token by default.**
  - The user token is at `connection.credentials.raw.authed_user?.access_token`.
  - To call as the user through the proxy, set the header `nango-proxy-authorization: Bearer <userToken>`.
  - User scopes are requested with `user_scopes` in `createConnectSession`.
  - With rotation enabled, "Nango automatically refreshes both the bot token and the user token".
  - Implication: a member-connection adapter must always pass the user token explicitly. If it forgets, Mycel silently acts **as the bot**.
  - The user token also ends up in Nango's raw credentials, so Mycel code must not log the raw connection.
- **Webhooks:**
  - Point the Slack app's Event Subscriptions Request URL at Nango's webhook URL. Nango answers `url_verification` itself.
  - Nango "extracts the team_id from the payload and matches the event to the correct connection" and forwards it.
  - If it can't match, "the raw Slack payload is forwarded as-is — without the Nango wrapper". Mycel must parse both shapes (Zod).
  - **Gotcha:** routing is by `team_id`. With several member connections in one workspace (plus an org connection), it is unclear which connection Nango picks. Slack itself sends one event per workspace, not per user. Mycel will probably need to fan out itself, using `authorizations` / `apps.event.authorizations.list`. That method needs an app-level `xapp-` token, which Nango doesn't manage, so Mycel would hold it as config.
- **Interactivity:** Nango's Slack docs cover Events API webhooks only. Block Kit interactivity payloads (Option B) would go to a Mycel route handler, verified with the Slack signing secret.

## 8. Gaps and gotchas

- **No draft or pending primitive.** See §3. Every `external_send` needs a designed form, and only B and C fail closed.
- **Discovery is weak and restricted:**
  - Non-Marketplace history reads are throttled to 1/min and 15 messages.
  - The ToS bans LLM training on API data and "bulk export [of] Slack message and file data except where expressly allowed".
  - Real-time Search (the sanctioned search route) forbids storing or copying results and isn't available to unlisted apps.
  - Mycel's pointers-plus-derived-facts model (invariant 8) fits the spirit. The ToS ban on "persistent copies, archives, indexes" is scoped to the Data Access and Real-time Search APIs, but storing embeddings of Slack messages is a grey area to raise in Marketplace security review.
- **Marketplace dependency:**
  - Commercial distribution needs Marketplace listing, or a separate agreement with Slack.
  - Listing needs 10 active installs _before_ review and up to about 10 weeks of review.
  - `search:read` is banned, so search must use Real-time Search, whose bot use needs a user-triggered `action_token`.
  - Plan for a pilot phase run as single-customer internal apps, or a Slack partnership.
- **Bots are blind** to channels they haven't joined. Workflows that watch a channel need the bot invited, or `channels:join` (public only).
- **Member-connection events are deduplicated per workspace,** not per user. See §4 and §7.
- **Plan-gated features:** Lists, user groups, standalone canvases and Slack Connect invites need paid plans. Free plans hide history older than 90 days and delete content after 1 year.
- **Deprecated or retired:** reminders and stars (from 2023); `files.upload` (sunset 2025-11-12); `search.messages` (legacy); `assistant_view` (Feb 2027).
- **Ephemeral messages** are unreliable, as Slack says ("delivery is not guaranteed"). Don't use them as a pending form.
- **Can't read canvas content** through a documented method, so a canvas can't serve as a pending form that Mycel re-fetches.
- **`chat.update` and `chat.delete`** only work on the token-owner's own messages. Mycel can't edit or recall a message the person sent by hand.

## Sources

- Rate limit changes for non-Marketplace apps (2025-05-29, updated): https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps
- Clarifying rate limits (2025-06-03): https://docs.slack.dev/changelog/2025/06/03/rate-limits-clarity
- API ToS updates changelog (2025-05-29): https://docs.slack.dev/changelog/2025/05/29/tos-updates
- Slack API Terms of Service (effective 2025-10-10): https://slack.com/terms-of-service/api
- Rate limits: https://docs.slack.dev/apis/web-api/rate-limits
- Methods index: https://docs.slack.dev/reference/methods
- Scopes: https://docs.slack.dev/reference/scopes
- conversations.history: https://docs.slack.dev/reference/methods/conversations.history
- conversations.replies: https://docs.slack.dev/reference/methods/conversations.replies
- chat.postMessage: https://docs.slack.dev/reference/methods/chat.postMessage
- chat.update: https://docs.slack.dev/reference/methods/chat.update
- chat.delete: https://docs.slack.dev/reference/methods/chat.delete
- chat.postEphemeral: https://docs.slack.dev/reference/methods/chat.postEphemeral
- chat.scheduleMessage: https://docs.slack.dev/reference/methods/chat.scheduleMessage
- chat.scheduledMessages.list: https://docs.slack.dev/reference/methods/chat.scheduledMessages.list
- chat.deleteScheduledMessage: https://docs.slack.dev/reference/methods/chat.deleteScheduledMessage
- Stars and reminders retirement (2023-07): https://docs.slack.dev/changelog/2023-07-its-later-already-for-stars-and-reminders
- reminders.add: https://docs.slack.dev/reference/methods/reminders.add
- conversations.create: https://docs.slack.dev/reference/methods/conversations.create
- conversations.archive: https://docs.slack.dev/reference/methods/conversations.archive
- conversations.inviteShared: https://docs.slack.dev/reference/methods/conversations.inviteShared
- files.upload (sunset 2025-11-12): https://docs.slack.dev/reference/methods/files.upload
- Canvases: https://docs.slack.dev/surfaces/canvases
- canvases.create: https://docs.slack.dev/reference/methods/canvases.create
- Lists API changelog (2025-09-02): https://docs.slack.dev/changelog/2025/09/02/list-api
- slackLists.create: https://docs.slack.dev/reference/methods/slackLists.create
- usergroups.create: https://docs.slack.dev/reference/methods/usergroups.create
- users.profile.set: https://docs.slack.dev/reference/methods/users.profile.set
- search.messages: https://docs.slack.dev/reference/methods/search.messages
- assistant.search.context: https://docs.slack.dev/reference/methods/assistant.search.context
- Real-time Search API: https://docs.slack.dev/apis/web-api/real-time-search-api
- Handling user interaction: https://docs.slack.dev/interactivity/handling-user-interaction
- Agent updates (2026-08-20): https://docs.slack.dev/changelog/2026/08/20/agent-updates
- Events API: https://docs.slack.dev/apis/events-api/
- message.im event: https://docs.slack.dev/reference/events/message.im
- tokens_revoked event: https://docs.slack.dev/reference/events/tokens_revoked
- apps.event.authorizations.list: https://docs.slack.dev/reference/methods/apps.event.authorizations.list
- Socket Mode: https://docs.slack.dev/apis/events-api/using-socket-mode
- Tokens: https://docs.slack.dev/authentication/tokens
- Installing with OAuth: https://docs.slack.dev/authentication/installing-with-oauth
- auth.revoke: https://docs.slack.dev/reference/methods/auth.revoke
- Distribution: https://docs.slack.dev/app-management/distribution
- Marketplace review guide: https://docs.slack.dev/slack-marketplace/slack-marketplace-review-guide
- Marketplace guidelines and requirements: https://docs.slack.dev/slack-marketplace/slack-marketplace-app-guidelines-and-requirements
- Marketplace install requirement (2026-09-01): https://docs.slack.dev/changelog/2026/09/01/slack-marketplace-install-requirement
- Free plan limitations (Help Center): https://slack.com/help/articles/7050776459923-Feature-limitations-on-the-free-version-of-Slack
- App approval (Help Center): https://slack.com/help/articles/222386767-Manage-app-approval-for-your-workspace
- Nango Slack: https://nango.dev/docs/api-integrations/slack
- Nango Slack user access tokens: https://nango.dev/docs/api-integrations/slack/slack-user-access-tokens
- Nango Slack webhooks: https://nango.dev/docs/api-integrations/slack/webhooks
- Nango Slack OAuth app setup: https://nango.dev/docs/api-integrations/slack/how-to-register-your-own-slack-api-oauth-app
