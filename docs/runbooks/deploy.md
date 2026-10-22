# Deploy: production

How to stand up the hosted Mycel. There is one environment, production, on a `*.vercel.app` domain. Every merge to `main` deploys it. Follow this runbook top to bottom: each section ends with values that a later section needs, so keep them in a password manager vault as you go. None of them go in `app/.env`: local dev keeps its own database and its own Nango environment.

Until the first outside customer (M10), the only users and the only data are our own, so a staging environment would mostly repeat what local dev already tests against the real services (`m1-dogfood.md`). Staging and a custom domain both come before M10; see "Later" at the end.

Vendor dashboards change their labels. Each step says what to set rather than relying on where a button sits. The sources at the end are the vendor pages each step was checked against (2026-10-21).

## What you'll set up

| Service           | What                                                            | Plan                                                                                                                                                |
| ----------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel            | project `mycel`, production on `<name>.vercel.app`              | **Pro**: Hobby is non-commercial                                                                                                                    |
| Neon Postgres     | project `mycel-prod`                                            | **Launch**: Free always scales to zero and keeps 6 hours of history                                                                                 |
| Google Cloud      | a sign-in OAuth client, an ingest OAuth client, and Model Armor | free, except Model Armor past its free tier                                                                                                         |
| AWS               | KMS keys for each org, and an IAM user that manages them        | pay as you go: $1 a key a month, two keys per org                                                                                                   |
| Nango             | the `prod` environment                                          | **Free** to start: unlimited environments, 10 connections                                                                                           |
| Inngest           | the `Production` environment, via its Vercel integration        | **Pro**: the `poll-connections` cron alone uses about 130k executions a month (3 a minute), each connection about 130k more, and Free pauses at 50k |
| Vercel AI Gateway | API key `mycel-prod`                                            | credits or a payment method on the Vercel team                                                                                                      |

The order matters in one place: Google and Nango need the app's host, so the Vercel project comes before them.

## 1. Neon Postgres

If you already made a Neon project (say `mycel-staging`), reuse it: rename it to `mycel-prod` under **Settings → General**, check it's on Postgres 17 in `us-east-1`, and apply steps 2 to 5. Otherwise create one:

1. At console.neon.tech, in the company organization on the **Launch** plan, **New Project**:

   | Field            | Value                                                                       |
   | ---------------- | --------------------------------------------------------------------------- |
   | Project name     | `mycel-prod`                                                                |
   | Postgres version | **17**: CI and `docker-compose.yml` run `pgvector/pgvector:0.8.7-pg17`      |
   | Cloud provider   | AWS                                                                         |
   | Region           | **US East (N. Virginia), `us-east-1`**, next to Vercel's `iad1` (section 2) |
   | Neon Auth        | **Off** (see below)                                                         |

   Keep the default database `neondb` and role `neondb_owner`; the app only reads `DATABASE_URL`.

   Neon Auth is Better Auth hosted by Neon. Mycel runs Better Auth itself (`src/features/orgs/lib/auth.ts`), with:
   - the organization plugin's custom `workspaceDomain` field;
   - the `validateUserInfo` and session hooks that enforce one org per Workspace domain (ADR-0002);
   - its own tables, which `forOrg(ctx)` points at.

   Neon's managed version supports the organization plugin only partially and keeps users in a separate `neon_auth` schema.

2. **Branches → `production` → Compute → Edit:** autoscaling **0.25 to 2 CU**, scale to zero **off**. The every-minute poll keeps the database awake anyway, and with it off no one waits for a cold start at sign-in. That's roughly $20 a month of compute.
3. **Settings → Instant restore (history window): 7 days.** That's Launch's maximum, and the architecture doc keeps backups under 30 days.
4. **Branches → `production` → ⋯ → Set as protected.**
5. Leave the **Data API** off.
6. Click **Connect** (branch `production`, database `neondb`, role `neondb_owner`) and copy the connection string twice:
   - **With connection pooling on** (the host contains `-pooler`). This is the app's `DATABASE_URL`. `src/db/client.ts` opens a `pg` Pool per serverless instance, so it needs Neon's PgBouncer. The app uses no `SET`, advisory locks or `LISTEN`, so transaction pooling is safe.
   - **With connection pooling off** (direct). This one is for migrations and scripts only; Neon recommends direct connections for migrations.
