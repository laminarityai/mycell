# Google: Gmail, Calendar, Tasks, Contacts (People API)

Researched 2026-10-21 against Google's and Nango's own docs. "Docs silent" means I looked and the vendor doesn't say.

## Where Mycel stands today (one Google connection)

**What the one `google` Nango integration asks for** (`app/src/features/connections/types.ts` `GOOGLE_APP_SCOPES`, `docs/architecture.md` "Adding an app"): `gmail.modify`, `drive.readonly`, `spreadsheets`, `calendar.events`, `documents`, `tasks`. **Nothing for Contacts.** Mycel's OAuth app is **Internal** (architecture.md, "dogfood with an Internal OAuth app").

**Catalog today** (`app/src/features/policy/catalog.ts`): `google-mail.read-message`, `google-mail.read-thread`, `google-mail.add-label`, `google-mail.create-draft` (external_send, pending form = Gmail draft), and two Sheets actions. Discovery polls Gmail with `history.list?historyTypes=messageAdded` (`features/discovery/lib/gmail/connector.ts`) and leaves out DRAFT/SPAM/TRASH.

**Scope classes** (Google's own tables):

| Scope                                                                            | Class                                                                                                                                  | Granted today? | What it unlocks beyond today                                                                             |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------- |
| `gmail.modify`                                                                   | restricted                                                                                                                             | yes            | read, label, trash, draft, send, history, watch, read sendAs/vacation/filters                            |
| `gmail.settings.basic`                                                           | restricted                                                                                                                             | no             | create/delete filters, set vacation responder, set signature                                             |
| `gmail.settings.sharing`                                                         | restricted                                                                                                                             | no             | sendAs create, delegates, auto-forwarding: **all domain-wide-delegation only** (ruled out by non-goal 7) |
| `https://mail.google.com/`                                                       | restricted                                                                                                                             | no             | permanent delete (`messages.delete`, `batchDelete`)                                                      |
| `gmail.insert`                                                                   | restricted                                                                                                                             | no             | `messages.insert` / `import`                                                                             |
| `gmail.labels`                                                                   | non-sensitive                                                                                                                          | no             | labels only (narrower than modify)                                                                       |
| `gmail.send`                                                                     | sensitive                                                                                                                              | no             | send only                                                                                                |
| `calendar.events`                                                                | sensitive                                                                                                                              | yes            | events CRUD, `events.watch`, sync tokens on any calendar the user can reach                              |
| `calendar.freebusy` / `calendar.events.freebusy`                                 | **non-sensitive**                                                                                                                      | no             | `freebusy.query` (**`calendar.events` does not allow it**)                                               |
| `calendar.calendarlist.readonly`                                                 | non-sensitive                                                                                                                          | no             | list the user's calendars                                                                                |
| `calendar.settings.readonly`                                                     | non-sensitive                                                                                                                          | no             | time zone, default event length, autoAddHangouts                                                         |
| `calendar`                                                                       | restricted                                                                                                                             | no             | everything, including ACLs                                                                               |
| `tasks` / `tasks.readonly`                                                       | Google's Tasks pages give no class; ADR-0014 says sensitive                                                                            | yes (`tasks`)  | all of Tasks                                                                                             |
| `contacts`, `contacts.readonly`, `contacts.other.readonly`, `directory.readonly` | People API pages give no class (the Cloud console shows it when you add the scope). None are on Gmail's or Calendar's restricted lists | no             | Contacts                                                                                                 |

Sources: Gmail scopes [G1] (updated 2026-09-10), Calendar scopes [C1] (updated 2026-09-03), Tasks scopes [T3]. On the restricted-scope security assessment (CASA), Google's page says apps that reach restricted data through a third-party server need it every 12 months [X1]. Mycel already plans to do this before its first external customer (architecture.md). Every restricted scope added now is one more thing to justify at M10.

**Two Google-wide changes in 2026 that matter:**

- **Tiered quotas and planned billing (May 1, 2026).** Gmail allows 1,200,000 units/min per project, 6,000 units/min per user, and **80,000,000 units/day per project before charges**. Projects created on or after May 1, 2026 get the new quotas; projects that used the API between Nov 2025 and Apr 2026 keep their old ones. Google says "full billing details later in 2026 with at least 90 days' notice" [G9, G10]. Calendar's equivalent is 10,000 requests/min per project, 600/min per user, and 1,000,000 requests/day per project before charges [C9].
- **Gmail and Calendar MCP servers (preview April 2026).** From Nov 11, 2026, OAuth clients calling the MCP servers must be marked "agentic". REST callers like Mycel are unaffected [G10, C10].

---

## Gmail

### 1. Summary

In a small company, Gmail is the main inbox, the shared support@/sales@ inboxes, and the trail of every customer conversation. The workflows it most enables:

- **Triage and route.** Label, archive, escalate, or hand off new mail by intent (already M3).
- **Draft replies for approval.** Answer FAQs, quotes, and scheduling replies in-thread (M3/M5).
- **Extract to a sheet or task.** Turn an order, lead, or invoice email into a row or a task.
- **Follow up.** Notice a thread with no reply after N days and draft a nudge.
- **Out-of-office and auto-acknowledge.** Set the vacation responder, or send an "we got it" reply.

### 2. Capability table

Risk levels are proposals. **D** = destructive, **$** = financial (Gmail has no financial operations).

| Resource          | Operation                                                           | API method                                         | Proposed risk                               | Reaches others?                  | Notes                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Profile           | read account address, historyId                                     | `users.getProfile`                                 | read                                        | no                               | 1 unit                                                                                                                                                 |
| Messages          | search/list                                                         | `messages.list` (`q`, `labelIds`)                  | read                                        | no                               | 5 units                                                                                                                                                |
| Messages          | read                                                                | `messages.get` (`format=metadata/full/raw`)        | read                                        | no                               | 20 units, 60 for full/raw (new 2026 costs) [G9]                                                                                                        |
| Messages          | read attachment                                                     | `messages.attachments.get`                         | read                                        | no                               | returns base64url `data` and `size`, 20 units [G13]. Content stays in memory (invariant 8)                                                             |
| Threads           | list / read                                                         | `threads.list`, `threads.get`                      | read                                        | no                               | `threads.get` costs 40, or 120 with full [G9]                                                                                                          |
| Labels            | list / get                                                          | `labels.list`, `labels.get`                        | read                                        | no                               |                                                                                                                                                        |
| Labels            | create / rename / recolor                                           | `labels.create`, `labels.patch`                    | internal_reversible                         | no                               | max 10,000 labels per mailbox [G14]                                                                                                                    |
| Labels            | **delete label**                                                    | `labels.delete`                                    | **destructive (D)**                         | no                               | "permanently removes from all messages" [G14]. The messages survive, the labelling doesn't                                                             |
| Messages/threads  | add/remove labels, archive (remove `INBOX`), mark read/unread, star | `messages.modify`, `batchModify`, `threads.modify` | internal_reversible                         | no                               | You can't set `SENT` or `DRAFT` by hand [G14]                                                                                                          |
| Messages/threads  | trash / untrash                                                     | `messages.trash`, `threads.trash`, `untrash`       | internal_reversible (judgment call)         | no                               | Recoverable until Gmail empties Trash. Treat as `destructive` if bulk trashing should need a person                                                    |
| Messages          | **permanent delete**                                                | `messages.delete`, `batchDelete`                   | **destructive (D)**                         | no                               | "immediately and permanently deletes … cannot be undone". Needs `https://mail.google.com/` (restricted, not granted) [G11]. Recommend leaving it out   |
| Drafts            | create (new or reply in thread)                                     | `drafts.create`                                    | external_send (pending form)                | held                             | Already `google-mail.create-draft`                                                                                                                     |
| Drafts            | update / delete Mycel's own draft                                   | `drafts.update`, `drafts.delete`                   | internal (adapter-only)                     | no                               | `update` destroys the old message and replaces it [G2]                                                                                                 |
| Drafts            | **send**                                                            | `drafts.send`                                      | external_send (adapter approve)             | **yes**                          | 100 units. Body is a `Draft`, so you can send an updated message in the same call [G2, G3]                                                             |
| Messages          | send new / reply / forward directly                                 | `messages.send`                                    | external_send                               | **yes**                          | Should always go through a draft (pending form), never direct. Accepts `gmail.send` too [G12]                                                          |
| Messages          | insert/import into mailbox                                          | `messages.insert`, `messages.import`               | internal_reversible                         | no                               | needs `gmail.insert` (restricted). Low value                                                                                                           |
| History           | changes since a historyId                                           | `history.list`                                     | read (trigger)                              | no                               | 2 units. See Triggers                                                                                                                                  |
| Push              | start/stop mailbox watch                                            | `users.watch`, `users.stop`                        | read (infra)                                | no                               | 100 / 50 units                                                                                                                                         |
| Send-as           | list aliases and signatures                                         | `settings.sendAs.list/get`                         | read                                        | no                               | `gmail.modify` or `readonly` is enough [G15]                                                                                                           |
| Send-as           | send _from_ an existing alias                                       | `From:` header on the draft or message             | external_send                               | yes                              | Use only addresses `sendAs.list` returns. Docs don't say what happens with an unlisted address                                                         |
| Send-as           | update the signature on your own address                            | `settings.sendAs.patch`                            | internal_reversible (affects outgoing mail) | indirectly                       | needs `gmail.settings.basic` (restricted, not granted) [G16]                                                                                           |
| Send-as           | **create alias**                                                    | `settings.sendAs.create`                           | n/a                                         | —                                | "only available to service account clients that have been delegated domain-wide authority" [G17]. **Out: non-goal 7**                                  |
| Filters           | list / get                                                          | `settings.filters.list/get`                        | read                                        | no                               |                                                                                                                                                        |
| Filters           | create (label/archive) / delete                                     | `settings.filters.create/delete`                   | internal_reversible                         | no                               | No update method: delete and recreate. Max 1,000 filters. Needs `gmail.settings.basic` (restricted, not granted) [G18, G19]                            |
| Filters           | create **with `forward`**                                           | `filters.create` with `action.forward`             | **external_send, standing**                 | **yes, every match, forever**    | Only to an already-verified forwarding address [G20]. Adding one (`forwardingAddresses.create`) needs domain-wide delegation. Recommend leaving it out |
| Vacation          | read                                                                | `settings.getVacation`                             | read                                        | no                               | `gmail.modify` is enough [G21]                                                                                                                         |
| Vacation          | set or clear the auto-reply                                         | `settings.updateVacation`                          | **external_send (standing)**                | **yes**, auto-replies to senders | needs `gmail.settings.basic`. Has `restrictToContacts`, `restrictToDomain`, `startTime`/`endTime` [G22]                                                |
| Auto-forwarding   | update                                                              | `settings.updateAutoForwarding`                    | n/a                                         | —                                | domain-wide delegation only [G23]. Out                                                                                                                 |
| Delegates         | list/create/delete                                                  | `settings.delegates.*`                             | n/a                                         | —                                | **domain-wide delegation only**, including `list` [G24, G25]. Out (non-goal 7)                                                                         |
| IMAP/POP/language | get/update                                                          | `settings.*`                                       | —                                           | —                                | not useful for workflows                                                                                                                               |

### 3. Pending form

- **Reply, new mail, forward → a Gmail draft (built).** This confirms M5's adapter design:
  - prepare = `drafts.create`, with `message.threadId` plus RFC 2822 `In-Reply-To`/`References` headers and a matching `Subject`. All three are required for the message to join the thread [G26].
  - approve = `drafts.send`. You can skip `drafts.update` + `drafts.send` and do one call: `drafts.send` takes a whole `Draft` resource, so "to modify a draft while sending, you supply a drafts resource in the request body of drafts.send" [G2].
  - decline = `drafts.delete`.
  - check = `drafts.get` (404 means it was sent or deleted), then `threads.get` looking for a `SENT` message.
- **Vacation responder: none native. Needs a design.** There's one responder per account, and a write replaces the person's own settings. One option: prepare reads and keeps the current settings in memory only, and holds the change as a Mycel-only proposal; approve writes it. That bends ADR-0013, which wants an in-app pending form.
- **Forwarding filter:** recommend not offering it.
- **Send from alias:** same draft form, with the `From:` header set.

### 4. Triggers

- **Polling (current):** `history.list` from a stored `historyId`. Types: `messageAdded`, `messageDeleted`, `labelAdded`, `labelRemoved`, plus a `labelId` filter, max 500 per page [G4].
  - A historyId stays valid "for at least a week, but in some rare circumstances may be valid for only a few hours". An invalid one returns **404**, which means do a full sync [G4, G6]. Discovery already does this.
  - Creating a draft and each `drafts.update` show up as `messageAdded` with `DRAFT`, because updates destroy and replace the message [G2]. Discovery already filters `DRAFT`.
- **Push:** `users.watch` sends to a Cloud Pub/Sub topic. `gmail-api-push@system.gserviceaccount.com` needs Publisher on that topic [G5, G7].
  - Filter with `labelIds` + `labelFilterBehavior` (`include`/`exclude`). The older `labelFilterAction` is deprecated [G7].
  - The payload is only `{emailAddress, historyId}`, so you still call `history.list`.
  - Renew at least every 7 days; Google recommends daily.
  - Max **1 notification/sec per user**. "The service drops any user notifications exceeding that rate", so keep a polling fallback [G5].
  - Latency isn't stated; in practice it's seconds (unverified).
- **Nango and push:** Nango's documented Gmail webhook path:
  1. A Pub/Sub push subscription posts to Nango's webhook URL.
  2. OIDC auth must be on, or "Nango rejects a push that arrives with no Authorization header".
  3. Nango matches `emailAddress` to `connection_config.emailAddressHash` and forwards it [N2].

  That guide is written for the **`google-mail`** provider. Mycel uses the generic **`google`** integration, and Nango's `google` page says nothing about webhooks [N3]. Safer plan: point the Pub/Sub push subscription at a Mycel route handler (webhooks are an allowed route-handler use), verify the OIDC JWT, and look up the connection by `accountEmail`.

### 5. Verifying spec #51's two open facts

1. **`drafts.send` keeps the thread and returns a new message ID: confirmed, with one condition.**
   - The drafts guide says: "When the draft is sent, the draft is automatically deleted and a new message with an updated ID is created with the `SENT` system label" [G2].
   - `drafts.send` returns a `Message` [G3].
   - Thread membership is decided when the draft's message is created or updated: `threadId` on the `Draft.Message`, RFC 2822 `References`/`In-Reply-To`, and a matching `Subject` [G26]. If any `drafts.update` or edited send drops `threadId`, or changes the Subject (say, an edit adds "Re: Re:"), the message leaves the thread.
   - So the adapter must re-supply `threadId` and the headers on every update and edited send. The fake Gmail's "send adds a new ID in the same thread" matches the docs.
2. **Does `history.list` report a draft sent from the Gmail UI as `messageAdded` with `SENT`? The docs don't say for UI sends.**
   - The history reference lists only the four change types [G4].
   - The only relevant documented behaviour is the drafts guide sentence above: sending deletes the draft and creates a _new_ message with `SENT`. If the UI works the same way, history shows `messageDeleted` (the draft) and `messageAdded` (a new ID with `SENT`), which is what discovery's `email.sent` path needs. That's implied, not stated.
   - Recommendation: don't rely on the event alone. When an `email.sent` lands in a thread with a waiting review, run the adapter's `check` (`drafts.get` 404 + `threads.get` has a newer `SENT` message), as M5 already plans.
   - Prove it once in dogfood: send a Mycel draft from the Gmail UI and look at the raw history page.
   - Related UI features the docs don't cover at all: **Schedule send** (the draft leaves Drafts but isn't `SENT` yet, so `check` might say `gone` too early) and **Undo send**. Test both.

