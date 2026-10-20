# Every app holds waiting actions in its own pending form, and members review them in one place

v1 acts in Gmail, Calendar, Docs and Tasks, with Slack and Microsoft later, so we wanted one standard rather than rules worked out for email alone. Every app plugs in through four parts: a source (what Mycel reads), triggers (what starts a run), catalog actions (what a workflow may do, each with a fixed risk level), and a **pending form**: the app's own way of holding an action until a person approves it. Gmail holds a draft. Calendar holds an event with no guests yet; approving adds the guests and sends the invitations, because Google warns that saving without notifying can still reach colleagues' calendars. Docs holds suggested edits, which the person accepts or rejects in Docs, since Google offers no way for us to accept them. A Mycel **review** points at the waiting item and fetches it live, never storing its content (invariant 8). Members see every review, and every other step that needs a person, on one Reviews page, which is their main screen. We chose this over holding pending actions in Mycel's own database, which would store content we don't keep, and over approving everything in each app, which scatters a member's work across four apps with no single place to see it.

## Considered options

- Mycel stores the prepared action and performs it on approval: one approval flow for every app, but it stores content and loses the app's own editing tools.
- Approve only inside each app (Gmail drafts, Docs suggestions): no Reviews page to build, but nothing tells a member what's waiting, and Calendar has no safe native form.

## Consequences

- An app with no natural pending form, such as Slack, waits until we design one.
- Low-risk actions, such as adding a label or a task to the person's own list, need no review (invariant 4).
- People may still finish an item in the app itself, such as sending a draft from Gmail. The review then ends as "done in the app", and Mycel can't tell whether it was edited.
- A Docs review offers only "open the doc", and closes once no Mycel suggestions remain.
- Reviews of org-credential workflows go to everyone with the workflow's tags plus admins, and the first to act wins. A workflow can allow hand-off to a colleague; a member's own review can only be handed on by that member (ADR-0001).