7. Migrate, from the repo root, with the **direct** string:

   ```sh
   DATABASE_URL='<direct string>' pnpm db:migrate
   ```

   `db:migrate` loads `app/.env` with `--env-file-if-exists`, which never overrides a variable already set in the shell. Your `DATABASE_URL` wins, and your local `.env` supplies the rest of what `drizzle.config.ts` → `env.ts` requires.

8. Check:

   ```sh
   psql '<direct string>' -c '\dx vector' -c 'select count(*) from drizzle.__drizzle_migrations;'
   ```

   You should see that `vector` is installed, and that the count equals the number of `.sql` files in `app/src/db/migrations/`. Neon ships pgvector 0.8.0 on PG17, and Mycel has no vector columns yet.

**Values out:** the pooled string and the direct string.

## 2. Vercel project: get the host

1. **Add New → Project → Import** `laminarityai/mycell`. The Vercel GitHub app needs access to the repository.
2. Set **Root Directory: `app`**. The framework preset is Next.js. Leave the build and install commands at their defaults (Vercel finds `pnpm-lock.yaml` at the repo root).
3. Deploy. **This first deployment fails, and that's expected:** there are no environment variables yet, so `env.ts` stops the build. You only need the project to exist.
4. **Settings → Domains** shows the production domain, `<name>.vercel.app`. Vercel bases it on the project name, adding a suffix if the plain one is taken. If you want a different free name, edit it there now, because everything below is tied to it. From here on it's `<host>`.
5. Change these settings:
   - **Settings → Build and Deployment → Node.js Version: 24.x.** `.nvmrc` and `engines` say 24.
   - **Settings → Functions → Function Region: Washington, D.C., USA (`iad1`)**, next to Neon's `us-east-1`. The builder chat and the workflow page set `maxDuration = 300`, which Pro allows.
   - **Settings → Environments → Production → Branch Tracking: `main`** (the default).
   - **Settings → Build and Deployment → Ignored Build Step**, with this custom command:

     ```sh
     [ "$VERCEL_ENV" = "production" ] && exit 1 || exit 0
     ```

     Exit 0 skips the build. Without this, other branches and pull requests would build as Preview, which has no variables and couldn't sign anyone in (Google redirects only to `<host>`). CI already runs `pnpm verify` on every push.

   Leave **Deployment Protection** at Standard Protection. It covers every domain except production domains, and `<host>` is the production domain, so Nango's webhooks and Inngest can reach it.

**Values out:** `<host>`.

## 3. Google Cloud: two OAuth clients

Both clients live in the Google Cloud project owned by our Workspace org (the one `m1-dogfood.md` uses). Sign-in and ingest are separate clients, so sign-in keeps its narrow scopes (ADR-0002).

1. **APIs & Services → Library:** check that the Gmail API, Google Drive API, Google Sheets API, Google Calendar API, Google Docs API and Google Tasks API are enabled.
2. **Google Auth Platform → Audience:** set it to **Internal**. Then only accounts in our Workspace can consent, Google skips verification of the restricted scopes, and refresh tokens don't expire after 7 days. Together with the `hd` check at sign-in, this is what limits the app to our Workspace, though anyone can reach the URL.
3. **Branding:** set the app name to `Mycel` and a support email, if not already set.
4. **Data Access:** add exactly the six scopes Mycel asks for (`GOOGLE_APP_SCOPES` in `connections/types.ts`), and nothing else:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/drive.readonly`
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/documents`
   - `https://www.googleapis.com/auth/tasks`
5. **Clients → Create client**, type **Web application**, twice:

   | Client  | Name                        | Authorized JavaScript origin | Authorized redirect URI                   |
   | ------- | --------------------------- | ---------------------------- | ----------------------------------------- |
   | Sign-in | `Mycel sign-in (prod)`      | `https://<host>`             | `https://<host>/api/auth/callback/google` |
   | Ingest  | `Mycel ingest (Nango prod)` | none                         | `https://api.nango.dev/oauth/callback`    |

   The sign-in client needs no scopes beyond Better Auth's defaults (`openid`, `email`, `profile`).