### 6. Auth

- Today: `gmail.modify` (restricted) covers every read/label/draft/send/history/watch row above, plus reading sendAs, vacation, and filters.
- New scope needed for: filters, vacation writes, and signatures (`gmail.settings.basic`, restricted); permanent delete (`mail.google.com`, restricted, recommend never).
- Never possible under Mycel's rules: aliases, delegates, auto-forwarding (domain-wide delegation, non-goal 7).

### 7. Limits

- API quotas above [G9]. History is cheap (2 units). `drafts.send` and `messages.send` cost 100. 6,000 units/min/user allows about 60 sends/min/user.
- **Sending limits (Workspace), which bite before API quota:**
  - 2,000 messages/day per user (500 on trial accounts);
  - 10,000 total recipients/day, 3,000 external;
  - 2,000 unique external recipients/day (500 on trial);
  - 2,000 recipients per message (max 500 external).
  - Going over suspends sending for up to 24 h [G27].

### 8. Nango

- A `google-mail` provider exists with 50+ pre-built functions: drafts, labels, filters, vacation, watch [N1]. Mycel only uses Nango's proxy through its own `google` integration.
- Nango's docs carry no "add scopes to an existing connection" guide (spec #51's third open fact). Mycel's reconnect flow already handles it.

### 9. Gaps and gotchas

