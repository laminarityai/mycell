# Scheduled jobs act as a per-org system ctx

Scheduled jobs (polling every connection, the nightly reconciliation, later nightly discovery) start with no user, but feature code reaches tenant data only through `forOrg(ctx)`, and connections are readable only by their owner (member connections) or an admin (org connections). Running a job as some user would break when that user is removed or demoted, and an org connection whose owner was removed has no user to run as at all. So a job lists the org IDs (`orgs`' `listOrgIds()`, the one cross-org read) and then acts inside each org as `systemCtx(orgId)`: a `Ctx` whose role is `system` and whose user ID is the reserved `"system"`.

- The system ctx stays inside its org: `forOrg` scopes it like any ctx, so tenant isolation (ADR-0003) is unchanged.
- It may read and maintain every connection in its org, member connections included, because it ingests on their owners' behalf. That reading never surfaces to a user: what users see still goes through owner-scope rules (ADR-0001).
- It passes no admin check (`ctx.role === "admin"` is false), so it can't do what only admins may, such as starting an org connection or managing users.
- Only jobs build it. Functions meant for jobs alone (`listConnectionsForJobs`) refuse any other role with `ForbiddenError`.

## Consequences

- `Ctx.role` is an `Actor` (`admin | member | system`); `Role` stays the membership role Better Auth stores.
- Event-triggered jobs that already carry a user's ctx (the backfill started when a user connects) may keep it; cron jobs use the system ctx.