**Values out:** the sign-in client's ID and secret, and the ingest client's ID and secret.

## 4. Nango

Don't use Nango's test credentials. Nango's Google page says "Nango doesn't provide a test OAuth app for Google yet." Its test apps exist only for the one-app providers (`google-mail`, `google-drive`), which Mycel keeps only for connections from before ADR-0014.

1. At app.nango.dev, switch to the **`prod`** environment and do everything below in it.

   **One Nango environment per Mycel database.** The nightly reconciliation (`reconcile-connections`, 03:00 UTC) deletes every Nango connection that has no row in its own database. Local dev stays on `dev`, and a future staging gets its own environment.

2. **Integrations → Set up new integration.** Pick the provider named just **Google** (not Gmail or Google Drive):
   - **Integration ID: `google`**, exactly. The code uses it as the provider config key.
   - Client ID and secret: the **ingest** client from section 3.
   - Scopes: the six from section 3.4.
3. **Environment Settings → Webhooks:**
   - Webhook URL: `https://<host>/api/nango/webhook`.
   - Turn on **connection creation**, **auth refresh errors** and **connection deletion**. Nango always sends `override` (reconnect) webhooks; there's no toggle for them.
   - Copy the **signing key**. It's a different key from the API key.
4. **Environment Settings → API Keys → Create** a key with these scopes:
   - `environment:connect_sessions:write` (connect and reconnect)
   - `environment:connections:read` (reconciliation confirms a connection is gone)
   - `environment:connections:list` (reconciliation's listing)
   - `environment:connections:delete` (disconnect, refusals, orphans)
   - `environment:proxy` (every Google API call)
   - `environment:integrations:read` (only the preflight uses it)
5. Check it from your laptop, at the repo root:

   ```sh
   NANGO_API_KEY='<API key>' NANGO_WEBHOOK_SIGNING_KEY='<signing key>' INNGEST_DEV=1 \
     pnpm nango:preflight
   ```

   The values in the shell override `app/.env`. `INNGEST_DEV=1` is there only because the preflight requires it. Every line must say `PASS`.

**Values out:** `NANGO_API_KEY` and `NANGO_WEBHOOK_SIGNING_KEY`.

## 5. Inngest

1. At app.inngest.com, put the account on the **Pro** plan.
2. Install the **Vercel integration** (Inngest's integrations settings → Vercel), and enable it for the project `mycel` with the serve path `/api/inngest`. It does two things:
   - It sets `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` in the Vercel project for you.
   - It syncs the app to Inngest's **Production** environment on every production deploy.

   Without the integration, you'd copy the event key (Manage → Event Keys) and signing key (Manage → Signing Key) into Vercel by hand. Then you'd also have to sync after any deploy that changes a job (section 10).

3. **The encryption key.** Inngest keeps what runs pass between steps for as long as it keeps run history (7 days on Pro). Inngest's encryption middleware encrypts it under one app key first (ADR-0021, `src/lib/inngest.ts`), so Inngest stores only ciphertext. Make the key, and keep it in the vault:

   ```sh
   openssl rand -base64 32
   ```

   Don't change it casually. Runs in flight, and the history Inngest still holds, can only be read with the key they were written under.

**Values out:** `INNGEST_ENCRYPTION_KEY`. Check that the integration's two keys appear under the Vercel project's environment variables.

## 6. Vercel AI Gateway

1. In the Vercel team, go to **AI Gateway → API Keys → Create key**:
   - Name: `mycel-prod`.
   - Budget: about $50 monthly to start, with alerts at 75% and 100%. Over budget, the gateway answers `402` until the period resets.
   - Copy the key straight away; it can't be shown again.
2. **Spend attribution:** an owner sets the key's attribution to the **team**. A key attributed to a member counts against that member, and Vercel deactivates a member's keys when they leave. (`env.ts` requires `AI_GATEWAY_API_KEY`, so Vercel's OIDC token isn't an option without a code change.)
3. **Billing:** budgets don't buy anything. The team needs AI Gateway credits or a payment method before the first call; check the AI Gateway overview.

**Values out:** `AI_GATEWAY_API_KEY`.

## 7. AWS KMS: the key store

Mycel keeps two KMS keys per org (ADR-0020, ADR-0024, `key-store/lib/kms.ts`). One encrypts held sends. The other is an HMAC key that hashes memory's do-not-learn list. The app makes both the first time an org needs them, under the aliases `alias/mycel/org/<orgId>` and `alias/mycel/org/<orgId>/hash`. The production app won't start without `KMS_REGION`.

1. Use an AWS account that holds nothing else of Mycel's, or at least no other environment's keys. Local dev and tests use LocalStack or their own alias prefix, never these keys.
2. **IAM → Policies → Create policy**, named `mycel-prod-key-store`, with this JSON (put in your account ID):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": "kms:CreateKey", "Resource": "*" },
       {
         "Effect": "Allow",
         "Action": [
           "kms:DescribeKey",
           "kms:GenerateDataKey",
           "kms:Decrypt",
           "kms:GenerateMac",
           "kms:ScheduleKeyDeletion",
           "kms:CreateAlias",
           "kms:DeleteAlias"
         ],
         "Resource": "arn:aws:kms:us-east-1:<account>:key/*"
       },
       {
         "Effect": "Allow",
         "Action": ["kms:CreateAlias", "kms:DeleteAlias"],
         "Resource": "arn:aws:kms:us-east-1:<account>:alias/mycel/org/*"
       }
     ]
   }
   ```

   Creating or deleting an alias needs permission on both the alias and the key, which is why both statements list them.

3. **IAM → Users → Create user** `mycel-prod-key-store`, with no console access, and attach the policy. Then **Security credentials → Create access key** (use case: "Application running outside AWS") and copy both halves.

Vercel reserves the `AWS_*` names, so the app reads `KMS_*` instead. Each key costs $1 a month, and a key scheduled for deletion (when an org is deleted) is gone after 7 days.

**Values out:** `KMS_REGION` (`us-east-1`), `KMS_ACCESS_KEY_ID`, `KMS_SECRET_ACCESS_KEY`.

## 8. Model Armor: the injection screen

Content fetched for a model is screened for prompt injection first, by Google Cloud Model Armor (`models/lib/model-armor.ts`). Google's user data policy requires this for apps on restricted scopes. The app starts without it, but **memory then learns nothing**: every item is skipped as unscreened. Mycel reaches Model Armor with no stored key. The Vercel deployment's OIDC token is swapped for a service account's token (Workload Identity Federation).

All of this is in the same Google Cloud project as section 3.

1. **Vercel → Settings → Security → Secure backend access with OIDC federation:** on, with issuer mode **Team**. Note the team's slug from its URL.
2. **APIs & Services → Library:** enable the **Model Armor API**, the **IAM Service Account Credentials API** and the **Security Token Service API**.
3. **Model Armor → Create template:**
   - Template ID `mycel-screen`, location **`us`** (multi-region).
   - Turn on **Prompt injection and jailbreak detection**. The other filters can stay off: Mycel reads only this filter's result.
   - Leave **logging off**. Model Armor's logs would write the screened text, which is email and doc content, to Cloud Logging (invariant 8).
   - Its resource name is `projects/<project-id>/locations/us/templates/mycel-screen`.
4. **IAM & Admin → Workload Identity Federation → Create pool**, with ID `vercel`. Add an **OIDC** provider with ID `vercel`:
   - Issuer URL: `https://oidc.vercel.com/<team-slug>`.
   - Audience: **Allowed audiences**, `https://vercel.com/<team-slug>`. The app asks for Vercel's default audience, so the provider's own default audience won't match.
   - Attribute mapping: `google.subject` = `assertion.sub`.
