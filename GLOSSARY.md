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

**Promotion**:
The step by which a member-scoped fact becomes org-scoped.

**Event**:
One normalized thing that happened in a source, such as an email received or sent or a Drive file created or modified, kept as its provenance and shape (time, people, thread, attachment metadata, MIME type) without its content. The code's type is `IngestedEvent`, to stay clear of the DOM's `Event`.
_Avoid_: Activity, message, record

**Backfill**:
Ingesting a connection's last 90 days when it's recorded, before polling picks up what's new.
_Avoid_: Import, initial sync

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

**Workflow version**:
An immutable snapshot of a workflow's spec, created each time the workflow is published.
_Avoid_: Revision, release

**Working spec**:
A workflow's current, unpublished spec, which admins edit and which becomes a workflow version when published.
_Avoid_: Draft spec, draft (a draft is outgoing mail)

**Enablement**:
One member's switch-on of one member-credential workflow, following its latest version.
_Avoid_: Instance, subscription, install, activation

**Run**:
One execution of one workflow version on one trigger, such as one incoming email.
_Avoid_: Execution, job, invocation

**Model role**:
The kind of model a step asks for (`classify`, `fast`, `smart` or `judge`), which each org maps to a concrete model.
_Avoid_: Model, model tier

**Paused**:
The state of a workflow or enablement that will not run, always shown together with its reason.
_Avoid_: Disabled, suspended, stopped

**Catalog action**:
One operation on an external source that a workflow is allowed to call, with a fixed risk level.
_Avoid_: Tool, integration, capability

**Risk level**:
The fixed danger class of a catalog action: read, internal-reversible, external-send, financial, or destructive.

**Draft**:
An unsent Gmail message a workflow prepared, waiting for a person to send it; Gmail's pending form.

**Pending form**:
An app's own way of holding an action until a person approves it, such as a Gmail draft, a Calendar event with no guests yet, or suggested edits in a Doc.
_Avoid_: Staged action, preview

**Review**:
One action waiting for a person's decision, shown on their Reviews page, which points at the waiting item in its app.
_Avoid_: Approval (the step that creates a review), task (a Google Tasks item), notification

**Capability request**:
A structured ask, raised when no catalog action fits, for our team to build a new one.
_Avoid_: Feature request

**Builder chat**:
The admin-only agent that turns descriptions and suggestions into proposed spec changes.
_Avoid_: Copilot, assistant

**Builder conversation**:
One chat between admins and the builder chat, optionally about one workflow.
_Avoid_: Thread (an email thread), session

**Proposal**:
A change to a workflow that the builder chat suggests and an admin accepts or rejects.
_Avoid_: Spec diff, suggestion (a suggestion comes from discovery)

### Money

**Credits**:
The org's prepaid balance, drawn down by every model call, discovery job, and eval.
_Avoid_: Tokens, usage, points

**Budget**:
An admin-set monthly credit cap on a single workflow.
_Avoid_: Limit, quota

### Memory

**Fact**:
A piece of business knowledge extracted from source data, carrying its source ref and owner scope.
_Avoid_: Memory (for a single item), note, insight
