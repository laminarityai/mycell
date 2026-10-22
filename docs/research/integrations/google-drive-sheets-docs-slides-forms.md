# Google Drive, Sheets, Docs, Slides, Forms

Researched 2026-10-21 against Google's developer docs. Every row cites a page in **Sources** (by `[n]`). "Docs silent" means the official page says nothing on the point.

## Where Mycel stands today (repo, read only)

- **Catalog** (`app/src/features/policy/catalog.ts`): two Sheets actions, `google-sheet.read-range` (`read`) and `google-sheet.append-row` (`internal_reversible`). There are no Drive, Docs, Slides or Forms actions yet.
- **Scopes the Google connection asks for** (`app/src/features/connections/types.ts`, `GOOGLE_APP_SCOPES`): `drive.readonly` (Drive), `spreadsheets` (Sheets) and `documents` (Docs). It asks nothing for Slides or Forms. Discovery already polls `drive/v3/changes` with a start page token, using `drive.readonly`.
- **Spec #67 / #71 (M11, Docs)** plan `google-docs.read-document` (`read`) and `google-docs.suggest-edits` (`external_send`). Prepare is `batchUpdate` with `writeMode: SUGGEST`. **No approve**, because "Google gives us no way to accept them". Check closes the review "once none of Mycel's suggestions remain". Save refuses edits to "headers, footers, tabs and named ranges".

**Three parts of #67/#71 are now out of date** (details in the Docs section):

1. **Approve and decline are possible** through `AcceptSuggestionRequest` and `RejectSuggestionRequest` (GA 2026-09-30) [1][2].
2. **The refused list is different.** It includes `UpdateTableColumnProperties` and three `UpdateDocumentStyle` fields. It does _not_ include creating headers or footers, editing text inside them, or `ReplaceNamedRangeContent` [1].
3. **"Per author" can't tell Mycel apart.** Mycel writes with the member's own OAuth token, so every suggestion's author is the member. Check has to track the `createdSuggestionIds` that prepare returns [3][4].

---

## Google Docs

### Summary

Docs holds a small company's proposals, SOPs, meeting notes, weekly status docs and contracts. The workflows it most enables:

1. Fill or refresh a section of a recurring doc (weekly status, meeting notes) as suggestions the owner accepts.
2. Draft a new doc from a template (copy, then replace placeholders) for a proposal, an SOW or onboarding.
3. Leave a comment or assign an action item on a doc when something upstream changes.
4. Read a doc as context for another step, such as answering an email from the SOP.

### Capability table

| Operation                                                         | API method                                                                                                                     | Proposed risk                                                                                   | Reaches people?                                           | Notes                                                                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Read doc structure and text                                       | `documents.get` (`includeTabsContent=true`)                                                                                    | `read`                                                                                          | No                                                        | Use `suggestionsViewMode=SUGGESTIONS_INLINE` to get indexes that are valid for a later `batchUpdate` [1]. Content stays in memory (invariant 8). |
| Read comments and suggestion threads                              | `documents.get` with `commentsViewMode=COMMENTS_VIEW_MODE_INCLUDED` (needs `SUGGESTIONS_INLINE` and `includeTabsContent=true`) | `read`                                                                                          | No                                                        | Fills `Document.comments[]` and `Document.suggestions[]` [1][3].                                                                                 |
| Create a blank doc                                                | `documents.create`                                                                                                             | `internal_reversible`                                                                           | No                                                        | Private to the member until it's shared. Only the title is set; the body goes in with `batchUpdate`.                                             |
| Create a doc from a template                                      | Drive `files.copy`, then `documents.batchUpdate` `ReplaceAllText` / `ReplaceNamedRangeContent`                                 | `internal_reversible`                                                                           | No (copy is private)                                      | `files.copy?copyComments=true` (GA 2026-09-02) carries open comments and suggestions [9].                                                        |
| Edit directly (insert, delete, format, tables, images)            | `documents.batchUpdate` (`writeMode: EDIT`)                                                                                    | `internal_reversible` on the member's own private doc; treat as `external_send` on a shared doc | Yes, if shared: collaborators see the change              | Pin with `writeControl.requiredRevisionId` so the write fails if the doc changed [2].                                                            |
| **Suggest edits**                                                 | `documents.batchUpdate` with `writeControl.writeMode: SUGGEST`                                                                 | `external_send` (the pending form itself)                                                       | Visible to collaborators as a suggestion, but not applied | Response `suggestionResponses[].createdSuggestionIds` maps 1:1 to requests [2]. See the refused list below.                                      |
| **Accept a suggestion**                                           | `batchUpdate` `acceptSuggestion { suggestionId }`                                                                              | the "approve" of the pending form                                                               | Yes (applies the change)                                  | "Returns a 403 forbidden error if the requesting user does not have edit access to the document" [4].                                            |
| **Reject a suggestion**                                           | `batchUpdate` `rejectSuggestion { suggestionId }`                                                                              | the "decline"                                                                                   | No                                                        | Needs edit access _or_ being the suggestion's author [4].                                                                                        |
| Delete a suggestion                                               | `batchUpdate` `deleteSuggestion { suggestionId }`                                                                              | decline (alternative)                                                                           | No                                                        | Author only [4].                                                                                                                                 |
| Insert comment (anchored to a range)                              | `batchUpdate` `insertComment { content, range, assigneeEmailAddress? }`                                                        | `external_send`                                                                                 | Yes: Docs notifications, and the assignee is emailed      | Content up to 2048 UTF-8 code units. Assigning makes it an action item [1][3].                                                                   |
| Reply, resolve or reopen a thread                                 | `addCommentReply { commentId\|suggestionId, post{content, commentAction: RESOLVE\|REOPEN, assigneeEmail} }`                    | `external_send` (reply/reassign); `internal_reversible` (resolve/reopen)                        | Reply and reassign notify                                 | You can't assign on a suggestion thread [3].                                                                                                     |
| Edit own post                                                     | `updateCommentPost`                                                                                                            | `internal_reversible`                                                                           | Yes (edit is visible)                                     | Not the head post of a suggestion thread [1].                                                                                                    |
| Delete comment or reply                                           | `deleteComment`, `deleteCommentReply`                                                                                          | `destructive` (another person's thread can't be deleted anyway)                                 | No                                                        | Only the author of the head post or reply. A reply carrying an action or assignee can't be deleted [1][4].                                       |
| Tabs, headers/footers, named ranges, dropdowns, people/date chips | `addDocumentTab`, `createHeader`, `createNamedRange`, `insertPerson`, `insertDate`, `insertDropdown` ...                       | `internal_reversible`                                                                           | Same as edit                                              | The full request list is in [4].                                                                                                                 |
| Delete a doc                                                      | Drive `files.update {trashed:true}` / `files.delete`                                                                           | trash: `internal_reversible`; delete: **`destructive`**                                         | No                                                        | See Drive.                                                                                                                                       |

