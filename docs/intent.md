# Intent

## What we're building

Mycel connects to a small company's existing tools, finds the repetitive work already happening in their inbox and spreadsheets, proves it could handle that work, and lets the team switch on supervised AI workflows without writing anything. Workflows are **mined, not described**: discovery from real data is the product, and the builder chat is secondary.

## Who it's for

Small, non-technical companies on Google Workspace. The buyer is an admin, often the owner or an ops person, who is not an engineer. Members are the teammates whose inboxes get automated. Customer #0 is our own company.

The guiding principle is **frictionless uptake**: OAuth only, nothing installed, value in the first session.

## What "good" looks like for v1

At least one workflow that discovery **mined** (not hand-written) runs live on at least two of our own inboxes for **two days and at least 20 drafts, whichever comes later**. At least 80% of its drafts are sent with little or no editing, and the teammates who enabled it never needed our help.

This bar is ours to revise as we learn. Change it here when it changes.

## Non-goals for v1

These are "no for v1", not "never". Where a later "yes" is likely, the architecture keeps the door open.

1. **No unsupervised external effects.** Nothing leaves the company without a human sending or approving it. No financial or destructive actions.
2. **Gmail and Sheets/Drive only.** No Outlook, Discord, or CRMs yet. _More sources are likely, so sources sit behind one connector interface and nothing outside the connectors assumes Google._
3. **Nothing installed.** No browser extension, desktop app, or Gmail add-on.
4. **The builder chat never writes code.** New capabilities are built by our team via capability requests. _Code-generating agents are a likely experiment, so the capability-request interface stays stable enough for an agent to take over._
5. **No earned autonomy, personal agent, or full cross-app entity resolution.**
6. **No real payments.** Credits are internal accounting. No Stripe, no self-serve signup.
