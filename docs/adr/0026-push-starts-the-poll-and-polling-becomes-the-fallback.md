# Push starts the poll, and polling becomes the fallback

Ingest polls every connection every minute (an Inngest cron), which makes a new email wait up to a minute before it's stored or starts a run. It also costs about 130k Inngest executions per connection per month, even when nothing changed. Gmail, Drive, Calendar, Outlook, Slack and HubSpot can all tell us when something changed. So an app that can do this gets a **watch** (a standing request to notify Mycel about one account), and a notification only starts the poll Mycel already has: the existing `discovery/connection.poll-due` event, for that one connection. The poll then reads everything new from the app's stored cursor, as it does today. Polling stays as a slower sweep that catches whatever a notification missed.

- **A notification is a doorbell, never the delivery.** Gmail's notification holds only `{emailAddress, historyId}`, and Drive's holds nothing at all. We never trust what one says: the connector's `poll(client, cursor)` stays the only way items come in. Connectors, normalizing, storage, announcing and runs don't change, and a forged or repeated notification costs one extra poll at most.
- **The sweep.** The cron keeps running every minute. It now polls an app only if that app has no live watch, or hasn't been polled for 15 minutes. An app without push (Tasks, Contacts, Drive until its watch is built) is still polled every minute.
- **Bursts are merged.** Gmail sends up to one notification a second per mailbox. The poll job debounces per connection, and its existing limit of one run per connection keeps cursors from racing. A push polls all of the connection's active apps; polling Drive too costs one cheap call.
- **Google's notifications come to our own routes.** Gmail publishes to our Pub/Sub topic. A push subscription posts each notification to a Mycel route handler, and the route checks Google's signed token: our audience, and our push service account as the sender. Drive and Calendar post to a route through a channel whose ID and token we choose, so the route finds the connection from the token. Apps that Nango forwards webhooks for (Outlook, Slack, HubSpot) arrive at `/api/nango/webhook`. Every path ends in the same `poll-due` event.
- **Finding the org for a Gmail notification.** The address is all we get, so the route first looks for a user with that sign-in address, and takes their org. A member connection is always its owner's own address (ADR-0002, ADR-0014), including a Workspace secondary-domain address. Failing that, it takes the org whose Workspace domain is the address's domain, where every org connection's address must be. Inside that org, as its system ctx (ADR-0009), it finds the connections with that address and an active Gmail.
  - This reads only the orgs feature's identity tables and returns only an org ID, like sign-in's own domain lookup. It is not a cross-org read of tenant data, so invariant 1 holds.
  - The route answers 2xx even for an address it can't place, so Pub/Sub doesn't redeliver it, and stores nothing.
- **Watch lifecycle.**
  - **Start:** when an app's backfill finishes and it turns `active`.
  - **Store:** the watch's expiry, on that app's ingest state, which cascades with the connection (invariant 3).
  - **Renew:** every live app daily, by a cron that acts as each org's system ctx (ADR-0009). That also restarts a watch that lapsed, failed, or was never started.
  - **Stop:** we never call stop. By the time a connection is deleted, its token is gone, and the `connections` feature can't reach a connector. A watch on a deleted connection runs out within its lease (7 days for Gmail, a week at most for Drive). Until then its notifications find no connection and are dropped.
- **Push is optional per environment.** Without the Pub/Sub settings, as in local dev and the tests, no watch starts and every app is polled every minute, as today.

## Considered options

- **Push only, no polling.** Rejected. Gmail drops notifications above one a second per user, watches lapse when renewal fails, and Pub/Sub deliveries can fail past their retries. Without the sweep, those emails would never arrive.
- **Nango's Gmail webhook path.** In it, Pub/Sub posts to Nango, which matches `emailAddress` against a hash in the connection's configuration. Rejected: it's documented for the one-app `google-mail` provider, and Mycel uses the generic `google` one (ADR-0014), whose docs say nothing about Pub/Sub.
- **A Pub/Sub topic per org,** so the subscription itself would name the org. Rejected: it means creating Google Cloud resources every time an org signs up.
- **A table from address to connection, read across orgs.** Rejected: it would be a cross-org read of tenant data, an exception to invariant 1. Identity tables already answer the question.
- **Google's Workspace Events API for Drive.** Rejected for ingest: it watches one file, folder or shared drive at a time. `changes.watch` covers a person's whole Drive.

## Consequences

- A new email is stored, and starts its runs, within seconds rather than up to a minute.
- Inngest executions per connection fall about tenfold. The cron's own cost is fixed: about 130k executions a month while it runs every minute. Once every ingested app has push, the sweep cron can run every 5 minutes instead.
- The Google Cloud project needs billing, the Pub/Sub API, a topic that Gmail's service account can publish to, and a push subscription with its own service account.
- Drive's channels post to a URL directly. Check whether Google still requires the receiving domain to be verified, which may need the custom domain before Drive push can ship.
- Calendar's invite trigger (#70) polls every minute with a sync token. It can move onto `events.watch` the same way later.
