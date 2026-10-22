# Reviews act on someone else's connection through a delegated ctx

Shared reviews and hand-off (ADR-0013) let a person act on a review whose connection isn't theirs to read: a member with the workflow's tag approves a draft waiting in an org inbox that only admins may read, and a colleague approves a draft in the mailbox of the member who handed it to them, so it's sent from the owner's address. `connections` decides who may read a connection (`isReadableBy`: a member connection its owner, an org connection admins, the system ctx all), and `reviews` decides who may act on a review. We keep both rules and add one narrow bridge. After `reviews` has checked that the caller may see and act on a review, it calls `delegatedCtx(ctx, connectionId)` from `connections/delegation.ts`. That returns a copy of the caller's ctx, which `connections` records in a private `WeakMap`. `getConnection` and the proxy calls (`proxyGet`, `proxyPost`, `proxyPut`, `proxyDelete`) accept that copy for that one connection only, and the pending-form adapters get it in place of the caller's ctx. Nothing else changes: the copy acts as the caller everywhere else, it can't read the connection's scopes or ingest records, a ctx built by hand isn't in the map, and the connection must still be in the caller's org. A dependency-cruiser rule lets only `reviews` (and `connections`' own tests) import the entry file.

## Considered options

- Act as the system ctx: it may read every connection already, but the adapters would lose who is acting, and any bug in `reviews`' check would hand a member everything the system ctx can do.
- Widen `isReadableBy` with review rules: `connections` would have to know about tags, hand-offs and reviews, and a member who could act on one review could read the whole mailbox through every other feature.
- A flag on `Ctx`: anyone could set it, so it would be a check in name only.

## Consequences

- `reviews` is the one place that decides who may act through someone else's connection, and every read of a review checks it again, so losing a tag or a hand-off takes the access away at once.
- A new feature that needs to act on a connection on someone's behalf needs its own ADR and an entry in the dependency-cruiser rule.
- Member mail still reaches only the people its owner chose (ADR-0001): a member's review is handed on only by its owner.
