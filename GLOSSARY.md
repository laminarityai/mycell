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
One authorised link between a user or the org and an external source such as a Gmail inbox.
_Avoid_: Integration, account, link

**Member connection**:
A connection to a member's own source, whose data is member-scoped.

**Org connection**:
A connection to a shared source (such as a support@ inbox), owned by an admin, whose data is org-scoped.
_Avoid_: Shared connection

**Owner scope**:
Whether a piece of data belongs to one member or to the whole org.

**Promotion**:
The step by which a member-scoped fact becomes org-scoped.

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

**Enablement**:
One member's switch-on of one member-credential workflow, following its latest version.
_Avoid_: Instance, subscription, install, activation

**Paused**:
The state of a workflow or enablement that will not run, always shown together with its reason.
_Avoid_: Disabled, suspended, stopped

**Catalog action**:
One operation on an external source that a workflow is allowed to call, with a fixed risk level.
_Avoid_: Tool, integration, capability

**Risk level**:
The fixed danger class of a catalog action: read, internal-reversible, external-send, financial, or destructive.

**Draft**:
Output intended for the outside world that waits for a human to send or approve it.

**Capability request**:
A structured ask, raised when no catalog action fits, for our team to build a new one.
_Avoid_: Feature request

**Builder chat**:
The admin-only agent that turns descriptions and suggestions into proposed spec changes.
_Avoid_: Copilot, assistant

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
