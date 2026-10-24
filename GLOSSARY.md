# Mycel

Mycel finds repetitive work in a small company's existing tools and turns it into supervised AI workflows the team can switch on.

## Language

### People and access

**Org**:
One customer company; the boundary nothing crosses.
_Avoid_: Tenant, workspace, account, company

**Admin**:
A user who connects org sources, shapes and publishes workflows, and sees everything the org is allowed to see.
_Avoid_: Owner, manager

**Member**:
A user who can only see, enable, and disable workflows published to their tags.
_Avoid_: End user, teammate, seat

**Tag**:
An admin-made label on users that decides which workflows each member can see.
_Avoid_: Group, team, role

### Sources and data

**Connection**:
One authorised link between a user or the org and an external account, such as one person's Google account.
_Avoid_: Integration, account, link

**Registered app**:
An app our team has registered with its vendor and set up in Mycel, so that people can connect it and the builder chat can make custom actions in it. Google and Microsoft 365 are the first.
_Avoid_: Integration, provider, connector

**Google app**:
One of the Google products a connection can reach: Gmail, Drive, Sheets, Calendar, Docs or Tasks. A person connects Google once, and the connection records which apps they allowed.
_Avoid_: Service, product, integration

**Member connection**:
A connection to a member's own source, whose data is member-scoped.

**Org connection**:
A connection to a shared source (such as a support@ inbox), owned by an admin, whose data is org-scoped.
_Avoid_: Shared connection

**Owner scope**:
Whether a piece of data belongs to one member or to the whole org.

**Access list**:
Who Mycel saw can see an item, kept on Mycel's record of it: a doc's sharing list as the app gives it; for an email the mailboxes holding it and, on one the company sent, everyone on it; for an invite the calendars holding it and, on one a colleague organised, everyone on it (never just the addresses its sender or organizer wrote). A fact is visible to anyone who can see one of its sources.
_Avoid_: Promotion (replaced), ACL, permissions

**Event**:
One normalized thing that happened in a source, such as an email received or sent or a Drive file created or modified, kept as its provenance and shape (time, people, thread, attachment metadata, MIME type) without its content. The code's type is `IngestedEvent`, to stay clear of the DOM's `Event`.
_Avoid_: Activity, message, record

**Backfill**:
Ingesting a connection's last 90 days when it's recorded, before polling picks up what's new.
_Avoid_: Import, initial sync

**Watch**:
A standing request asking an app to tell Mycel whenever something changes in one connection's account, so Mycel checks for new items right away instead of waiting for its next scheduled check. A watch runs out after a few days unless Mycel renews it.
_Avoid_: Subscription, webhook, channel

**Object**:
A business thing, such as a customer, order, or file, that several events refer to.
_Avoid_: Entity, record

**Object ref**:
A deterministic link from an event to an object, matched on an exact key such as an email address, ID, or file reference.

**Source ref**:
A pointer to the original item in its source, used to re-fetch content Mycel never keeps.
_Avoid_: Link, reference, copy

### Discovery

**Discovery**:
The continuous process of mining an org's history for repetitive work.
_Avoid_: Scan, analysis

**Suggestion**:
A ranked candidate for automation that discovery found, shown with evidence and a shadow-eval result.
_Avoid_: Recommendation, opportunity, insight

**Evidence**:
The real past items that justify a suggestion, re-fetched from their source on demand.

**Shadow eval**:
A replay of a candidate workflow against held-out past cases, scored against what the human actually did.
_Avoid_: Backtest, simulation, dry run

**Experiment**:
A throwaway investigation that settles one open decision against a rule written before it runs. Its code never ships; its only lasting output is the ADR that records the result.
_Avoid_: Spike, prototype, POC

**Rung**:
A level on the solution ladder, from 0 (rule or template, no AI) to 5 (multi-step across people).
_Avoid_: Level, tier, autonomy level

### Workflows

**Workflow**:
An automation an admin creates and publishes to tags, defined by a spec.
_Avoid_: Automation, agent, bot, flow

**Spec**:
The declarative definition of a workflow: its trigger, steps, credentials, budget, and rung.
_Avoid_: Config, definition, recipe

**Branch**:
A step where a workflow splits into paths, each with its own condition, plus an otherwise path.
_Avoid_: Fork, switch, router, if-step

**Path**:
One way out of a branch: the steps a message follows when that path's condition holds. Paths never join back up.
_Avoid_: Lane, route, arm