**Requests refused in SUGGEST mode** (verbatim list, page updated 2026-09-30) [1]: `AddDocumentTab`, `CreateNamedRange`, `DeleteFooter`, `DeleteHeader`, `DeleteNamedRange`, `DeleteTab`, `UpdateDocumentTabProperties`, `UpdateTableColumnProperties`. In `UpdateDocumentStyle`, the fields `documentFormat`, `useEvenPageHeaderFooter` and `useFirstPageHeaderFooter` are also refused. The docs don't say whether the comment requests (`insertComment` and so on) may be mixed into a SUGGEST batch.

**How `documents.get` shows suggestions** [1][3]:

- **Inline in the content.** `TextRun` and other elements carry `suggestedInsertionIds[]` / `suggestedDeletionIds[]`. Style suggestions sit in `suggestedTextStyleChanges{ suggestionId: {textStyle, textStyleSuggestionState} }` and similar maps (paragraph, table cell, document style and so on).
- **As threads.** `Document.suggestions[]` is a list of `SuggestionThread { suggestionId, headPost: Post, replies[], status: OPEN|ACCEPTED|REJECTED, summaryText, summaryHtml }`. It is only filled when `commentsViewMode` asks for comments.
- **Authors.** `Post.author` is a `PostAuthor { displayName, me, anonymous, user: "users/{id}" }`. **There is no email address.** `me` is "whether the user is the authenticated user making the request" [3]. So yes, suggestions carry an author, but Mycel acting as the member shows up as `me: true`. That can't tell Mycel's suggestions apart from ones the member made by hand.
- **No `fields`-level filter by author.** The docs are silent on whether ACCEPTED/REJECTED threads stay in `suggestions[]` or drop out.

**OAuth for accept and reject.** These are ordinary `documents.batchUpdate` requests, so they take any of `documents`, `drive` or `drive.file` [2]. What decides access is the document permission (edit access for accept; edit or authorship for reject), not a special scope [4]. The docs don't say whether a _commenter-only_ user may write with `writeMode: SUGGEST`.

**Partial-failure gotcha** [1]. `BatchUpdateDocumentResponse.commentUpdateState` can be `ALL_FAILED_UNKNOWN_REASON`, meaning "the document model changes … might be successfully committed … but the associated comments or suggestions might fail to save". The adapter must treat that as a failed prepare and check the doc. Otherwise an edit could land without its suggestion wrapper.

### Pending form (Docs suggested edits): now a full four-operation adapter

| Op      | API                                                                                                                                                                                                                                                                                                |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| prepare | `documents.get` (SUGGESTIONS_INLINE) for indexes → `documents.batchUpdate {requests, writeControl:{writeMode:SUGGEST, requiredRevisionId}}` → store `createdSuggestionIds` (and `documentId`) on the review as pointers. Fail the prepare unless `commentUpdateState == ALL_SAVED`.                |
| approve | `batchUpdate [acceptSuggestion{id}…]` for the stored IDs. A 403 means the member lacks edit access: fall back to "open the doc".                                                                                                                                                                   |
| decline | `batchUpdate [rejectSuggestion{id}…]` (or `deleteSuggestion`, since Mycel is the author).                                                                                                                                                                                                          |
| check   | `documents.get?commentsViewMode=COMMENTS_VIEW_MODE_INCLUDED&suggestionsViewMode=SUGGESTIONS_INLINE&includeTabsContent=true&fields=suggestions(suggestionId,status)`. All stored IDs `ACCEPTED` or `REJECTED` → `done_in_app`. Some `OPEN` → `waiting`. IDs absent, or doc 404 or trashed → `gone`. |

`summaryText` and `summaryHtml` hold doc content, so never persist them (ADR-0012).

### Triggers

- **Docs has no push or watch of its own.** Use Drive instead (next section): `files.watch` on the doc (channel ≤ 1 day), Workspace Events `google.workspace.drive.file.v3.contentChanged` on the file, or `comment.v3.created` / `reply.v3.created` for new comments (GA 2026-05-18) [7][8][9].
- **Polling.** Use Drive `changes.list`, or compare `Document.revisionId`. That ID is "only guaranteed to be valid for 24 hours" and a changed ID "usually means the document has been updated" [3].

### Auth

| Scope                      | Class         | Covers                                                                        |
| -------------------------- | ------------- | ----------------------------------------------------------------------------- |
| `documents.readonly`       | Sensitive     | read                                                                          |
| `documents`                | Sensitive     | read/write/suggest/accept/comment, on all of the user's docs                  |
| `drive.file`               | Non-sensitive | the same methods, but only on files the app created or the user picked [6][5] |
| `drive` / `drive.readonly` | Restricted    | everything                                                                    |

Sensitive scopes need standard OAuth app verification. Restricted scopes need restricted-scope verification plus an annual third-party security assessment (CASA) [10].

### Limits