- **Signatures:** the docs don't say whether API-created drafts get the user's signature. Assume they don't: read `sendAs.signature` (allowed by `gmail.modify`) and append it in the step.
- **Schedule send, Undo send, confidential mode, snooze:** none appear in the REST reference.
- **Delegated mailboxes** (an assistant working in a boss's inbox) can't be listed or set without domain-wide delegation.
- **No server-side "send later":** a workflow wanting a timed send has to send it itself, after approval, at that time.
- **Labels:** `labels.delete` removes the label everywhere at once. That's a stronger effect than its name suggests.

---

## Google Calendar

### 1. Summary

Calendar holds every person's meetings, out-of-office, and working location. Booked appointments also land here as ordinary events. The workflows it most enables:

- **Book after an email.** Find a free slot and create the meeting with guests, after approval.
- **Act on invites.** Draft a reply to a new invite, flag clashes, or decline outside hours after approval.
- **Prepare for meetings.** Before a meeting with an external guest, pull the email thread or CRM row into a doc or task.
- **Status.** Set out-of-office when the vacation responder is on, or mirror a working location.
- **Reschedule or cancel** with notice.

### 2. Capability table

| Resource              | Operation                                                | API method                                                                            | Proposed risk                                                                                  | Reaches others?                                                   | Notes                                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Events                | list / search a window                                   | `events.list` (`timeMin/timeMax`, `q`, `singleEvents`, `eventTypes`)                  | read                                                                                           | no                                                                | `calendar.events` is enough [C3]                                                                                                                                                               |
| Events                | read one / instances of a recurring event                | `events.get`, `events.instances`                                                      | read                                                                                           | no                                                                |                                                                                                                                                                                                |
| Free/busy             | own or others' busy blocks                               | `freebusy.query`                                                                      | read                                                                                           | no (reads others' availability)                                   | **Needs `calendar.freebusy`, `calendar.events.freebusy`, `calendar.readonly` or `calendar`. `calendar.events` is not accepted** [C2]. Up to 50 calendars, and up to 100 members per group [C2] |
| Calendars             | list subscribed calendars                                | `calendarList.list`                                                                   | read                                                                                           | no                                                                | **Not allowed by `calendar.events`.** Needs `calendar.calendarlist(.readonly)`, `calendar.readonly` or `calendar` [C11]                                                                        |
| Settings              | time zone, default length, autoAddHangouts               | `settings.get/list`                                                                   | read                                                                                           | no                                                                | needs `calendar.settings.readonly` (non-sensitive). **Working hours aren't exposed** [C12]                                                                                                     |
| Events                | create on own calendar, no guests                        | `events.insert`                                                                       | internal_reversible                                                                            | no (but see visibility below)                                     |                                                                                                                                                                                                |
| Events                | **create with guests**                                   | `events.insert` / `patch` with `attendees`                                            | **external_send**                                                                              | **yes**                                                           | "When you include attendees in an event, it automatically appears on their primary calendars", even with no email notification [C5]                                                            |
| Events                | edit an event that has guests (time, place, description) | `events.patch` + `sendUpdates`                                                        | **external_send**                                                                              | **yes**                                                           | Patch replaces array fields whole [C13]. Patch costs 3 quota units [C13]                                                                                                                       |
| Events                | **cancel/delete an event that has guests**               | `events.delete` + `sendUpdates`                                                       | **destructive (D) + external_send**                                                            | **yes**                                                           | Docs don't say what happens to guests' copies [C14]                                                                                                                                            |
| Events                | delete own guest-less event                              | `events.delete`                                                                       | internal_reversible (judgment)                                                                 | no                                                                | No undelete in the API                                                                                                                                                                         |
| Events                | RSVP to an invite                                        | `events.patch` on the `attendees[]` entry with `self:true` (`responseStatus`)         | **external_send**                                                                              | **yes**, the organizer sees it                                    | No pending form (see 3)                                                                                                                                                                        |
| Events                | move to another calendar                                 | `events.move`                                                                         | internal_reversible                                                                            | depends                                                           |                                                                                                                                                                                                |
| Events                | quick add from text                                      | `events.quickAdd`                                                                     | internal_reversible                                                                            | no                                                                |                                                                                                                                                                                                |
| Conference            | add a new Meet link                                      | `events.insert/patch` with `conferenceDataVersion=1` + `conferenceData.createRequest` | part of the event's risk                                                                       | via the event                                                     | Created asynchronously, so status can be `pending` first [C5]. Google (Feb 2026) warns against reusing Meet codes across events: always `createRequest` [C10]                                  |
| Attachments           | attach Drive files                                       | `supportsAttachments=true`                                                            | part of the event                                                                              | via the event                                                     | Max 25. Google says do a full sync before turning it on for existing apps [C5, C4]                                                                                                             |
| Status                | out-of-office (auto-declines)                            | `events.insert` with `eventType:outOfOffice` + `outOfOfficeProperties`                | **external_send** if `autoDeclineMode` declines others' invites; otherwise internal_reversible | yes (auto-decline notices)                                        | Primary calendar only, "and to some Google Calendar users". Timed events only, no batch [C6]                                                                                                   |
| Status                | working location / focus time                            | `eventType: workingLocation / focusTime`                                              | internal_reversible                                                                            | colleagues see it (working location must be `visibility: public`) | same restrictions [C6]                                                                                                                                                                         |
| Event types           | read birthday / fromGmail events                         | `eventTypes` filter                                                                   | read                                                                                           | no                                                                | `fromGmail` (flights, reservations) has limited editable fields (May 2024). `birthday` is linked to People (Nov 2024) [C10]                                                                    |
| Labels                | custom event labels/colors                               | `eventLabelId`, `labelProperties`                                                     | internal_reversible                                                                            | no                                                                | new July 2026 [C10]                                                                                                                                                                            |
| ACL / sharing         | share a calendar                                         | `acl.*`                                                                               | —                                                                                              | yes                                                               | needs `calendar.acls` (restricted). Recommend leaving it out                                                                                                                                   |
| Appointment schedules | create/read booking pages                                | **none**                                                                              | —                                                                                              | —                                                                 | The Calendar v3 reference has no booking-page resource. Bookings appear only as normal events (inferred from the resource list [C4])                                                           |
| Push                  | watch events/calendarList/settings/acl                   | `events.watch` etc.                                                                   | read (infra)                                                                                   | no                                                                | see Triggers                                                                                                                                                                                   |