5. **IAM & Admin → Service Accounts → Create** `mycel-screen`, with the role **Model Armor User** (`roles/modelarmor.user`) on the project. Then, on the service account's **Permissions**, grant **Workload Identity User** (`roles/iam.workloadIdentityUser`) to this principal, with the project _number_:

   ```
   principal://iam.googleapis.com/projects/<project-number>/locations/global/workloadIdentityPools/vercel/subject/owner:<team-slug>:project:mycel:environment:production
   ```

   Only the production deployments of the project `mycel` can then act as it.

**Values out:** `MODEL_ARMOR_TEMPLATE`, `GCP_WORKLOAD_IDENTITY_PROVIDER` (`projects/<project-number>/locations/global/workloadIdentityPools/vercel/providers/vercel`), `GCP_SERVICE_ACCOUNT_EMAIL` (`mycel-screen@<project-id>.iam.gserviceaccount.com`).

## 9. Vercel: variables and the first real deploy

1. **Settings → Environment Variables**, scoped to **Production** only. Mark every secret **Sensitive**.

   | Variable                         | Value                                                |
   | -------------------------------- | ---------------------------------------------------- |
   | `DATABASE_URL`                   | the Neon **pooled** string (section 1)               |
   | `BETTER_AUTH_SECRET`             | the output of `openssl rand -base64 32`              |
   | `BETTER_AUTH_URL`                | `https://<host>`, with no trailing slash             |
   | `GOOGLE_CLIENT_ID`               | the **sign-in** client (section 3)                   |
   | `GOOGLE_CLIENT_SECRET`           | the **sign-in** client                               |
   | `NANGO_API_KEY`                  | from section 4                                       |
   | `NANGO_WEBHOOK_SIGNING_KEY`      | from section 4                                       |
   | `INNGEST_EVENT_KEY`              | set by the Inngest integration (section 5)           |
   | `INNGEST_SIGNING_KEY`            | set by the Inngest integration                       |
   | `INNGEST_ENCRYPTION_KEY`         | from section 5                                       |
   | `AI_GATEWAY_API_KEY`             | from section 6                                       |
   | `KMS_REGION`                     | `us-east-1`                                          |
   | `KMS_ACCESS_KEY_ID`              | from section 7                                       |
   | `KMS_SECRET_ACCESS_KEY`          | from section 7                                       |
   | `MODEL_ARMOR_TEMPLATE`           | from section 8                                       |
   | `GCP_WORKLOAD_IDENTITY_PROVIDER` | from section 8                                       |
   | `GCP_SERVICE_ACCOUNT_EMAIL`      | from section 8                                       |
   | `MODEL_CLASSIFY`                 | `typesafe-ai/jev-1.14.0` (keep Jev's version pinned) |
   | `MODEL_FAST`                     | as in `app/.env.example`                             |
   | `MODEL_SMART`                    | as in `app/.env.example`                             |
   | `MODEL_JUDGE`                    | as in `app/.env.example`                             |

   Leave these unset:
   - `INNGEST_DEV`: unset means Inngest Cloud.
   - `NANGO_API_URL` and `AI_GATEWAY_BASE_URL`: only the e2e tests set them.
   - `CREDITS_PER_USD`, the `CREDIT_ESTIMATE_*` variables, `MODEL_EMBED` and `KMS_ALIAS_PREFIX` (`mycel`): they have defaults. Change `MODEL_EMBED` only together with the stored vectors, which must keep one size.
   - `KMS_ENDPOINT`: only LocalStack needs it.

   Vercel sets `NODE_ENV` itself.

2. **Deployments → the failed first deployment → Redeploy.** Vercel applies variables only to new deployments. If the build stops in `env.ts`, the error names the missing variable.

## 10. Wire it together and check

1. **The app answers:** open `https://<host>` and check that the sign-in page loads.
2. **Nango reaches the webhook:**

   ```sh
   curl -i -X POST https://<host>/api/nango/webhook -d '{}'
   ```

   A `401` from our route means it's reachable and checking signatures. An HTML page or a redirect to vercel.com means Deployment Protection is in the way: check that `<host>` is the production domain.

3. **Inngest is synced:** in Inngest's Production environment, **Apps** lists `mycel` with 25 functions, including `poll-connections`, `reconcile-connections` and `check-waiting-reviews`. If it isn't there, use **Sync new app** with `https://<host>/api/inngest`. From now on, `poll-connections` runs every minute.
4. **The first sign-in makes the admin.** The first person from a Workspace domain to sign in creates that domain's org and becomes its admin. Everyone after joins as a member (`orgs/lib/sign-in.ts`). So the person who should be admin signs in first.
5. **Grant credits.** Every model call checks the balance first, and there's no credits UI until M7. Find the org's ID, then grant:

   ```sh
   psql '<direct string>' -c 'select id, workspace_domain from organization;'
   DATABASE_URL='<direct string>' pnpm credits:grant <orgId> 50000
   ```

   At the default `CREDITS_PER_USD=1000`, 50,000 credits is $50 of gateway cost.

Smoke test, with Inngest's **Runs** open beside the app:

- [ ] **Sign in** with a Workspace account: you land in the org as admin. A personal Gmail account is turned away.
- [ ] **Connect Google** on `/connections` and allow every app. The row goes "connecting…", then "Backfilling", then "Active". Inngest shows `backfill-connection`, then `poll-connection` every minute. Nango's `prod` environment shows the connection.
- [ ] **A new email shows up:** send yourself one. Within about a minute, a `poll-connection` run picks it up.
- [ ] **The builder chat answers.** That's a real model call through the gateway, so the key's spend moves on the API Keys page.
- [ ] **Run state is encrypted:** open any run in Inngest and look at a step's output. It's ciphertext, not readable JSON.
- [ ] **Memory learns:** after the backfill, `memory-learn-item` runs succeed rather than skipping items as unscreened. Model Armor's page in Google Cloud shows requests, and AWS KMS lists the org's keys under `alias/mycel/org/`.
- [ ] **Reconciliation runs clean:** Inngest → Functions → `reconcile-connections` → Invoke with `{}`. Its output deletes nothing.

Section 6 of `m1-dogfood.md` has deeper checks (wrong account, duplicates, `needs_reauth`, cursor expiry). They work the same here, with psql pointed at the direct string.

## Every deploy after

Merging to `main` deploys production. Nothing below runs automatically yet:

- **Migrations.** When a pull request adds a file under `app/src/db/migrations/`, run `DATABASE_URL='<direct string>' pnpm db:migrate` just before merging it. Migrations are additive in practice, so the old code keeps working on the new schema for the minute until the deploy lands.
- **Inngest sync** happens on each deploy through the integration. Without it, re-sync after a change that adds a job or changes its triggers or concurrency: **Apps → mycel → Resync**, or `curl -X PUT https://<host>/api/inngest`.
- **Keys.** To rotate a Nango, gateway or AWS access key, update the Vercel variable and redeploy. Don't rotate `INNGEST_ENCRYPTION_KEY` that way (section 5).

## Later

### A custom domain (before M10)

`*.vercel.app` is fine while the users are us. Get a real domain before outside customers arrive, because Google's verification of an External app asks for a home page and privacy policy on a domain we own. When you move:

1. In **Vercel → Settings → Domains**, add the domain to Production and add the DNS record Vercel shows.
2. Set `BETTER_AUTH_URL` to the new host and redeploy.
3. Update the **sign-in** client's JavaScript origin and redirect URI in Google Cloud. The ingest client doesn't change, since it redirects to Nango.
4. Update the Nango webhook URL.
5. Re-sync the Inngest app at the new URL. The integration does this on the next deploy.
6. Everyone signs in again: sessions are cookies on the old host. Connections are untouched.

### Gmail push (M15)

Once #143 to #145 are deployed, Gmail can tell Mycel about new mail instead of waiting for the minute poll (ADR-0026). In the Google Cloud project that holds the ingest client:

1. Link a **billing account** and enable the **Cloud Pub/Sub API**.
2. **Pub/Sub → Topics → Create topic:** `gmail-push`, with no default subscription. Its full name, `projects/<project ID>/topics/gmail-push`, is `GMAIL_PUSH_TOPIC`.
3. On the topic, **Permissions → Add principal:** `gmail-api-push@system.gserviceaccount.com`, role **Pub/Sub Publisher**. Without it, Gmail's watch calls fail.
4. **IAM → Service accounts → Create:** `gmail-push-sender`, with no roles. Its email is `GOOGLE_PUSH_SERVICE_ACCOUNT`.
5. **Pub/Sub → Subscriptions → Create subscription** on `gmail-push`:
   - Delivery type **Push**, endpoint `https://<host>/api/google/gmail-push`.
   - **Enable authentication**, service account `gmail-push-sender`, audience `https://<host>/api/google/gmail-push`. That URL is `GOOGLE_PUSH_AUDIENCE`.
   - Retry policy: exponential backoff.

   If Google Cloud says the Pub/Sub service agent can't create tokens for the account, grant `service-<project number>@gcp-sa-pubsub.iam.gserviceaccount.com` the **Service Account Token Creator** role on `gmail-push-sender`.

6. In Vercel, set the three variables for Production and redeploy. Watches start as each Gmail backfill finishes, and the daily `renew-watches` run starts them on connections that were already active. Invoke it in Inngest to start them at once.
7. Run the checks in #146.

Moving to a custom domain later means updating the subscription's endpoint and audience, and `GOOGLE_PUSH_AUDIENCE`.

### Staging (before M10)

Once customers depend on production, add staging so migrations and releases run against real services first. It needs:

- **Neon:** its own project, `mycel-staging`, not a branch. A Neon branch starts as a copy of its parent's data.
- **Google Cloud:** its own sign-in and ingest clients.
- **Nango:** its own environment, for the same reconciliation reason as above.
- **Inngest:** a custom environment (Inngest's environments page → Create environment), with its event and signing keys set by hand. The Vercel integration maps only Vercel's Production and Preview.
- **Vercel:** a `staging` custom environment (one is included on Pro), tracking `main`. Move Production's branch tracking to a `production` branch, and release with `git push origin main:production`.
  - Change the Ignored Build Step to `[ "$VERCEL_TARGET_ENV" = "preview" ] && exit 0 || exit 1`. `VERCEL_ENV` is `preview` for custom environments too.
  - Standard Protection covers a custom environment's domain. Add it under **Deployment Protection Exceptions** so Nango and Inngest can reach it.
- **The AI Gateway:** its own key, with a small budget.

### Other apps

Only Google is wired up (`sourceSchema` in `connections/types.ts`). Microsoft 365 and Slack arrive in M10, and HubSpot, QuickBooks and the rest after it (`docs/research/integrations/`). Each needs:

- its own OAuth app at the vendor, redirecting to `https://api.nango.dev/oauth/callback`;
- an integration in Nango.

Their reviews take weeks: Microsoft's publisher verification, Slack's Marketplace review, and HubSpot's Marketplace review (up to 21 business days).

### Google for outside customers (M10)

The ingest client must move from Internal to External. `gmail.modify` and `drive.readonly` are restricted scopes, which means restricted-scope verification plus a yearly CASA security assessment. Start it early.

## Sources

- Neon: [pricing](https://neon.com/pricing), [connection pooling](https://neon.com/docs/connect/connection-pooling), [extensions](https://neon.com/docs/extensions/pg-extensions), [Neon Auth](https://neon.com/docs/auth/overview) and [its roadmap](https://neon.com/docs/auth/roadmap)
- Nango: [Google](https://nango.dev/docs/api-integrations/google), [pricing](https://www.nango.dev/pricing)
- Inngest: [pricing](https://www.inngest.com/pricing), [environments](https://www.inngest.com/docs/platform/environments), [Vercel](https://www.inngest.com/docs/deploy/vercel), [environment variables](https://www.inngest.com/docs/sdk/environment-variables)
- Vercel: [environments](https://vercel.com/docs/deployments/environments), [system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables), [deployment protection](https://vercel.com/docs/deployment-protection), [AI Gateway authentication](https://vercel.com/docs/ai-gateway/authentication-and-byok), [AI Gateway budgets](https://vercel.com/docs/ai-gateway/observability-and-spend/budgets)