Reads are 3,000/min per project and 300/min per user. **Writes are 600/min per project and 60/min per user** [11]. Each `batchUpdate` counts as one write. Requests are atomic: one invalid sub-request fails the batch [2].

### Nango

`google-docs` provider, alias `google`, with proxy base `https://docs.googleapis.com` [16]. Mycel already proxies Docs through its single `google` integration (`GOOGLE_HOSTS.docs`).

### Gaps and gotchas

- Mycel can't author as "Mycel". Suggestions show the member's name, so the doc owner sees "Kevin suggested …". Anonymous or app authors aren't offered [3].
- Accept needs **edit** access; a member who only comments can't approve through Mycel [4].
- Suggest mode can't change tabs, named ranges or header/footer layout settings [1].
- Release note 2026-10-12: OAuth clients calling the **Docs/Drive/Sheets/Slides MCP servers** must be marked "Use this client for an AI-powered agent" by 2026-11-11. Clients that only call REST are not affected [12][9].

---

## Google Drive

### Summary

Drive is the company file system: client folders, contracts, invoices as PDFs, shared drives per team. The workflows it most enables:

1. File an incoming attachment into the right client folder and name it consistently.
2. Share a deliverable with a client (this is the external step).
3. React to "a new file landed in folder X", such as a signed contract or a new invoice.
4. Route a doc for formal sign-off (Drive approvals).
5. Tidy up: move, rename or label files, and make sure nothing is shared publicly.

### Capability table