**Otherwise path**:
The path a message follows when no other path out of its branch applies. It stops the run unless it is given steps.
_Avoid_: Default path, else

**First match / every match**:
A branch's two ways of choosing paths: only the first path, left to right, whose condition holds, or every path whose condition holds.
_Avoid_: Exclusive / parallel, switch / router

**Workflow version**:
An immutable snapshot of a workflow's spec, created each time the workflow is published.
_Avoid_: Revision, release

**Working spec**:
A workflow's current, unpublished spec, which admins edit and which becomes a workflow version when published.
_Avoid_: Draft spec, draft (a draft is outgoing mail)

**Enablement**:
One member's switch-on of one member-credential workflow, following its latest version.
_Avoid_: Instance, subscription, install, activation

**Org switch**:
The one on/off switch of a workflow that uses an org connection, such as a support@ inbox. An admin turns it on for that connection, and the workflow then runs on new mail there for the whole org.
_Avoid_: Org enablement, global toggle

**Trigger**:
What starts a workflow's runs: a new message in Gmail, or a new invite on a person's calendar. Each workflow has one, and its connection must allow the trigger's app.
_Avoid_: Hook, watcher, event (an event is what discovery ingests)

**Invite**:
An event on a person's calendar with guests. A new one that someone else organised and the person hasn't answered yet can start a run (the Calendar trigger), and memory learns facts from any business one. Mycel keeps none of its content.
_Avoid_: Meeting request, invitation, event

**Run**:
One execution of one workflow version on one trigger, such as one incoming email or one new invite.
_Avoid_: Execution, job, invocation

**Try it**:
Running a working spec on one recent message to see what it would do, with every action that would change an app stubbed out and nothing stored. It is not a run: it has no run record. In code, `dryRun`.
_Avoid_: Test run, preview, simulation (a replay of past cases is a shadow eval)

**Model role**:
The kind of model a step or a model call asks for (`classify`, `fast`, `smart`, `judge` or `embed`), which each org maps to a concrete model. `embed` turns text into vectors for memory, and no step names it.
_Avoid_: Model, model tier

**Paused**:
The state of a workflow or enablement that will not run, always shown together with its reason.
_Avoid_: Disabled, suspended, stopped

**Alert**:
A notice in Mycel telling admins something needs them, such as a workflow paused for failing or credits running out. It goes away by itself once the cause is fixed.
_Avoid_: Notification, warning, email

**Archived**:
A workflow an admin has stopped everywhere and hidden from members. Its enablements and org switch are kept, so restoring it brings them back as they were. It isn't paused: nothing about it waits on anyone else.
_Avoid_: Deleted, retired

**Catalog action**:
One operation on an external source that a workflow is allowed to call, with a fixed risk level.
_Avoid_: Tool, integration, capability

**Default list**:
The Google Tasks list a person's own tasks go to, the first of their lists. Mycel's Tasks actions act only on it, and leave alone any task on it that someone assigned from Docs or Chat.
_Avoid_: My Tasks, task list (any list)

**Risk level**:
The fixed danger class of a catalog action: read, internal-reversible, external-send, financial, or destructive.

**Draft**:
An unsent Gmail message a workflow prepared, waiting for a person to send it; Gmail's pending form.

**Pending form**:
An app's own way of holding an action until a person approves it, such as a Gmail draft, a Calendar event with no guests yet, or suggested edits in a Doc.
_Avoid_: Staged action, preview