### 3. Pending form

- **Create a meeting with guests:** an event with no guests, on the person's calendar (spec #67's design). It holds up against the docs:
  - prepare = `events.insert`, no `attendees`, `sendUpdates=none` (harmless with no guests);
  - approve = `events.patch` with `attendees` + `sendUpdates=all` (or `externalOnly`);
  - decline = `events.delete`;
  - check = `events.get`. `attendees` present means `done_in_app`; 404 or `status: cancelled` means `gone`.
  - For exactly-once on retry: `get` before `patch`, and skip if the attendees are already there. The docs don't say whether re-patching the same attendees with `sendUpdates=all` emails them again.
- **Reschedule or edit an event that already has guests: none native. Needs a design.** You can't "hold" an edit in Calendar. One option: create a guest-less "proposed" copy at the new time, and on approve patch the real event and delete the copy.
- **RSVP / decline an invite: none native. Needs a design.** Any `responseStatus` change, `tentative` included, reaches the organizer. Possible native stand-in: a Gmail draft reply to the invite email (only when the invite arrived by mail).
- **Cancel an event with guests: none native.** Needs a design, or don't offer it.
- **Out-of-office with auto-decline:** create with `autoDeclineMode` set to not decline while waiting, then patch it on approve. Docs don't say whether `autoDeclineMode` can be changed by patch on an existing event. Needs a check.