| Operation                                                     | API method                                                                                                                                                      | Proposed risk                                                           | Reaches people?                                           | Notes                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search or list files                                          | `files.list` (`q`, `corpora`, `driveId`, `includeItemsFromAllDrives`, `supportsAllDrives`)                                                                      | `read`                                                                  | No                                                        | 100 quota units per call [13].                                                                                                                                                                                                                                                                                                                |
| Get metadata                                                  | `files.get`                                                                                                                                                     | `read`                                                                  | No                                                        | 5 units [13].                                                                                                                                                                                                                                                                                                                                 |
| Download or export content                                    | `files.get?alt=media`, `files.export`, `files.download` (returns an LRO)                                                                                        | `read`                                                                  | No                                                        | **Export is limited to 10 MB** [14]. `files.download` returns a long-running operation (since 2024-09) [9].                                                                                                                                                                                                                                   |
| Create a file or folder, upload                               | `files.create`                                                                                                                                                  | `internal_reversible`                                                   | No (inherits the parent folder's sharing)                 | A file created in a shared folder is visible to that folder's members.                                                                                                                                                                                                                                                                        |
| Copy (template)                                               | `files.copy` (`copyComments`)                                                                                                                                   | `internal_reversible`                                                   | No                                                        |                                                                                                                                                                                                                                                                                                                                               |
| Rename, move, describe, `appProperties`                       | `files.update` (`addParents`/`removeParents`)                                                                                                                   | `internal_reversible`                                                   | Moving into a shared folder or shared drive widens access | Treat a move into a folder that has external members as `external_send`.                                                                                                                                                                                                                                                                      |
| Trash or untrash                                              | `files.update {trashed}`                                                                                                                                        | `internal_reversible`                                                   | No                                                        |                                                                                                                                                                                                                                                                                                                                               |
| **Permanently delete**                                        | `files.delete`, `files.emptyTrash`                                                                                                                              | **`destructive`**                                                       | No                                                        | Skips the trash.                                                                                                                                                                                                                                                                                                                              |
| Read sharing                                                  | `permissions.list` / `get`                                                                                                                                      | `read`                                                                  | No                                                        |                                                                                                                                                                                                                                                                                                                                               |
| **Share with a user or group inside the domain**              | `permissions.create {type:user\|group, role}` with `sendNotificationEmail` (default true), `emailMessage`                                                       | `external_send` (it reaches another person)                             | Yes (email by default)                                    | `sendNotificationEmail` can't be disabled for ownership transfer [15].                                                                                                                                                                                                                                                                        |
| **Share outside the domain / domain-wide / anyone with link** | `permissions.create {type:user (external) \| domain \| anyone, allowFileDiscovery}`                                                                             | **`external_send`**, and arguably higher for `anyone`                   | Yes                                                       | The API has no "is this external" flag. Compare the grantee's email domain or `domain` with the org's domain(s).                                                                                                                                                                                                                              |
| Change or remove access                                       | `permissions.update` / `permissions.delete`                                                                                                                     | `internal_reversible` (remove access); `external_send` (raise role)     | Indirectly                                                | "Concurrent permission modifications … only the last update is applied" [15].                                                                                                                                                                                                                                                                 |
| Expiring access                                               | `permission.expirationTime`                                                                                                                                     | lowers the risk of a share                                              |                                                           | Users and groups only, not domains [15].                                                                                                                                                                                                                                                                                                      |
| **Transfer ownership**                                        | `permissions.create/update` `transferOwnership=true`                                                                                                            | **`destructive`** (the user loses ownership)                            | Yes (email is mandatory)                                  | [15]                                                                                                                                                                                                                                                                                                                                          |
| Comments (any file type)                                      | `comments.create/list/update/delete`, `replies.*`                                                                                                               | create/reply: `external_send` (notifies); list: `read`                  | Yes                                                       | The `fields` parameter is **mandatory** on the comments resource. For Docs/Sheets/Slides, the API can't make editor-native anchors; the anchor is app-defined [17]. Prefer the Docs/Sheets/Slides comment requests (GA 2026-09-30), which anchor properly.                                                                                    |
| Revisions                                                     | `revisions.list/get/update {keepForever, published}` / `delete`                                                                                                 | read: `read`; keepForever: `internal_reversible`; delete: `destructive` | `published` makes a revision public                       | Up to 200 revisions per file can be keepForever. Others can be purged after 30 days or once the file has more than 100 revisions [18].                                                                                                                                                                                                        |
| Changes feed                                                  | `changes.getStartPageToken`, `changes.list(pageToken)` → `nextPageToken` / `newStartPageToken`                                                                  | `read`                                                                  | No                                                        | Mycel already uses this for discovery.                                                                                                                                                                                                                                                                                                        |
| Shared drives                                                 | `drives.list/get/create/update/hide/delete`                                                                                                                     | create: `internal_reversible`; delete: `destructive`                    | Adding members reaches people                             | Membership is managed through `permissions` on the drive ID.                                                                                                                                                                                                                                                                                  |
| Labels                                                        | `files.modifyLabels`, `files.listLabels`; Labels API for schemas                                                                                                | `internal_reversible`                                                   | No                                                        | Only some editions (see Gaps). Creating label _schemas_ needs the admin "Manage Labels" privilege [19].                                                                                                                                                                                                                                       |
| **Approvals** (GA 2026-04-21)                                 | `approvals.start {reviewerEmails, dueTime, lockFile, message, fileContentChangeBehavior}`, `approve`, `decline`, `reassign`, `cancel`, `comment`, `get`, `list` | `start`: `external_send` (emails every reviewer); `get`/`list`: `read`  | Yes                                                       | Needs `canStartApproval`. It is false when the admin restricts it, the "edition is ineligible", the file is owned outside the domain, or the user isn't a writer. "Every action in the approval process generates email notifications." Works "with any of the existing OAuth 2.0 Drive API scopes that allow writing file metadata" [20][9]. |
| Access proposals                                              | `accessproposals.list/resolve`                                                                                                                                  | `resolve` grants access: `external_send`                                | Yes                                                       | Event types exist in Workspace Events [8].                                                                                                                                                                                                                                                                                                    |

### Pending form

- **Share a file** (`external_send`): **none native: needs a design.** A permission either exists or doesn't. `sendNotificationEmail=false` still grants access, and Drive has no "draft share". Options:
  - (a) Hold the share in Mycel's own review only. The pointer is fileId plus grantee. Approve calls `permissions.create`. Check reads `permissions.list` to see whether the member shared it themselves (`done_in_app`) or the file is gone.
  - (b) Combine with a Gmail draft that carries the link, and create the permission on approve.

  Option (a) breaks ADR-0013's "waiting item lives in the app" rule, so it needs an ADR decision.

- **Drive approvals as a _Mycel-side_ hold.** It's the other way round: Mycel could _start_ an approval to get a human sign-off inside Drive, and the run continues on `approval.v3.completed`. It is not a way to hold Mycel's own external send.
- **Comments**: none native. There is no draft comment.

### Triggers

| Mechanism                                       | Events                                                                                                                                                                                                                            | Lifetime / renewal                                           | Notes                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `changes.watch` (webhook)                       | "changed" ping, empty body                                                                                                                                                                                                        | **Max 1 week**; default 1 hour; **no automatic renewal** [7] | Then call `changes.list`. Nango can receive and route these: put Nango's webhook URL as `address` and the Nango secret as `token`. There is no HMAC; the token is the only check [21].                                                                                                                         |
| `files.watch` (webhook)                         | `add`, `remove`, `update` (with `X-Goog-Changed: content,properties,parents,children,permissions`), `trash`, `untrash`                                                                                                            | **Max 1 day** [7]                                            | One channel per file. Bodies are always empty [7].                                                                                                                                                                                                                                                             |
| **Workspace Events API, Drive** (GA 2026-05-18) | `file.v3.created/moved/contentChanged/deleted/trashed/untrashed/renamed`, `permission.v3.created/edited/deleted`, `comment.v3.created/edited/resolved/reopened/deleted`, `reply.v3.*`, `approval.v3.*`, `accessproposal.v3.*` [8] | Up to 7 days without resource data; **4 hours** with it [22] | Delivered over **Cloud Pub/Sub**, not a webhook. The target is a file or folder (events cover its whole subtree) or a shared drive, **not "all of My Drive"** [8][23]. The topic must allow `drive-api-event-push@system.gserviceaccount.com` [23]. Scopes accepted include `drive.file` (non-sensitive) [24]. |
| Polling                                         | `changes.list` from a stored page token                                                                                                                                                                                           | n/a                                                          | What Mycel does today.                                                                                                                                                                                                                                                                                         |
| Drive Activity API                              | actor, action and target history                                                                                                                                                                                                  | n/a                                                          | `drive.activity(.readonly)` is **restricted** [5].                                                                                                                                                                                                                                                             |

Calls to `changes.watch`, `files.watch` and `channels.stop` count against quota; the notifications themselves don't [13].

### Auth: the `drive.file` vs `drive` trade-off [5][10]

| Scope                                                                                                                                       | Class             | What it gives                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `drive.file`                                                                                                                                | **Non-sensitive** | Files the app created or the user opened or picked with the **Google Picker** (or the app's own picker). It "works with all Drive API REST Resources". |
| `drive.appdata`, `drive.install`                                                                                                            | Non-sensitive     | App-data folder, Open-with integration.                                                                                                                |
| `drive.apps.readonly`                                                                                                                       | Sensitive         |                                                                                                                                                        |
| `drive`, `drive.readonly`, `drive.metadata`, `drive.metadata.readonly`, `drive.activity(.readonly)`, `drive.meet.readonly`, `drive.scripts` | **Restricted**    | Everything.                                                                                                                                            |

- **Restricted-scope verification** [10]: "Every app that requests access to Google users' restricted data and has the ability to access data from or through a third-party server must go through a security assessment." That means an **annual** CASA assessment by an App Defense Alliance-approved assessor, on top of brand verification (2–3 business days); the whole process can "take several weeks". The page was updated 2026-08-19.
- **Exemptions** [10] cover personal use, development/testing, **apps for internal Workspace users only**, and domain-wide installs allowlisted by an admin.
- **Mycel's Drive scope today.** Mycel asks for `drive.readonly`, which is restricted. That's fine for the dogfood (an internal app). It **blocks selling to other companies** until CASA, or until discovery moves to `drive.file` plus the Picker.
- **Restricted-scope eligibility.** Drive also limits restricted scopes to the app categories "Backup and sync", "Productivity and education" and "Reporting and security" [5]. Mycel would argue "Productivity".
- **What `drive.file` gives up.** It can't mine "all Sheets" for discovery or see files the user never picked. The Picker means Mycel has to ship Google Picker UI.

### Limits (changed 2026-05-01)

- Quotas are now in **quota units**: 1,000,000 per minute per project and **325,000 per minute per user**. A read costs 5, a list 100, a download 200 and an edit 50 [13].
- Egress is capped at 1 TB per day per project.
- The "daily billing threshold" is 400M units per day per project. Usage over it "is planned to incur charges … later in 2026" [13].
- Projects that used the API between November 2025 and April 2026 keep their old quotas [13].
- Upload is capped at 750 GB per user per day [13].

### Nango

- `google-drive` provider (alias `google`). It has `webhook_routing_script: googleDriveWebhookRouting` and a user-defined webhook secret [16].
- The integration guide shows creating a `changes.watch` channel in a post-connection script, renewing it, and stopping it when the connection is deleted. Mycel must store the channel's `resourceId` itself for connection matching [21].
- The generic `google` provider (the one Mycel uses) also has `webhook_routing_script: googleWebhookRouting` [16].
- Pre-built syncs and actions exist (documents, folders, permissions, shared drives, changes) [25], though Mycel writes its own.
- Docs silent on Nango routing **Pub/Sub** Workspace Events for Drive. Plan on Mycel's own Pub/Sub push endpoint.

### Gaps and gotchas

- **Labels** need Business Standard/Plus, Enterprise, Frontline, Education Standard/Plus, Essentials or G Suite Business. **Business Starter is excluded** [19].
- **Approvals** depend on the edition (`canStartApproval`); the docs don't list which editions.
- "External" is not a field. Mycel must compute it from the org's verified domain(s).
- Workspace Events requires a GCP Pub/Sub topic, and therefore billing [23].

---

## Google Sheets

### Summary

Sheets is the small company's database: lead lists, order trackers, timesheets, inventory, budgets. The workflows it most enables:

1. Log each incoming email or form response as a row (already `append-row`).
2. Look up a row (a customer or SKU) to make a decision (already `read-range`).
3. Update a status cell when something happens elsewhere ("invoice paid", "shipped").
4. Build a weekly summary tab or report.
5. React to a new row someone else adds.

### Capability table

| Operation                                                                                                                     | API method                                                                                                                                          | Proposed risk                                                                                   | Reaches people?      | Notes                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read values                                                                                                                   | `spreadsheets.values.get` / `batchGet` / `batchGetByDataFilter`                                                                                     | `read`                                                                                          | No                   | Already in the catalog.                                                                                                                                                                                                                                                                                                                     |
| Read structure                                                                                                                | `spreadsheets.get` (`fields`, `ranges`, `includeGridData`)                                                                                          | `read`                                                                                          | No                   |                                                                                                                                                                                                                                                                                                                                             |
| Append rows                                                                                                                   | `values.append`                                                                                                                                     | `internal_reversible`                                                                           | Collaborators see it | Already in the catalog.                                                                                                                                                                                                                                                                                                                     |
| Update cells                                                                                                                  | `values.update` / `batchUpdate` (`valueInputOption` RAW\|USER_ENTERED)                                                                              | `internal_reversible`, though an overwrite can only be undone through version history in the UI | Collaborators see it | Consider "update a row matched by a key", using developer metadata to pin the row.                                                                                                                                                                                                                                                          |
| Clear a range                                                                                                                 | `values.clear` / `batchClear`                                                                                                                       | `destructive` (no API undo)                                                                     |                      |                                                                                                                                                                                                                                                                                                                                             |
| Add, delete or rename a sheet (tab)                                                                                           | `batchUpdate` `addSheet` / `deleteSheet` / `updateSheetProperties`                                                                                  | add/rename: `internal_reversible`; **delete: `destructive`**                                    |                      |                                                                                                                                                                                                                                                                                                                                             |
| Insert or delete rows and columns, sort, find-replace                                                                         | `insertDimension`, `deleteDimension`, `sortRange`, `findReplace`                                                                                    | delete/findReplace: `destructive`; others `internal_reversible`                                 |                      |                                                                                                                                                                                                                                                                                                                                             |
| Formatting, conditional formats, data validation, charts, pivot tables, filter views, tables (2025-04), smart chips (2025-06) | `batchUpdate` `repeatCell`, `updateCells`, `addConditionalFormatRule`, `setDataValidation`, `addChart`, `addTable` ...                              | `internal_reversible`                                                                           |                      | [26]                                                                                                                                                                                                                                                                                                                                        |
| Protected ranges                                                                                                              | `addProtectedRange` / `updateProtectedRange` / `deleteProtectedRange` (`editors`, `warningOnly`)                                                    | `internal_reversible`                                                                           | Changes who can edit |                                                                                                                                                                                                                                                                                                                                             |
| Developer metadata                                                                                                            | `createDeveloperMetadata`, `developerMetadata.get` / `search`; `DataFilter` by metadata                                                             | `internal_reversible`                                                                           | No                   | `PROJECT` visibility is seen only by the GCP project that created it. `DOCUMENT` visibility is seen by any project with access. "Don't use project-visible developer metadata as a security mechanism … might be exposed to users with view access" [27]. Good for marking "rows Mycel wrote" (idempotent retries) without storing content. |
| Comments (GA 2026-09-30)                                                                                                      | `spreadsheets.get?commentsViewMode=…`; `batchUpdate` `insertComment`, `addCommentReply`, `updateCommentPost`, `deleteComment`, `deleteCommentReply` | read: `read`; create/reply: `external_send`                                                     | Yes                  | [26]                                                                                                                                                                                                                                                                                                                                        |
| Create a spreadsheet                                                                                                          | `spreadsheets.create`                                                                                                                               | `internal_reversible`                                                                           | No                   |                                                                                                                                                                                                                                                                                                                                             |
| Share or delete                                                                                                               | Drive `permissions` / `files.*`                                                                                                                     | see Drive                                                                                       |                      |                                                                                                                                                                                                                                                                                                                                             |

### Pending form

Sheets has **no suggest mode** and no draft rows. Most writes are internal (collaborators see them, but they're internal edits), so they are `internal_reversible` with no pending form. Comments that notify people would be `external_send` with **none native: needs a design**.

### Triggers

- **Sheets has no change-notification API of its own.** Options:
  - Drive `files.watch` on the spreadsheet: an `update` event with `X-Goog-Changed: content`, ≤ 1 day per channel [7].
  - Workspace Events `google.workspace.drive.file.v3.contentChanged` on the file, ≤ 7 days, over Pub/Sub [8][22].
  - Polling Drive `changes.list` / `files.get(modifiedTime, version)`, then diffing `values.get` in memory.
- None of these says _which_ rows changed, so "new row added" has to be detected by keeping a row count or high-water mark (a derived pointer). Developer metadata on Mycel-processed rows is one option.
- Apps Script `onEdit` / `onChange` triggers exist but aren't part of the REST API.

### Auth [28]

| Scope                     | Class         |
| ------------------------- | ------------- |
| `spreadsheets.readonly`   | Sensitive     |
| `spreadsheets`            | Sensitive     |
| `drive.file`              | Non-sensitive |
| `drive`, `drive.readonly` | Restricted    |

Mycel already holds `spreadsheets`, which is enough for every Sheets write.

### Limits [29]

- **Read: 300/min per project and 60/min per user. Write: 300/min per project and 60/min per user.** A batch counts as one request. A busy workflow ("log every email") can hit 60 writes per minute per user, so batch the appends.
- 180 s processing timeout per request. A 2 MB payload is recommended.
- Requests are atomic.
- **The per-project limit of 300/min is low for a multi-tenant SaaS**, because every Mycel org shares one GCP project. A quota increase will be needed.

### Nango

`google-sheet` provider, proxy `https://sheets.googleapis.com` [16]. Mycel already proxies Sheets.

### Gaps and gotchas

- No row-level change events, and no suggest mode.
- The API has no undo or restore of a version (Drive revisions for Google-native files can be exported but not restored through the API).

---

## Google Slides

### Summary

Slides is used for client decks, QBRs, proposals and weekly metric reviews. The workflows it most enables:

1. Generate a per-client deck from a template (replace placeholders with CRM or Sheet data).
2. Refresh the charts in a recurring deck from Sheets.
3. Assemble a slide per item (one slide per deal or project).

### Capability table

| Operation                | API method                                                                                                                                                                    | Proposed risk                                                                      | Reaches people?          | Notes                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Read a deck              | `presentations.get`, `pages.get`                                                                                                                                              | `read`                                                                             | No                       |                                                                                                                    |
| Thumbnail                | `pages.getThumbnail`                                                                                                                                                          | `read`                                                                             | No                       | "Expensive read": 60/min per user [30].                                                                            |
| Create from template     | Drive `files.copy`, then `presentations.batchUpdate` `replaceAllText` / `replaceAllShapesWithImage` / `replaceAllShapesWithSheetsChart`                                       | `internal_reversible`                                                              | No (the copy is private) | Google's guide: copy the template and "Don't use the Slides API to manipulate your primary 'template' copy!" [31]. |
| Edit slides              | `createSlide`, `duplicateObject`, `insertText`, `createImage`, `createTable`, `updateTextStyle`, `deleteObject`, `refreshSheetsChart`, `replaceImage` ... (about 45 requests) | `internal_reversible` (`deleteObject` on a shared deck is closer to `destructive`) | Collaborators see it     | [32]                                                                                                               |
| Comments (GA 2026-09-30) | `insertComment`, `addCommentReply`, `updateCommentPost`, `deleteComment`, `deleteCommentReply`; `commentsViewMode` on get                                                     | `external_send` (create/reply)                                                     | Yes                      | [33]                                                                                                               |
| Share or present         | Drive `permissions.create`                                                                                                                                                    | `external_send`                                                                    | Yes                      |                                                                                                                    |

**Image gotcha.** `createImage`, `replaceAllShapesWithImage` and `replaceImage` need a URL that is **"publicly accessible"**, "less than 50 MB", ≤ 25 megapixels, PNG/JPEG/GIF, and a URL ≤ 2 KB [32]. Images from a private Drive file or a fetched attachment need a short-lived public URL (a signed URL), which has to fit invariant 8.

### Pending form

Slides has no suggest mode. A generated deck is private to the member until it's shared, so creating one is `internal_reversible` with no pending form. The share is the `external_send` (see Drive).

### Triggers

None of its own. Use Drive `files.watch`, Workspace Events or `changes.list` (as for Sheets).

### Auth [34]

| Scope                     | Class         |
| ------------------------- | ------------- |
| `presentations.readonly`  | Sensitive     |
| `presentations`           | Sensitive     |
| `drive.file`              | Non-sensitive |
| `drive`, `drive.readonly` | Restricted    |

`spreadsheets(.readonly)` is also needed for Sheets-linked charts. **Mycel doesn't ask for any Slides scope today.**

### Limits [30]

Reads are 3,000/min per project and 600/min per user. Writes are 600/min per project and **60/min per user**. Expensive reads (thumbnails) are 300/min per project and 60/min per user.

### Nango

`google-slides` provider, proxy `https://slides.googleapis.com` [16]. Mycel's `GOOGLE_HOSTS` has no `slides` host yet.

### Gaps and gotchas

- There are no "layout from scratch" helpers: placement is by object IDs and transforms.
- The public-image-URL requirement.

---

## Google Forms

### Summary

Small companies use Forms for intake (leads, support requests, job applications), internal requests (time off, purchase requests) and surveys. The workflows it most enables:

1. **A new response starts a workflow**: log it to a Sheet, draft a reply email, create a task.
2. Summarize responses weekly.
3. Create a feedback or registration form for an event (less common to automate).

### Capability table

| Operation                                    | API method                                                                                                     | Proposed risk                                                                                   | Reaches people?                                                   | Notes                                                                                                                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read a form                                  | `forms.get`                                                                                                    | `read`                                                                                          | No                                                                |                                                                                                                                                                                 |
| List or read responses                       | `forms.responses.list` (`filter: timestamp > N` or `>= N`, `pageSize` ≤ 5000) / `responses.get`                | `read`                                                                                          | No                                                                | "Expensive read": 180/min per user [35][36]. Respondent answers are personal content (invariant 8).                                                                             |
| Create a form                                | `forms.create`                                                                                                 | `internal_reversible` if `unpublished=true`; otherwise see the note                             | **By default it is published and accepts responses**              | Only `info.title` and `info.document_title` are copied. Questions are added with `batchUpdate`. "If set to `false` or unset, the form is published and accepts responses" [37]. |
| Edit questions and settings                  | `forms.batchUpdate` (`createItem`, `updateItem`, `deleteItem`, `moveItem`, `updateFormInfo`, `updateSettings`) | `internal_reversible` (`deleteItem` on a live form loses the question: closer to `destructive`) | Live responders see the changes                                   |                                                                                                                                                                                 |
| Publish, unpublish, stop accepting responses | `forms.setPublishSettings {publishSettings:{isPublished, isAcceptingResponses}}` (since 2025-04-08)            | `internal_reversible`                                                                           | Publishing makes it respondable by whoever has the link or access | [38][39]                                                                                                                                                                        |
| Add responders                               | Drive `permissions.create` with `view=published` (role reader)                                                 | `external_send`                                                                                 | Yes                                                               | [38]                                                                                                                                                                            |
| Delete a form                                | Drive `files.delete` / trash                                                                                   | `destructive` / `internal_reversible`                                                           |                                                                   | The Forms API has no delete.                                                                                                                                                    |
| Delete a response                            | —                                                                                                              | —                                                                                               | —                                                                 | The API has no responses delete (only `get` and `list`) [36].                                                                                                                   |
| Watches                                      | `forms.watches.create/list/renew/delete`                                                                       | n/a (trigger)                                                                                   |                                                                   | See Triggers.                                                                                                                                                                   |

### Pending form

- **Sending a form out** (`external_send`) = adding responders or sharing the link. The app-native hold is **the form created with `unpublished=true`**:
  - prepare: `forms.create?unpublished=true` + `batchUpdate`.
  - approve: `setPublishSettings{isPublished:true, isAcceptingResponses:true}`, plus responder permissions or a Gmail draft with the link.
  - decline: Drive `files.update{trashed:true}`.
  - check: `forms.get` → `publishSettings.publishState`. Published → `done_in_app`; 404 or trashed → `gone`.
- Legacy forms that don't return `publishSettings` can't be held this way [38].

### Triggers

- **Push** through `forms.watches.create {eventType: RESPONSES | SCHEMA, target: {topic: Pub/Sub}}`, all from [40] (updated 2026-09-03):
  - Delivery is **Cloud Pub/Sub only**, "usually within minutes".
  - A watch **lasts 7 days**; `watches.renew` extends it.
  - It is **throttled to one notification per 30 s per watch**, so one notification can stand for many responses.
  - The notification holds only `formId`, `watchId` and `eventType`. Mycel then calls `responses.list` with `filter=timestamp > lastSeen`.
  - **Limits:** per form and event type, each GCP project can have **up to 20 watches total and one per end user**. Each form is capped at **50 watches per event type across all projects**.
  - Notifications stop if the user revokes the grant "or loses edit access".
  - `forms-notifications@system.gserviceaccount.com` must be allowed to publish to the topic.
  - The token needs a scope that can read responses (for RESPONSES) or the form (for SCHEMA).
- **Polling:** `responses.list?filter=timestamp > {cursor}`. That's cheap and fits Mycel's existing poll-plus-cursor pattern without Pub/Sub. The Drive `changes` feed also shows the form file changing.

### Auth

- `forms.body` (create/edit), `forms.body.readonly` and `forms.responses.readonly` [41][36][37], plus `drive` / `drive.file` as alternatives on most methods.
- The Forms docs have **no sensitivity table** (the auth page now 404s). Confirm the classes in the Cloud console. They are not in Drive's restricted list.
- **Mycel doesn't ask for any Forms scope today.**

### Limits [35]

Reads are 975/min per project and 390/min per user. Expensive reads (`responses.list`) are 450/min per project and 180/min per user. Writes are 375/min per project and 150/min per user. There's no daily cap.

### Nango

`google-forms` provider, proxy `https://forms.googleapis.com` [16]. Docs silent on Nango routing Forms Pub/Sub notifications. Mycel's `GOOGLE_HOSTS` has no `forms` host.

### Gaps and gotchas

- New forms are **published by default**: always pass `unpublished=true`.
- Watches need Pub/Sub and a GCP billing account.
- The watch cap is per form, so "every form in the company" doesn't scale. Polling is fine.
- Response data is respondent PII.

---

## Cross-app recommendations for Mycel (decision-relevant)

1. **Rewrite #67/#71's Docs adapter as a full prepare/approve/decline/check.** Store `createdSuggestionIds`, not authors. Correct the refused list.
2. **Treat `drive.readonly` as a go-to-market blocker.** It's restricted (annual CASA). The dogfood is exempt as an internal app. For external customers, either budget for CASA or move discovery to `drive.file` plus the Google Picker.
3. **Drive sharing is the main new `external_send`, and it has no app-native pending form.** ADR-0013 needs a decision: a Mycel-held pending share, or a Gmail draft with the link.
4. **For triggers, the Workspace Events API now covers file, comment, permission and approval events (GA 2026-05)**, but only over Pub/Sub and only per file, folder or shared drive. Polling `changes.list` (which Mycel already does) and `responses.list` stays the simplest path.
5. **Sheets per-project quota (300/min) is the multi-tenant bottleneck**, not Drive's.

## Sources

1. Docs, "Work with comments and suggestions" (last updated 2026-09-30): https://developers.google.com/workspace/docs/api/how-tos/suggestions
2. Docs `documents.batchUpdate` reference (WriteControl, WriteMode, SuggestionResponse, commentUpdateState, scopes): https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate
3. Docs `Document` resource (SuggestionThread, Post, PostAuthor, comments[], suggestions[], revisionId; last updated 2026-10-09): https://developers.google.com/workspace/docs/api/reference/rest/v1/documents
4. Docs batchUpdate requests (AcceptSuggestionRequest, RejectSuggestionRequest, DeleteSuggestionRequest, comment requests; last updated 2026-10-09): https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/request
5. Drive, "Choose Google Drive API scopes" (last updated 2026-09-03): https://developers.google.com/workspace/drive/api/guides/api-specific-auth
6. Docs, "Choose scopes" (last updated 2026-09-03): https://developers.google.com/workspace/docs/api/auth
7. Drive, "Notifications for resource changes" (last updated 2026-09-17): https://developers.google.com/workspace/drive/api/guides/push
8. Workspace Events, "Subscribe to Google Drive events" (last updated 2026-09-03): https://developers.google.com/workspace/events/guides/events-drive
9. Drive API release notes (last updated 2026-09-03; entries through 2026-10-12): https://developers.google.com/workspace/drive/release-notes
10. Restricted scope verification (last updated 2026-08-19): https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
11. Docs usage limits (last updated 2026-09-03): https://developers.google.com/workspace/docs/api/limits
12. Docs API release notes: https://developers.google.com/workspace/docs/release-notes
13. Drive usage limits (last updated 2026-09-11): https://developers.google.com/workspace/drive/api/guides/limits
14. Drive, "Download and export files" (last updated 2026-09-03): https://developers.google.com/workspace/drive/api/guides/manage-downloads
15. Drive `permissions.create` (last updated 2026-09-14), https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions/create, and "Share files, folders, and drives", https://developers.google.com/workspace/drive/api/guides/manage-sharing
16. Nango providers.yaml (google, google-drive, google-sheet, google-docs, google-slides, google-forms): https://raw.githubusercontent.com/NangoHQ/nango/master/packages/providers/providers.yaml
17. Drive, "Manage comments and replies" (last updated 2026-09-10): https://developers.google.com/workspace/drive/api/guides/manage-comments
18. Drive, "Manage file revisions" (last updated 2026-09-03): https://developers.google.com/workspace/drive/api/guides/manage-revisions
19. Workspace Admin, classification labels editions: https://knowledge.workspace.google.com/admin/security/get-started-as-a-classification-labels-admin ; Drive labels overview: https://developers.google.com/workspace/drive/api/guides/about-labels
20. Drive, "Manage approvals" (last updated 2026-09-03): https://developers.google.com/workspace/drive/api/guides/approvals
21. Nango, "How to setup webhooks with Google Drive on Nango": https://nango.dev/docs/api-integrations/google-drive/webhooks
22. Workspace Events overview (subscription expiration table; last updated 2026-09-03): https://developers.google.com/workspace/events/guides
23. Drive, "Work with events from Google Drive" (last updated 2026-09-03): https://developers.google.com/workspace/drive/api/guides/events-overview
24. Workspace Events, "Choose scopes" (last updated 2026-09-03): https://developers.google.com/workspace/events/guides/auth
25. Nango, Google Drive integration page: https://nango.dev/docs/api-integrations/google-drive
26. Sheets API release notes (last updated 2026-09-03): https://developers.google.com/workspace/sheets/release-notes
27. Sheets, "Read, write, and search metadata" (last updated 2026-09-03): https://developers.google.com/workspace/sheets/api/guides/metadata
28. Sheets, "Choose scopes" (last updated 2026-09-03): https://developers.google.com/workspace/sheets/api/scopes
29. Sheets usage limits (last updated 2026-09-03): https://developers.google.com/workspace/sheets/api/limits
30. Slides usage limits (last updated 2026-09-03): https://developers.google.com/workspace/slides/api/limits
31. Slides, "Merge data into a presentation" (last updated 2026-09-03): https://developers.google.com/workspace/slides/api/guides/merge
32. Slides batchUpdate requests (image URL requirements, request list): https://developers.google.com/workspace/slides/api/reference/rest/v1/presentations/request
33. Slides API release notes (last updated 2026-09-03): https://developers.google.com/workspace/slides/release-notes
34. Slides, "Choose scopes" (last updated 2026-09-03): https://developers.google.com/workspace/slides/api/scopes
35. Forms usage limits (last updated 2026-09-03): https://developers.google.com/workspace/forms/api/limits
36. Forms `forms.responses.list` (last updated 2025-02-27): https://developers.google.com/workspace/forms/api/reference/rest/v1/forms.responses/list
37. Forms `forms.create`: https://developers.google.com/workspace/forms/api/reference/rest/v1/forms/create
38. Forms, "Publish and manage responders" (last updated 2026-09-03): https://developers.google.com/workspace/forms/api/guides/publish-form
39. Forms API release notes: https://developers.google.com/workspace/forms/release-notes
40. Forms, "Set up and receive push notifications" (last updated 2026-09-03): https://developers.google.com/workspace/forms/api/guides/push-notifications
41. OAuth 2.0 Scopes for Google APIs (Forms scope strings): https://developers.google.com/identity/protocols/oauth2/scopes