**Meeting**:
An event a workflow booked on a person's calendar, waiting there with no guests, private and not blocking time, until a person approves it; Calendar's pending form. Approving invites its guests, and declining deletes it.
_Avoid_: Appointment, booking (for the waiting event; booking is what the step does), invite (that's an event someone else sent)

**Review**:
One action waiting for a person's decision, shown on their Reviews page, which points at the waiting item in its app, or holds it when the app can't (ADR-0020). Its kind names what it waits on: `approval` (a draft an approval step left waiting), `escalation` (a message an escalate step handed over), `held_send` (a held send) or `calendar_event` (a meeting).
_Avoid_: Approval for the review itself (it's the step, and the kind of review that step makes), task (a Google Tasks item), notification

**Held send**:
A custom write's request, which Mycel holds, encrypted with the org's key, until a person approves or declines its review, or for 30 days, when it expires (ADR-0020). Approving sends it once, with any edits to its editable text; if its app never confirms the send, the review ends unconfirmed and it is never sent again.
_Avoid_: Queued message, outbox, staged send

**Shared review**:
A review from an org connection's run, seen by everyone who can see its workflow through its tags and by every admin. The first to act on it wins.
_Avoid_: Team review, group review

**Hand-off**:
Giving one review to a colleague, who then sees it and acts on it from the review's own connection. A workflow allows it or not; a member's own review is handed on only by that member.
_Avoid_: Delegation (that's connection access, ADR-0016), forwarding (that's sending the email on), reassign

**Custom action**:
An action one org's builder chat described as a single call to an app, usable only in that org, with its risk set by a fixed rule.
_Avoid_: Builder-made action, integration, tool

**Action set**:
Every action one org's workflows may use: the catalog actions, then that org's custom actions. Where a catalog action and a custom action share a name, the catalog action is the one used.
_Avoid_: Toolset, action registry

**Capability request**:
Code the builder chat drafts when a custom action can't do the job, sent to our team to review into the catalog.
_Avoid_: Feature request

**Agent**:
Each person's own private chat with Mycel. It answers from what that person can see in memory and in their own mail, remembers what they tell it, and acts only by running their own workflows, whose actions still wait as reviews.
_Avoid_: Assistant, copilot, bot

**Builder chat**:
The admin-only agent that turns descriptions and suggestions into proposed spec changes. It reads only company-wide memory, since its conversations are shared among admins.
_Avoid_: Copilot, assistant

**Builder conversation**:
One chat between admins and the builder chat, optionally about one workflow.
_Avoid_: Thread (an email thread), session

**Proposal**:
A change to a workflow that the builder chat suggests and an admin accepts or rejects.
_Avoid_: Spec diff, suggestion (a suggestion comes from discovery)

**Alert**:
A notice in Mycel telling admins something needs them, such as a workflow paused for failing or credits running out. It goes away by itself once the cause is fixed.
_Avoid_: Notification, warning, email

### Money

**Credits**:
The org's prepaid balance, drawn down by every model call, discovery job, and eval.
_Avoid_: Tokens, usage, points

**Budget**:
An admin-set monthly credit cap on a single workflow, or on what memory spends learning.
_Avoid_: Limit, quota

### Memory

**Fact**:
A short statement about an object that a source states or a person told Mycel, linked to the sources it came from.
_Avoid_: Memory (for a single item), note, insight, inference

**Source record**:
Mycel's record of one item memory learned from, such as an email, a version of a Drive doc or a version of a Calendar invite, as one connection holds it, with the item's access list and a pointer to re-fetch it, never its content.
_Avoid_: Document, source (the app), evidence

**Item key**:
What every copy of one item shares, such as an email's Message-ID, a Drive file's ID or an invite's iCalUID, so copies in several mailboxes, Drives or calendars are known to be the same item.

**Object key**:
An exact identifier of an object, such as a person's email address or a company's domain, unique in an org; objects with the same key are one object.

**Match candidate**:
An object that may be the same as one an item mentions, found by a similar name or facts that mean nearly the same; a model must confirm it before the two become one object.
_Avoid_: Duplicate, alias

**History** (of a fact):
The older facts a newer one replaced (superseded): same object, same kind of fact (predicate), kept with when they stopped being true and what replaced them. Each reader's current fact is the newest one they can see.
_Avoid_: Archive, old facts

**Exclusion**:
A Gmail label, Drive folder or similar that an admin keeps out of memory for the whole company.

**Company-wide list**:
A group address, such as all@, that an admin marked company-wide, so what memory learns from email sent to it is visible to everyone in the org.
_Avoid_: Public list, shared list

**Injection screen**:
The check that content fetched from a company's apps doesn't try to give a model instructions, made before any model reads it; an item it flags is skipped.
_Avoid_: Guardrail, filter, firewall

**Do-not-learn list**:
The addresses of people an admin asked Mycel to forget. Memory never learns from their mail or about anyone with their address again, but mail that names them without their address can still teach it about them.

**Retention window**:
How long memory keeps what it learned from an email or doc after it was sent or saved: 24 months, or less if an admin shortens it. Past it, the item and every fact only it supported are deleted.
_Avoid_: TTL, expiry

**Access log**:
The record of every read of memory: who or what read it (a person, the builder chat, a workflow run, our staff), when, and which objects and facts, never what they say. Admins see their company's; members see the reads of facts from their own sources.
_Avoid_: Audit trail, history

**Staff consent**:
An admin's permission for one person at Mycel to read the company's memory for one case, for a few days, in that admin's view. Our staff can't read memory without one.
_Avoid_: Access grant, support access