### 4. Is a guest-less event visible to anyone else? Yes, potentially. It depends on sharing settings, not on guests.

- What other people see of a calendar comes from its ACL plus the event's `visibility` [C7]:
  - `freeBusyReader` sees a busy block only;
  - `reader` sees details unless the event is `private`;
  - `writer` and `owner` see everything, private events too;
  - the new `writerWithoutPrivateAccess` (GA June 29, 2026) sees private events as busy blocks [C10].
- In Workspace the admin sets the org-wide default for primary calendars: "No sharing", "Only free/busy information", or "Share all information". Users can override it. With "Share all information", colleagues "find details for all events except those marked as private" [C8].
- Admins can also have special access to all event details [C15].
- So a waiting guest-less event:
  - shows as **busy to anyone with free/busy access**, including colleagues' "Find a time";
  - shows **with its title and description** to anyone with reader access when visibility is `default`;
  - is visible in full to delegates or assistants with writer access.
- **Recommendation:** prepare with `visibility: "private"`. That hides details from readers; only writer and above see them. Optionally also `transparency: "transparent"`, so it doesn't block time [C4]. Approve patches both back to the spec's values. This deserves a line in ADR-0013's Calendar part.

### 5. Triggers

- **Polling:** `events.list?syncToken=…` on `primary`.
  - Can't be combined with `iCalUID`, `orderBy`, `privateExtendedProperty`, `q`, `sharedExtendedProperty`, `timeMin`, `timeMax`, `updatedMin` [C3].
  - Google says "each list request should use the same set of query parameters, including the initial request". Breaking the rule gives 400 [C16].
  - An expired or invalid token gives **410 GONE** (`fullSyncRequired`, or `updatedMinTooLongAgo` for updatedMin). Wipe local state and do a full sync [C16, C17].
  - Deleted events come back as `status: cancelled` in incremental results [C16].
  - Docs give no TTL for the token.
- **Push:** `events.watch` (also on `calendarList`, `settings`, `acl`).
  - Needs an HTTPS address with a valid certificate.
  - Default TTL is 604,800 s (7 days); docs give no max. No auto-renew: create a new channel with a new `id`.
  - Headers only (`X-Goog-Resource-State` `sync` / `exists` / `not_exists`), so you then run a sync-token list [C18, C19].
  - `eventTypes` filter on watch since Feb 2024 [C10].
  - Nango forwards Calendar notifications and matches the connection by `connection_config.emailAddressHash` from `X-Goog-Resource-URI`. That's documented for the `google-calendar` provider; the generic `google` provider is undocumented [N4, N3].
- **Calendar quota:** a 1-minute poll per connection is 1,440 requests/day/user. That's far under 600/min/user, but at the 1,000,000/day/project billing threshold it's roughly 690 connections [C9].

### 6. Spec #67 checked against today's docs (Calendar and Tasks)

1. **`google-calendar.find-free-time` doesn't work with the scope Mycel asks for.** `freebusy.query` accepts only `calendar.readonly`, `calendar`, `calendar.events.freebusy`, `calendar.freebusy`, and **not `calendar.events`** [C2]. Pick one:
   - (a) add `calendar.events.freebusy` or `calendar.freebusy`. Both are **non-sensitive**, so no extra verification burden. This means one reconnect, against ADR-0014's "no second round", but it's cheap.
   - (b) compute free time from `events.list` on the person's own `primary` calendar (`singleEvents=true`, skip `transparent` and declined events). Own calendar only, no colleagues.

   Even with (a), colleagues' availability only shows if their calendars share at least free/busy with the person. Under the admin setting "No sharing" they don't [C8].

2. **Its claim that guest-less events are private is too strong.** See section 4. Prepare with `visibility: private` (and maybe `transparent`).
3. **The invite trigger will miss some invites.** A person's "Add invitations to my calendar" setting can be "Only if the sender is known" or "When I respond to the invitation in email". Then an invite from an unknown sender is **not on the calendar**; "you get an invitation email" instead [C20]. Also handle these cases:
   - `fromGmail` events (no real invite);
   - `attendeesOmitted`;
   - the person's own entry (`self: true`) with `responseStatus: needsAction`;
   - cancelled events in the incremental stream.

   Consider a second path: the Gmail invite email (`text/calendar` part) through the existing Gmail trigger.

4. **"Video-call links beyond what Calendar adds by default"**: a user setting `autoAddHangouts` exists [C12], but the docs don't say it applies to API-created events, and Meet is otherwise added only with `conferenceDataVersion=1` + `createRequest` [C5]. Assume **nothing** is added by default. If meetings should have Meet links, `create-event` needs an explicit option.
5. **`sendUpdates=none` warning** (still current): "can have significant adverse effects, including events not syncing to external calendars or events being lost altogether for some users" [C3-insert]. It's harmless at prepare (no guests). Never use `none` when guests change.
6. **Calendar `events.watch` is out of scope in the spec.** Fine. Note Nango's routing caveat (generic `google` provider) if it's revisited.
7. **Tasks:** see the Tasks section's corrections (assigned tasks reach other people; `@default` isn't in the reference; due dates have no time).
8. **Docs (outside my apps, checked in passing):** the spec's "`writeControl` in suggest mode" now exists. `WriteControl.writeMode` is `EDIT` | `SUGGEST`, and responses carry a `SuggestionResponse` (reference updated 2026-10-09) [D1]. The spec is right; the Docs researcher should confirm the details.

### 7. Auth

