# Intent

## What we're building

Mycel connects to a small company's existing tools and lets the team switch on supervised AI workflows without writing anything. Admins make workflows mainly by **describing them to the builder chat**, which is primary. Discovery runs alongside it: it finds repetitive work already happening in their inbox and spreadsheets, suggests workflows for it, and gives the builder context about how the org works (ADR-0007).

## Who it's for

Small, non-technical companies on Google Workspace. The buyer is an admin, often the owner or an ops person, who is not an engineer. Members are the teammates whose inboxes get automated. Customer #0 is our own company.

The guiding principle is **frictionless uptake**: OAuth only, nothing installed, value in the first session.

## What "good" looks like for v1

Two bars, one for each way of making workflows:

1. **Builder (the ship bar).** At least one workflow that an admin described in the builder chat (not written by us) runs live on at least two of our own inboxes for **two days and at least 20 reviews, whichever comes later**. At least 80% of its reviews are approved without edits, and the teammates who enabled it never needed our help.
2. **Discovery.** At least 3 of the top 5 suggestions are rated "real and worth automating" by the people whose work they describe.

The builder bar is measured by the review counts on the Workflows page (`reviewStats`), per workflow and per member: how many reviews were approved, edited and approved, declined, sent from Gmail, or gone, and how many still wait. "Approved without edits" is the share `approved / (approved + edited approved + declined + gone)` of the workflow's draft reviews. Drafts sent straight from Gmail are counted beside it but left out, because Mycel can't tell whether they were edited. Choose "since current version" to judge a new version on its own.

This bar is ours to revise as we learn. Change it here when it changes.

## Non-goals for v1

These are "no for v1", not "never". Where a later "yes" is likely, the architecture keeps the door open.

1. **No unsupervised external effects.** Nothing leaves the company without a human sending or approving it. No financial or destructive actions.
2. **Google apps only.** Mycel reads Gmail and Sheets/Drive, and acts in Gmail, Sheets, Calendar, Docs and Tasks. No Slack, Outlook or the rest of Microsoft, Discord, or CRMs yet. Mining Calendar or Forms comes in only if the discovery-lens experiment shows tasks that need it (ADR-0008). _More apps are likely, so each app plugs in through the same four parts (ADR-0013), and nothing outside its connector assumes Google._
3. **Nothing installed.** No browser extension, desktop app, or Gmail add-on.
4. **The builder chat never writes code.** New capabilities are built by our team via capability requests. _We are likely to try code-generating agents, so the capability-request interface stays stable enough for an agent to take over._
5. **No earned autonomy, personal agent, or full cross-app entity resolution.** _An entity backbone comes after v1, and only if the discovery-lens experiment passes (ADR-0008)._
6. **No real payments.** Credits are internal accounting. No Stripe, no self-serve signup.
7. **No admin-level data access.** No Admin SDK Reports API and no domain-wide delegation. Only member and org connections exist (ADR-0008).
