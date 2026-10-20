# M1 dogfood check

The live check for #19: our own Gmail and Drive, connected through Nango Cloud's `dev` environment, ingested by a local Mycel. Follow it top to bottom. Every check below says what the fakes assumed and how to see it for real; `m1-fake-assumptions.md` lists the assumptions with their sources. Record anything that differs on #19, and fix it in the fake as well as the code.

**One Nango environment per Mycel database.** The nightly reconciliation (#31) deletes every Nango connection that has no row in _this_ deployment's database. So the Nango `dev` environment must serve exactly one local database. Two developers sharing it with separate local databases would delete each other's connections (a run holds back only when more than 10 orphans are also more than half of what Nango lists). Give each developer their own Nango environment, or share one database.

## 1. Google Cloud: the ingest OAuth client

This client is Nango's, and is separate from the sign-in client (`GOOGLE_CLIENT_ID`), so sign-in keeps its narrow scopes (ADR-0002).

1. In the Google Cloud project owned by our Workspace org, open **APIs & Services > Library** and enable the **Gmail API** and the **Google Drive API**.
2. **Google Auth Platform > Audience**: user type **Internal**. Only accounts in our Workspace can then consent, Google skips verification of the restricted scopes, and refresh tokens don't expire after 7 days as they do for an External app in testing.
3. **Data Access > Add or remove scopes**: add `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/drive.readonly`. Nothing else.
4. **Clients > Create client**: type **Web application**, name `Mycel ingest (Nango dev)`, authorized redirect URI `https://api.nango.dev/oauth/callback`. Keep the client ID and secret for step 2.

## 2. Nango `dev` environment

In [app.nango.dev](https://app.nango.dev), switch to the `dev` environment.

1. **Integrations > Set up new integration > Gmail.** The integration ID must be exactly **`google-mail`**: Mycel uses it as the provider config key. Paste the client ID and secret from step 1, and set the scopes to `https://www.googleapis.com/auth/gmail.readonly`.
2. The same for **Google Drive**: integration ID exactly **`google-drive`**, the same client, scopes `https://www.googleapis.com/auth/drive.readonly`.
3. **Environment Settings > Webhooks**:
   - Webhook URL: `https://<tunnel host>/api/nango/webhook` (the tunnel comes in step 5; come back and set it then).
   - Turn on all three auth webhooks: **connection creation**, **auth refresh errors** and **connection deletion** (Nango's settings `on_auth_creation`, `on_auth_refresh_error`, `on_connection_deletion`). Nango always sends `override` (reconnect) webhooks; there is no toggle for them.
   - Copy the **signing key**. It is not the API key.
4. **Environment Settings > API Keys > Create**: a key scoped to
   - `environment:connect_sessions:write` (connect and reconnect sessions),
   - `environment:connections:read` (reconciliation confirms a connection is gone),
   - `environment:connections:list` (reconciliation's listing, and the preflight's key check),
   - `environment:connections:delete` (disconnect, refusals, orphans),
   - `environment:proxy` (every Gmail and Drive call),
   - `environment:integrations:read` (only the preflight uses it; the app works without it).

## 3. `app/.env`

Copy `app/.env.example` if you have no `.env` yet. Then set:

```sh
NANGO_API_KEY=<the scoped key from 2.4>
NANGO_WEBHOOK_SIGNING_KEY=<the signing key from 2.3>
INNGEST_DEV=1
# INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY stay empty: the dev server needs neither.
```

`DATABASE_URL` stays the local Postgres (`pnpm db:up` if it isn't running), and the sign-in variables stay as they are. Apply migrations with `pnpm db:migrate`, then run the preflight:

```sh
pnpm nango:preflight
```

It checks the API key, that `google-mail` and `google-drive` exist on their own providers with credentials set, that the signing key is set and isn't a placeholder or the API key, and that `INNGEST_DEV=1`. Every line must say `PASS` before you go on. It prints no secrets.

## 4. The Inngest dev server

`inngest` is pinned at 4.25.0, whose client sends to the dev server at `http://localhost:8288` when `INNGEST_DEV=1`. In its own terminal:

```sh
npx --ignore-scripts=false inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

Open <http://localhost:8288>. Once `pnpm dev` is up (next step), **Apps** shows `mycel` synced, and **Functions** lists `backfill-connection`, `poll-connections`, `poll-connection` and `reconcile-connections`. The dev server runs `poll-connections` every minute on its own.

## 5. The app and the tunnel

1. `pnpm dev` (port 3000). Browse at `http://localhost:3000`, not through the tunnel: sign-in's callback is `BETTER_AUTH_URL`.
2. In another terminal, a tunnel for Nango's webhooks, either
   - `cloudflared tunnel --url http://localhost:3000` (prints a `https://….trycloudflare.com` host), or
   - `ngrok http 3000` (prints a `https://….ngrok-free.app` host).
3. Set Nango's webhook URL (2.3) to `https://<that host>/api/nango/webhook`. A quick tunnel gets a new host every run, so update it each time. Check it with `curl -i -X POST https://<host>/api/nango/webhook -d '{}'`: the answer is `401` (unsigned), which proves the route is reachable.

Nango retries a failed webhook only twice, within a second or so. If the tunnel was down when you connected, the attempt stays "connecting…" for an hour and the orphaned Nango connection is removed by reconciliation a day later: delete it in Nango's dashboard and connect again.

## 6. Checks

Sign in as an admin of the dogfood org, open `/connections`, and keep the Inngest UI open beside it. Keep psql handy for the SQL checks:

```sh
docker compose exec postgres psql -U mycel -d mycel
```

```sql
-- Connections, newest first.
select id, kind, source, account_email, status, backfilled_items, last_polled_at
from connections order by created_at desc;
```

- [ ] **Connect your own Gmail.** _Connect Gmail_, pick your own account. The row shows "connecting…", then "Backfilling, N so far", then "Active". In Inngest, `backfill-connection` ran one `page-N` step per 100 messages. Nango's dashboard shows the connection with tags `mycel_attempt_id`, `organization_id`, `end_user_id` and `end_user_email`.
- [ ] **Connect your own Drive.** _Connect Google Drive_, the same account. Same progression, one step per 1000 files.
- [ ] **An admin connects an org inbox.** _Connect an org inbox_, then pick a shared mailbox in our domain (support@ or similar). It's listed under org connections. Do the same with _Connect an org Drive_ if we have a shared Drive account.
- [ ] **Wrong account is refused.** _Connect Gmail_ again and pick a different account in our domain (a shared mailbox you can sign into). The attempt shows "You can only connect your own account (…), not …", and the connection is gone from Nango's dashboard. An account outside our domain can't get this far: the Internal client makes Google block the consent screen ("can only be used within its organization"). Note what Connect UI and the page show then.
- [ ] **Duplicate is refused.** _Connect Gmail_ with your own account a second time: "… is already connected.", and Nango has only the first connection.
- [ ] **The backfill completes with a sensible count.** Each Gmail row ends `active`, with `backfilled_items` close to the mailbox's messages from the last 90 days, minus spam, trash and drafts (Gmail search `after:YYYY/MM/DD -in:spam -in:trash -in:drafts` estimates it). Each Drive row's count is close to your files modified in 90 days (Drive search: _Modified > Last 90 days_, My Drive and Shared with me, not shared drives). Then spot-check that nothing textual was stored:

  ```sql
  select type, actor, counterparties, label_ids, mime_type, source_ref
  from events where connection_id = '<id>' order by occurred_at desc limit 5;
  ```

- [ ] **A new email appears after a poll.** Send yourself an email from another account. Within about a minute `poll-connections` fans out a `poll-connection` run, `last_polled_at` moves, and `select count(*) from events where connection_id = '<gmail id>'` goes up by one.
- [ ] **A Drive edit appears after a poll.** Edit one of your Docs or Sheets. Within a minute or two a new `file.modified` event with that file's ID shows up (`select … from events where connection_id = '<drive id>' order by created_at desc limit 1`).
- [ ] **`needs_reauth`, then reconnect.** Revoke Mycel's access in the Google account: [myaccount.google.com/connections](https://myaccount.google.com/connections), the app named after the ingest client, _Delete all connections_. Nango finds out when it next refreshes the token, within an hour; to force it now (with `NANGO_API_KEY` exported from `app/.env`):

  ```sh
  curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $NANGO_API_KEY" \
    "https://api.nango.dev/connections/<nango_connection_id>?provider_config_key=google-mail&force_refresh=true"
  ```

  Nango's failed refresh sends `auth` / `refresh` with `success: false`, and the row shows "Needs reconnecting" with a Reconnect button; polls skip it. Until then, polls may fail on Google's 401 (note how they look in Inngest). Click Reconnect, pick the same account: the `override` webhook makes it `active`, and mail that arrived meanwhile shows up on the next poll. Reconnecting with a different account must leave it "Needs reconnecting".

- [ ] **Disconnect removes everything.** Copy a connection's `id`, then count what it owns:

  ```sql
  \set id '<connection id>'
  select (select count(*) from connections where id = :'id') as connections,
         (select count(*) from events where connection_id = :'id') as events,
         (select count(*) from object_refs where connection_id = :'id') as object_refs;
  ```

  Disconnect it on the page (confirm). Run the query again: all three are `0`. Nango's dashboard no longer has the connection. (Nango then sends a deletion webhook for it, which changes nothing.)

- [ ] **Deleted at Nango, with the webhook.** Connect a source again, let it backfill, and delete the connection in Nango's dashboard. The deletion webhook removes the row; the query above returns zeros.
- [ ] **Reconciliation, without the webhook.** Connect a source again and let it backfill. Turn the **connection deletion** webhook off (2.3), delete the connection in Nango's dashboard, and check the row is still there. In the Inngest UI, **Functions > reconcile-connections > Invoke** (empty data `{}`). The run's output lists the connection under `deletedRows`, and the query returns zeros. Turn the deletion webhook back on.

## 7. Optional: cursor expiry

Gmail keeps history "at least one week" and Drive's token lifetime is undocumented, so neither expires during a run. To see the recovery path against the real APIs, give a connection a cursor Google won't accept:

```sql
-- Gmail: a history ID far older than Gmail keeps.
update connections set cursor = '1' where id = '<gmail id>';
-- Drive: not a token at all (a small number could be a real, very old one).
update connections set cursor = 'not-a-page-token' where id = '<drive id>';
```

The next `poll-connection` run should show `recover-start`, `recover-page-N` and `recover-finish` steps, store nothing twice, and leave a fresh cursor. For Drive this confirms the least certain assumption: that a bad page token is a 400 naming `pageToken`. If either source answers something else, the poll fails instead: record the status and body on #19.

## 8. After the run

- Tick #19's criteria with what you saw, and add anything that differed from `m1-fake-assumptions.md`.
- Disconnect anything you don't want kept, or leave the dogfood connections running.