- Today: `calendar.events` (sensitive) covers events read/write/watch/sync on all the user's calendars.
- New scope needed for: free/busy (`calendar.events.freebusy` or `calendar.freebusy`, non-sensitive); list calendars (`calendar.calendarlist.readonly`, non-sensitive); settings such as time zone (`calendar.settings.readonly`, non-sensitive); sharing (`calendar.acls`, restricted, don't).
- If Mycel only ever writes to the person's own calendars, `calendar.events.owned` (sensitive) is narrower than `calendar.events` [C1].

### 8. Limits

- 10,000 req/min per project; 600 req/min per user.
- 1,000,000 req/day per project before planned charges (since May 2026).
- 403/429 `usageLimits`; `quotaExceeded` "Calendar usage limits exceeded" is anti-abuse, not quota [C9, C17].
- 25 attachments per event [C4]. `freebusy`: 50 calendars [C2].
- The docs don't give an invite-volume limit. Workspace anti-abuse limits on guests and invites exist but aren't stated in the API docs.

### 9. Nango

A `google-calendar` provider exists with pre-built actions and syncs, and a webhook guide (Nango receives and forwards notifications; you create and renew channels yourself, with a sync template for daily renewal) [N4, N5]. Mycel's generic `google` integration proxies Calendar fine. Webhook routing for it is undocumented.

### 10. Gaps and gotchas

- **Appointment schedules** (booking pages) have **no API**. You can only read the resulting events.
- **Working hours** aren't in `settings`.
- **Status events** (OOO, working location, focus) are "only available on primary calendars, and to some Google Calendar users" [C6]. Expect errors on non-Workspace accounts.
- **Recurring events:** making one instance more restrictive now changes **all** instances; making it less restrictive is rejected (July 2026) [C7, C10].
- **`eventType` can't be changed** after creation [C3-insert].

---

## Google Tasks

### 1. Summary

Each person's to-do list, also fed by tasks assigned in Docs and Chat. The workflows it enables:

- turn an email or request into a follow-up task;
- daily or weekly task digests;
- close a task when its email is answered;
- push Sheets rows into tasks.

### 2. Capability table

| Resource   | Operation                                                 | API method                                                                                                                                             | Proposed risk                                      | Reaches others?            | Notes                                                                                                                                                                                              |
| ---------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task lists | list / get                                                | `tasklists.list/get`                                                                                                                                   | read                                               | no                         |                                                                                                                                                                                                    |
| Task lists | create / rename                                           | `tasklists.insert/patch/update`                                                                                                                        | internal_reversible                                | no                         | title max 1,024 chars [T5]                                                                                                                                                                         |
| Task lists | **delete list**                                           | `tasklists.delete`                                                                                                                                     | **destructive (D)**                                | no                         | deletes every task in it                                                                                                                                                                           |
| Tasks      | list / get                                                | `tasks.list` (`updatedMin`, `dueMin/Max`, `completedMin/Max`, `showCompleted`, `showDeleted`, `showHidden`, `showAssigned`, max 100/page), `tasks.get` | read                                               | no                         | **Assigned tasks are left out unless `showAssigned=true`** [T2]                                                                                                                                    |
| Tasks      | create (incl. subtask via `parent`, order via `previous`) | `tasks.insert`                                                                                                                                         | internal_reversible                                | no                         | Max 20,000 non-hidden tasks per list, 100,000 in total. Assigned tasks can't be parents or children [T4]                                                                                           |
| Tasks      | update / complete                                         | `tasks.patch`, `tasks.update`                                                                                                                          | internal_reversible, **except for assigned tasks** | **yes for assigned tasks** | Since July 2024 the API can "get, edit, and delete tasks assigned from Google Docs documents or Chat spaces" [T6]. Completing one is visible where it was assigned. Field is `assignmentInfo` [T1] |
| Tasks      | move / reorder                                            | `tasks.move`                                                                                                                                           | internal_reversible                                | no                         |                                                                                                                                                                                                    |
| Tasks      | **delete**                                                | `tasks.delete`                                                                                                                                         | **destructive (D)** (judgment)                     | yes if assigned            | A `deleted` flag and `showDeleted` exist [T1, T2]. Docs don't say how to undelete                                                                                                                  |
| Tasks      | clear completed (hide)                                    | `tasks.clear`                                                                                                                                          | internal_reversible                                | no                         | sets `hidden` [T1]                                                                                                                                                                                 |
| Tasks      | create assigned tasks                                     | n/a                                                                                                                                                    | —                                                  | —                          | "Tasks from Docs or Chat cannot be inserted via the API" [T4]                                                                                                                                      |

### 3. Pending form

None needed for the person's own unassigned tasks, which are internal. For an assigned task (`assignmentInfo` present), an update or delete reaches the assigner. There's no pending form, so **refuse assigned tasks** in `update-task` or treat them as external_send. That needs a design.

### 4. Triggers

- **No push** in the Tasks API, and no sync token. Poll `tasks.list?updatedMin=<last>&showDeleted=true&showHidden=true` (+`showAssigned=true`) per list.
- Docs are silent on how far back `updatedMin` can go.

### 5. Auth

`tasks` (granted) or `tasks.readonly` [T3]. Google's Tasks auth page gives no sensitivity class. ADR-0014 treats `tasks` as sensitive.

### 6. Limits

"Courtesy limit of 50,000 queries per day" (project). No per-minute or per-user numbers are published [T7].

### 7. Nango

A `google-tasks` provider exists, with an OAuth-app guide [N6]. Mycel proxies `/tasks/` on `tasks.googleapis.com` already (`lib/google.ts`).

### 8. Gaps, gotchas, and corrections to spec #67

- **`due` is a date only:** "The time portion of the timestamp is discarded when setting this field" [T1]. A workflow can't set a task "due at 3pm".
- **"The person's default list":** `@default` isn't in the Tasks REST reference I read. It appears only in Google's Ads Scripts example [T8]. Safer: `tasklists.list` and take the first list, or store the list ID at connect.
- **Assigned tasks** (above) break the spec's "low-risk, own list only" assumption unless they're filtered out.
- The docs don't say whether `notes` ("Added by <workflow>") is shown on assigned tasks or in Docs/Chat.
- `webViewLink` gives a deep link for a review or run record [T1].

---

## Google Contacts (People API)

### 1. Summary

Each person's saved contacts, their auto-collected "Other contacts", and the Workspace directory. The workflows it enables:

- add or update a contact from a new lead's email signature;
- enrich a CRM sheet with phone and company;
- recognise a known customer vs a stranger in triage;
- tag contacts into groups (for example "Customers 2026");
- find a colleague's address from the directory.

### 2. Capability table

| Resource       | Operation                                         | API method                                                                          | Proposed risk           | Reaches others? | Notes                                                                                                                                  |
| -------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| My contacts    | list / sync                                       | `people.connections.list` (`personFields` required, `pageSize` ≤ 1000, `syncToken`) | read                    | no              | [P3]                                                                                                                                   |
| My contacts    | search                                            | `people.searchContacts`                                                             | read                    | no              | Send an empty-query warm-up first. Prefix match on names, nickNames, emailAddresses, phoneNumbers, organizations. Max 30 per page [P4] |
| My contacts    | get / batch get                                   | `people.get`, `people.getBatchGet`                                                  | read                    | no              | `people/me` profile is read-only [P2]                                                                                                  |
| My contacts    | create                                            | `people.createContact`, `batchCreateContacts` (≤ 200)                               | internal_reversible     | no              |                                                                                                                                        |
| My contacts    | update                                            | `people.updateContact` (needs `metadata.sources.etag`), `batchUpdateContacts`       | internal_reversible     | no              | etag guards against concurrent edits [P2]                                                                                              |
| My contacts    | **delete**                                        | `people.deleteContact`, `batchDeleteContacts`                                       | **destructive (D)**     | no              | Docs don't say whether deleted contacts go to Contacts' trash [P2]                                                                     |
| Photos         | update / delete                                   | `updateContactPhoto`, `deleteContactPhoto`                                          | internal_reversible / D | no              |                                                                                                                                        |
| Groups         | list / get                                        | `contactGroups.list/get/batchGet`                                                   | read                    | no              |                                                                                                                                        |
| Groups         | create / rename / add or remove members           | `contactGroups.create/update`, `contactGroups.members.modify`                       | internal_reversible     | no              | Names must be unique (409 otherwise) [P5]                                                                                              |
| Groups         | delete                                            | `contactGroups.delete`                                                              | destructive (D)         | no              |                                                                                                                                        |
| Other contacts | list / search                                     | `otherContacts.list/search`                                                         | read                    | no              | **Separate scope `contacts.other.readonly`.** Only `emailAddresses`, `metadata`, `names`, `phoneNumbers`, `photos` [P6, P7]            |
| Other contacts | promote to My Contacts                            | `otherContacts.copyOtherContactToMyContactsGroup`                                   | internal_reversible     | no              | needs `contacts` [P6]                                                                                                                  |
| Directory      | list / search domain profiles and shared contacts | `people.listDirectoryPeople`, `searchDirectoryPeople`                               | read                    | no              | `directory.readonly`. Workspace only. Supports `syncToken` [P8]                                                                        |

### 3. Pending form

None needed: nothing in the People API reaches another person.

### 4. Triggers

- **No push.** Poll `connections.list` with `requestSyncToken=true`, then `syncToken`.
- Tokens "expire 7 days after the full sync", and an expired one is an error (**410** in Google's sample) [P3, P2].
- "Writes may have a propagation delay of several minutes for sync requests. Incremental syncs are not intended for read-after-write use cases" [P3].
- `otherContacts.list` and `listDirectoryPeople` also support sync tokens (7 days for otherContacts) [P7, P8].

### 5. Auth (all new: the Google connection asks for none of these)

| Scope                     | Unlocks             | Class                                                                                                                     |
| ------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `contacts.readonly`       | read, search        | the People pages I could reach give no class; not on Gmail's or Calendar's restricted lists. Confirm in the Cloud console |
| `contacts`                | read and write      | same                                                                                                                      |
| `contacts.other.readonly` | Other contacts      | same                                                                                                                      |
| `directory.readonly`      | Workspace directory | same                                                                                                                      |

Adding Contacts means **a new scope and a reconnect for every member**, plus a new `GoogleApp` value (`contacts`) in `connections/types.ts`.

### 6. Limits

- Per-operation cost [P2]:
  - a single read or write costs 1 critical read + 1 critical write;
  - a batch of ≤ 200 costs 6 + 6, plus "200 Daily Contact Writes";
  - batch delete costs 10 write requests.
- Per-minute project/user numbers: the People "limits" page returned 404 on 2026-10-21. Unknown.
- "Mutate requests for the same user should be sent sequentially to avoid increased latency and failures" [P2]. Executors must serialise contact writes per connection.

### 7. Nango

Nango lists Google Contacts among its Google integrations (search result on nango.dev [N7]). Mycel would use its own `google` integration with the added scope, through the proxy (host `people.googleapis.com`, a new `API_HOSTS` entry).

### 8. Gaps and gotchas

- Other contacts are read-only and limited to a few fields.
- The directory is Workspace-only.
- Search needs a warm-up and does prefix match only.
- The docs don't say whether deleted contacts are recoverable.
- **Invariant 8:** names, emails, and phones are content-like personal data. Store only `resourceName` as the pointer.

---

## Sources

Gmail

- [G1] Gmail API scopes. https://developers.google.com/workspace/gmail/api/auth/scopes (updated 2026-09-10)
- [G2] Working with drafts. https://developers.google.com/workspace/gmail/api/guides/drafts (updated 2026-09-10)
- [G3] users.drafts.send. https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/send (updated 2026-04-15)
- [G4] users.history.list. https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list (updated 2026-04-15)
- [G5] Push notifications. https://developers.google.com/workspace/gmail/api/guides/push (updated 2026-09-15)
- [G6] Synchronize clients. https://developers.google.com/workspace/gmail/api/guides/sync
- [G7] users.watch. https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch
- [G8] Sending email. https://developers.google.com/workspace/gmail/api/guides/sending (updated 2026-09-10)
- [G9] Usage limits. https://developers.google.com/workspace/gmail/api/reference/quota (updated 2026-10-16)
- [G10] Gmail API release notes. https://developers.google.com/workspace/gmail/api/release-notes
- [G11] users.messages.delete. https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/delete
- [G12] users.messages.send. https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send
- [G13] users.messages.attachments.get. https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments/get
- [G14] users.labels. https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels (updated 2026-04-15)
- [G15] users.settings.sendAs.list. https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.sendAs/list
- [G16] users.settings.sendAs.patch. https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.sendAs/patch
- [G17] users.settings.sendAs.create. https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.sendAs/create
- [G18] users.settings.filters. https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.filters (updated 2026-05-13)
- [G19] users.settings.filters.create. https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.filters/create
- [G20] Managing filters. https://developers.google.com/workspace/gmail/api/guides/filter_settings (updated 2026-09-10)
- [G21] users.settings.getVacation. https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings/getVacation
- [G22] users.settings.updateVacation. https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings/updateVacation
- [G23] users.settings.updateAutoForwarding. https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings/updateAutoForwarding
- [G24] users.settings.delegates.create. https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.delegates/create
- [G25] users.settings.delegates.list. https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.delegates/list
- [G26] users.messages resource (threadId criteria). https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages (updated 2026-05-06)
- [G27] Gmail sending limits in Google Workspace. https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace
- [G28] Aliases and signatures. https://developers.google.com/workspace/gmail/api/guides/alias_and_signature_settings (updated 2026-09-18)

Calendar

- [C1] Calendar API scopes. https://developers.google.com/workspace/calendar/api/auth (updated 2026-09-03)
- [C2] Freebusy: query. https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query (updated 2026-05-12)
- [C3] Events: list. https://developers.google.com/workspace/calendar/api/v3/reference/events/list
- [C3-insert] Events: insert. https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
- [C4] Events resource. https://developers.google.com/workspace/calendar/api/v3/reference/events (updated 2026-07-07)
- [C5] Create events. https://developers.google.com/workspace/calendar/api/guides/create-events
- [C6] Calendar status events (OOO, working location, focus time). https://developers.google.com/workspace/calendar/api/guides/calendar-status
- [C7] Calendar sharing and event visibility. https://developers.google.com/workspace/calendar/api/concepts/sharing (updated 2026-09-03)
- [C8] Set Google Calendar sharing options (admin). https://knowledge.workspace.google.com/admin/calendar/set-google-calendar-sharing-options
- [C9] Calendar usage limits. https://developers.google.com/workspace/calendar/api/guides/quota (updated 2026-09-11)
- [C10] Calendar release notes. https://developers.google.com/workspace/calendar/release-notes
- [C11] CalendarList: list. https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list
- [C12] Settings. https://developers.google.com/workspace/calendar/api/v3/reference/settings
- [C13] Events: patch. https://developers.google.com/workspace/calendar/api/v3/reference/events/patch
- [C14] Events: delete. https://developers.google.com/workspace/calendar/api/v3/reference/events/delete
- [C15] Share your calendar (Calendar Help). https://support.google.com/calendar/answer/37082
- [C16] Synchronize resources efficiently. https://developers.google.com/workspace/calendar/api/guides/sync
- [C17] Handle API errors. https://developers.google.com/workspace/calendar/api/guides/errors (updated 2026-09-11)
- [C18] Push notifications. https://developers.google.com/workspace/calendar/api/guides/push
- [C19] Events: watch. https://developers.google.com/workspace/calendar/api/v3/reference/events/watch (updated 2026-05-12)
- [C20] Change invitation settings (Calendar Help). https://support.google.com/calendar/answer/13159188

Tasks

- [T1] Tasks resource. https://developers.google.com/workspace/tasks/reference/rest/v1/tasks (updated 2026-10-19)
- [T2] tasks.list. https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/list (updated 2025-04-10)
- [T3] Tasks scopes. https://developers.google.com/workspace/tasks/auth
- [T4] tasks.insert. https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/insert
- [T5] TaskLists resource. https://developers.google.com/workspace/tasks/reference/rest/v1/tasklists (updated 2025-03-13)
- [T6] Tasks release notes. https://developers.google.com/workspace/tasks/release-notes
- [T7] Tasks usage limits. https://developers.google.com/workspace/tasks/limits (updated 2026-09-03)
- [T8] Google Ads Scripts Tasks example (`@default`). https://developers.google.com/google-ads/scripts/docs/examples/google-tasks

People

- [P1] People API resource. https://developers.google.com/people/api/rest/v1/people (updated 2024-08-06)
- [P2] Read and manage contacts. https://developers.google.com/people/v1/contacts
- [P3] people.connections.list. https://developers.google.com/people/api/rest/v1/people.connections/list (updated 2024-08-06)
- [P4] people.searchContacts. https://developers.google.com/people/api/rest/v1/people/searchContacts (updated 2024-08-06)
- [P5] contactGroups. https://developers.google.com/people/api/rest/v1/contactGroups
- [P6] otherContacts. https://developers.google.com/people/api/rest/v1/otherContacts
- [P7] otherContacts.list. https://developers.google.com/people/api/rest/v1/otherContacts/list (updated 2024-08-06)
- [P8] people.listDirectoryPeople. https://developers.google.com/people/api/rest/v1/people/listDirectoryPeople

Docs (checked in passing)

- [D1] documents.batchUpdate (WriteControl.writeMode SUGGEST). https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate (updated 2026-10-09)

Verification and Nango

- [X1] Restricted scope verification. https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification (updated 2026-08-19)
- [N1] Nango: Gmail. https://nango.dev/docs/api-integrations/google-mail
- [N2] Nango: Gmail webhooks. https://nango.dev/docs/api-integrations/google-mail/webhooks
- [N3] Nango: Google (generic). https://nango.dev/docs/api-integrations/google
- [N4] Nango: Google Calendar webhooks. https://nango.dev/docs/api-integrations/google-calendar/webhooks
- [N5] Nango: Google Calendar. https://nango.dev/docs/api-integrations/google-calendar
- [N6] Nango: Google Tasks OAuth app. https://nango.dev/docs/api-integrations/google-tasks/how-to-register-your-own-google-tasks-api-oauth-app
- [N7] Nango integrations overview. https://nango.dev/docs/integrations/overview
