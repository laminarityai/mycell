# Stack verification

Checked 2026-10-19 against primary sources: vendor docs, npm registry metadata, GitHub source and changelogs, and first-party pricing pages. Versions are the npm `latest` on that date unless stated otherwise. Where only a secondary source exists, the text says so.

## Summary

| #   | Question                                                      | Verdict                                                                                      | Implication for Mycel                                                                                                                                          |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Mastra `addDynamicWorkflow` / `rehydrateWorkflow`             | **CONFIRMED (Beta)**                                                                         | The JSON-graph design works, but the API is Beta (breaking changes allowed in minors), so pin `@mastra/core`.                                                  |
| 2a  | Inngest + `@mastra/inngest`                                   | **CONFIRMED** for code-defined workflows. Dynamic (JSON) workflows on Inngest: **NOT FOUND** | Inngest fits backfill, cron and per-org concurrency, but specs compiled at runtime can't become Inngest functions.                                             |
| 2b  | Vercel Workflows (Workflow SDK, `"use workflow"`)             | **CONFIRMED (GA 2026-04-16)**. Mastra integration: **NOT FOUND**                             | Durable and serverless-native, but no per-key concurrency, no native cron, and no Mastra bridge.                                                               |
| 2c  | Mastra-native runner on Vercel                                | **PARTLY TRUE**                                                                              | Runs execute in-process inside Vercel functions, but the built-in cron scheduler does not fire on serverless.                                                  |
| 3   | "Jev (TypeSafe)" with calibrated probabilities via AI Gateway | **CONFIRMED** (calibration is a vendor claim)                                                | The real names are TypeSafe AI and `typesafe-ai/jev`. It's called through the Decision/TypeSafe API, not chat completions.                                     |
| 4   | "AI Gateway" = Vercel AI Gateway                              | **CONFIRMED**                                                                                | Per-request model strings, BYOK, zero markup, and per-response cost are enough to drive a credit ledger.                                                       |
| 5   | Nango Cloud capabilities                                      | **CONFIRMED, with caveats**                                                                  | Proxy bodies aren't stored. The `deletion` webhook skips bulk deletes. There is no `new_message` event.                                                        |
| 6   | Org auto-join by Google Workspace domain                      | **PARTLY TRUE**                                                                              | Better Auth does it only through the SSO plugin's DNS-verified domains, or with custom hooks. In Clerk it's a $100/mo add-on and users still accept an invite. |
| 7   | Maintained TS HDBSCAN                                         | **PARTLY TRUE**                                                                              | `hdbscan-ts` exists and is used, but it's a small single-maintainer package: Euclidean only, with a dense n×n matrix.                                          |
| 8   | Neon + pgvector + Drizzle (+ CI branching)                    | **CONFIRMED**                                                                                | Native `vector` column, distance helpers and HNSW index in Drizzle, plus `neondatabase/create-branch-action`.                                                  |

## 1. Mastra dynamic workflows

**Verdict: CONFIRMED, Beta.**

- **`Mastra.addDynamicWorkflow(def)`** is an instance method in `@mastra/core`. Signature: `addDynamicWorkflow(def: DynamicWorkflowGraph | WorkflowBuilderDefinitionInput): Promise<void>`. It validates the graph (structure, references, schema flow), persists it to the `workflowDefinitions` storage domain, and live-registers it. Re-adding the same `id` replaces it. New runs use the new graph, and in-flight runs keep the old one. A bulk variant, `addDynamicWorkflows([...])`, handles dependency-ordered bundles. Runs use the normal `getWorkflow()` → `createRun()` → `start()` path. ([reference](https://mastra.ai/reference/core/addDynamicWorkflow), [guide](https://mastra.ai/docs/workflows/dynamic-workflows.md))
- **Status:** both pages carry a **Beta** banner: "Breaking changes may occur without a major version bump until the API is stable."
- **`rehydrateWorkflow(def, mastra, opts?)`** and **`toStorableGraph(stepFlow)`** are real, lower-level exports from `@mastra/core/workflows` (`dist/workflows/dynamic/rehydrate.d.ts`, `serialize.d.ts` in 1.78.0). They are the serialize/deserialize pair that `addDynamicWorkflow` uses internally. `RehydrateWorkflowOptions.engineType` accepts only `'default' | 'evented'`.
- **History** ([core CHANGELOG](https://github.com/mastra-ai/mastra/blob/main/packages/core/CHANGELOG.md)):
  - **1.56.0** (npm 2026-08-05) added `toStorableGraph` / `rehydrateWorkflow`, plus `Mastra.addStoredWorkflow` and `removeWorkflow`. The same release added declarative `agent` / `tool` / `mapping` entries and a predicate DSL for `conditional` / `loop`.
  - **1.58.0** (npm 2026-08-12) renamed stored workflows to dynamic workflows. `addStoredWorkflow` became `addDynamicWorkflow`, and `workflow.origin` became `'dynamic'`.
  - Persistence for `workflowDefinitions` exists in the libsql, **pg**, mysql, mssql, mongodb and spanner adapters ([pg CHANGELOG](https://github.com/mastra-ai/mastra/blob/main/stores/pg/CHANGELOG.md)). Without such an adapter, definitions live only in memory.
- **Constraints relevant to `packages/spec`:**
  - Definitions are JSON, and their schemas are **JSON Schema**, not Zod.
  - Referenced agents and tools must already be registered on the Mastra instance. The save path pre-flights `listAgents()` / `listTools()`, and rehydration "hard-crashes rather than silently dropping".
  - Closure-based `.branch()` / `.dowhile()` / `.dountil()` cannot be serialized. Only the declarative predicate form survives the round trip. Closure-valued agent options such as `onFinish` or function `scorers` throw at `toStorableGraph` time.
- Current `@mastra/core` latest is **1.78.0** (2026-10-15).

## 2. Durable execution on Vercel

### Vercel Functions limits (Fluid compute)

These are from the [Functions limits](https://vercel.com/docs/functions/limitations) page, last updated 2026-08-24.

| Plan       | Default | Maximum    | Extended maximum                                                         |
| ---------- | ------- | ---------- | ------------------------------------------------------------------------ |
| Hobby      | 300 s   | 300 s      | –                                                                        |
| Pro        | 300 s   | 800 s (GA) | 1800 s (**Beta**, specific runtimes; not with Secure Compute/Static IPs) |
| Enterprise | 300 s   | 800 s      | 1800 s (Beta)                                                            |

Other limits: memory is 2 GB on Hobby and up to 4 GB / 2 vCPU on Pro and Enterprise; the request/response body cap is 4.5 MB.

[Vercel Cron](https://vercel.com/docs/cron-jobs/usage-and-pricing): 100 jobs per project on every plan. Hobby can run at most once per day with ±59 min precision. Pro can run once per minute with per-minute precision.

### 2a. Inngest / `@mastra/inngest`

**Verdict: CONFIRMED for code-defined workflows. Dynamic workflows on Inngest: NOT FOUND.**

**How the integration works**

- `@mastra/inngest` exists; latest is 1.10.6 (2026-10). It requires `inngest` v4+. ([docs](https://mastra.ai/docs/workflows/inngest-workflow))
- You create workflows with `const { createWorkflow, createStep } = init(inngest)`. "Each Mastra workflow becomes an Inngest function … each step … maps to an Inngest step." They are served via `serve({ mastra, inngest })` (a Next.js adapter exists).
- Inngest "Connect" workers are **not** supported on Vercel/Lambda. The normal HTTP `serve` mode is.
- **Dynamic workflows on Inngest:** no documentation or changelog entry mentions dynamic or stored workflows for `@mastra/inngest` ([CHANGELOG](https://github.com/mastra-ai/mastra/blob/main/workflows/inngest/CHANGELOG.md)). `rehydrateWorkflow` can target only the `default` or `evented` engine. Inngest functions are fixed at `serve()` time.
- A workflow's Mastra `schedule` field is ignored on Inngest workflows "with a warning. Use Inngest's `cron` instead" (core 1.72.0 changelog).

**Inngest platform features**

- **Retries:** "four retries after the initial attempt" by default, configurable 0–20. "Each `step.run()` has its own retry counter." ([docs](https://www.inngest.com/docs/features/inngest-functions/error-retries/retries))
- **Concurrency per key:** `concurrency: { limit, key: "event.data.accountId" }`, with scopes `fn` / `env` / `account` and up to two constraints per function ([docs](https://www.inngest.com/docs/guides/concurrency)).
- **Throttling per key:** `throttle: { limit, period, burst, key }`, with a period of 1 s–7 d ([docs](https://www.inngest.com/docs/guides/throttling)).
- Debounce, rate limit and priority are also listed in the Mastra integration docs.
- **Cron:** `cron("TZ=Europe/Paris 0 9 * * *")`. The default timezone is UTC ([docs](https://www.inngest.com/docs/guides/scheduled-functions)).
- **Limits** ([usage limits](https://www.inngest.com/docs/usage-limits/inngest)):
  - Max run duration: 30 d (Free), 90 d (Pro), 366 d (Business).
  - **1,000 steps per function.**
  - 4 MiB step output.
  - Event payload: 256 KiB (Free) / 3 MiB (Pro).
  - Concurrent steps: 5 (Free) / 100 (Pro) / 500 (Business).
  - HTTP step time is "up to 2 hours, subject to the function host's shorter timeout", which on Vercel means the function max duration above.
- **Pricing** ([pricing](https://www.inngest.com/pricing)): Free $0 (50k executions, 5 concurrent steps). Pro from $99/mo (1M executions, 100+ concurrent). Business from $499/mo.

### 2b. Vercel Workflows (Workflow SDK, formerly "Workflow DevKit")

**Verdict: CONFIRMED, GA. Mastra integration: NOT FOUND.**

- **GA:** announced as generally available on **2026-04-16** ([blog](https://vercel.com/blog/a-new-programming-model-for-durable-execution)). The npm package is `workflow`, latest **5.2.2**; 5.0.0 stable shipped 2026-09-30. The model is `'use workflow'` / `'use step'` directives, with `start()` from `workflow/api` ([docs](https://vercel.com/docs/workflows), updated 2026-09-04).
- **Retries:** "By default, steps retry up to 3 times on arbitrary errors". Configurable with `fn.maxRetries`. `FatalError` stops retries, and `RetryableError` takes `retryAfter` ([docs](https://workflow-sdk.dev/docs/foundations/errors-and-retries)).
- **Limits** ([pricing & limits](https://vercel.com/docs/workflows/pricing), updated 2026-09-16):
  - No maximum run or sleep duration.
  - **Individual step runtime is bounded by the function limits above.**
  - 10,000 steps and 25,000 events per run.
  - 50 MB max payload.
  - 240 s max replay.
  - Managed-state retention after completion: 1 d (Hobby), 7 d (Pro), 30 d (Enterprise).
- **Pricing:** $0.02 per 1K events, $0.50/GB written, $0.50/GB-month retained, plus function compute and Queues.
- **Cron:** none built in. "Trigger from Vercel Cron or a system cron calling `start()`" ([Workflow SDK vs Inngest](https://workflow-sdk.dev/docs/comparisons/workflow-sdk-vs-inngest)).
- **Concurrency/throttling per key:** none built in. "No direct function-level analog; enforce limits inside steps or debounce at the publisher" (same page). The GA blog said Workflows 5 "will introduce native concurrency controls, including a lock primitive". The [v5 what's-new page](https://workflow-sdk.dev/docs/whats-new) documents **no** lock or concurrency API.
- **Dynamic workflows:** **Experimental** and off by default (`WORKFLOW_EXPERIMENTAL_DYNAMIC_WORKFLOWS=1`). The source is a **JavaScript string** passed to `start()` (max 128 KiB, about 30 step aliases on Vercel). Only the orchestration is dynamic, and all steps must already be deployed ([docs](https://workflow-sdk.dev/v5/docs/advanced/dynamic-workflows)). This is not a JSON graph.
- **Mastra integration:**
  - No `@mastra/*` package targets Workflow SDK. `@mastra/vercel-workflow` and `@mastra/workflow-devkit` return 404 on npm, and `@mastra/vercel` is a sandbox provider.
  - Vercel's Workflow docs don't mention Mastra.
  - The only artifact found is [`mastra-ai/workflow-builder-template`](https://github.com/mastra-ai/workflow-builder-template), a template pinned to `workflow@4.0.1-beta.17`. It was last pushed 2025-12-08 and is not an integration.

### 2c. Mastra-native

**Verdict: PARTLY TRUE.** Workflows run inside Vercel functions, but the scheduler doesn't.

- **Default engine:** a `run.start()` from an HTTP route "runs … in-process like any other workflow". It needs no separate server, and step time is bounded by the function max duration. Suspend/resume state persists through the storage adapter, for example `@mastra/pg`.
- **Cron:** the built-in scheduler "uses a `setInterval` tick loop … It assumes a long-lived host process." The docs also say: "Functions-as-a-service platforms such as Vercel … schedules declared in code don't fire with the built-in scheduler today … use `@mastra/inngest` instead." (`docs-workflows-scheduled-workflows.md` bundled in `@mastra/core@1.78.0`; [web](https://mastra.ai/docs/workflows/scheduled-workflows))
- **Workers** (orchestration/scheduler split, evented engine) are **Beta**. They need a pull-mode PubSub such as Redis Streams, Valkey or Google Pub/Sub, and they assume long-running processes ([docs](https://mastra.ai/docs/deployment/workers)).
- **Per-key concurrency/throttling:** no native per-key concurrency or throttling primitive was found in the Mastra workflow docs.

## 3. "Jev" by "TypeSafe"

**Verdict: CONFIRMED.** The product exists. "Calibrated" is the vendor's claim.

**What it is**

- **Maker:** TypeSafe AI, a San Francisco AI lab ([typesafe.ai](https://typesafe.ai)).
- **Model:** Jev is a non-generative "System One" decision model. You send `state` (text/JSON) and typed `questions`, and it returns typed answers ([docs](https://docs.typesafe.ai/introduction)):
  - `choice` returns choice + `probabilities` + `confidence`.
  - `score` returns score + `probabilities` + `confidence`.
  - `noul` (boolean) returns P(true) in 0–1.
- **Calibration:** TypeSafe's site says "Every Jev decision comes with a confidence estimate". Its docs describe models "built for calibrated decisions", but the pages fetched publish no calibration methodology. One independent critique (blog, secondary) argues that calibration depends on each customer's data distribution, so a single global calibration can't hold for every tenant ([Molas, 2026-09-23](https://www.alexmolas.com/2026/09/23/jev-cant-be-calibrated.html)).

**Through Vercel AI Gateway: CONFIRMED.** The live gateway catalog (`GET https://ai-gateway.vercel.sh/v1/models`, fetched 2026-10-19) lists:

- `typesafe-ai/jev`, `typesafe-ai/jev-1.13.0` (released 2026-09-15) and `typesafe-ai/jev-1.14.0` (2026-10-15).
- `type: "evaluation"`, 32k context, input $0.000000042/token (**$0.042 per 1M input; output $0**), `no_training: all`.

Changelog posts: [Jev on AI Gateway](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway) (2026-09-16) and [Jev 1.14](https://vercel.com/changelog/typesafe-ais-jev-1-14-is-now-available-on-ai-gateway).

**How to call it.** Jev is **not** a chat model. Three paths exist:

1. **TypeSafe-compatible API:** base URL `https://ai-gateway.vercel.sh/typesafe`, endpoint `POST /typesafe/v1/systemone`, using `@typesafe-ai/sdk` (0.7.0). Responses carry `provider_metadata.gateway.cost`. BYOK is supported. "Decision fallbacks" can rerun low-confidence questions on another model (`when: { question, confidenceBelow }`) ([docs](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe), updated 2026-10-05).
2. The gateway's generic Decision API.
3. The AI SDK's **`experimental_decide`** ("experimental and may change in patch releases") via `@ai-sdk/typesafe-ai` (3.0.22) or the gateway ([AI SDK docs](https://ai-sdk.dev/docs/ai-sdk-core/decisions)). The 2026-09-16 changelog showed the earlier name `experimental_evaluate`.

**Access and pricing:**

- Direct access is through `console.typesafe.ai`, marketed as "early access".
- TypeSafe lists "$42 per billion input tokens". Cloudflare also lists `typesafe/jev` at $0.042/M input ([Cloudflare](https://developers.cloudflare.com/ai/models/typesafe/jev/)).
- No early-access gate is mentioned for the Gateway route.

## 4. "AI Gateway"

**Verdict: CONFIRMED.** This is almost certainly the Vercel AI Gateway: Jev is listed there, and the stack is Vercel.

- **Coverage:** the live `/v1/models` returned **477 models from 49 providers** on 2026-10-19. It covers text, image, video, speech, transcription, realtime, embeddings, reranking and decision/evaluation ([docs](https://vercel.com/docs/ai-gateway), updated 2026-09-14).
- **Per-request model selection:** the model is a `provider/model` string on each call, for example `model: 'openai/gpt-6-astra'`. Provider ordering, model fallbacks and routing rules are supported.
- **Structured output:** supported via `response_format: json_schema` on Chat Completions, `text.format` on Responses, and `output_config.format` on Anthropic Messages ([Chat Completions](https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/structured-outputs)), plus AI SDK structured output.
- **BYOK:** supported for any catalog provider on the paid tier, with no fee. If a BYOK request fails, the gateway retries it on system credentials and **bills that to your credits**. BYOK spend doesn't count toward gateway budgets ([pricing](https://vercel.com/docs/ai-gateway/pricing), updated 2026-09-08).
- **Usage and cost reporting** ([docs](https://vercel.com/docs/ai-gateway/observability-and-spend)):
  - Per-response cost appears in `providerMetadata.gateway.cost`.
  - The Generation Lookup API (by generation ID) returns provider, tokens, cost and finish reason, plus a credit-balance API.
  - Custom Reporting (`/v1/report`) groups by model, user, tag or provider. It is a paid add-on: $0.075 per 1K tag/user writes and $5 per 1K queries.
  - Budgets are per team, project, API key or member. They are soft caps.
- **Pricing:** "no markup and no platform fee on tokens", including with BYOK. A free tier offers a subset of models with lower rate limits. Paid usage is prepaid credits with optional auto top-up.

## 5. Nango Cloud

**Verdict: CONFIRMED, with caveats.**

- **Proxy persistence:** "For proxy requests and API calls made from your functions, Nango records the URL, method, status code, and headers — never request or response bodies." Logs are retained 15 days on Cloud ([security](https://nango.dev/docs/guides/platform/security)).
- **Sync records cache:** AES-256-GCM encrypted. Payloads are pruned after 30 days, and records are hard-deleted after 60 days (same page). Syncs write with `batchSave` / `batchUpdate` / `batchDelete`. `batchDelete` and `trackDeletesStart/End` **soft-delete** records ([Functions SDK](https://nango.dev/docs/reference/functions/functions-sdk)).
- **Syncs vs actions vs proxy:** four kinds of functions are documented ([functions guide](https://nango.dev/docs/guides/functions/functions-guide)):
  - sync functions replicate data on a `frequency`;
  - action functions run on demand (`createAction`);
  - webhook functions process provider webhooks;
  - event functions (`on-events/`) react to connection lifecycle.
    The proxy (`/proxy/{path}`) makes authenticated passthrough calls without custom code.
- **Connection-deletion webhook:** `type: "auth"`, `operation: "deletion"`. Other auth operations are `creation`, `override` and `refresh`. Requests are signed with `X-Nango-Hmac-Sha256`. **Caveat:** it is "only sent when a connection is deleted directly through the dashboard or the API. It is not sent for bulk deletions caused by deleting an integration or environment." ([webhooks](https://nango.dev/docs/guides/platform/webhooks-from-nango))
- **Rate limits:**
  - Proxy: the `Retries` header (default 0) gives exponential backoff. `Retry-On` adds status codes to the default 5xx and 429 ([proxy ref](https://nango.dev/docs/reference/api/proxy/get)).
  - Inside functions: 401, 429 and 5xx retry by default. Backoff starts at 3 s, doubles, and caps at 10 min ([Functions SDK](https://nango.dev/docs/reference/functions/functions-sdk)).
  - "Respecting provider rate-limit headers" appears only on the marketing page ([request proxy](https://nango.dev/platform/request-proxy)).
- **Custom functions and CLI:**
  - The folder is **`nango-integrations/`**, with an `index.ts` entry point and per-integration `syncs/`, `actions/` and `on-events/` folders. The `.nango/` directory must be committed.
  - Commands: `nango init`, `nango dev`, `nango dryrun`, `nango deploy`, `nango pull`, `nango compile`.
  - The CLI is the npm package `nango`, version 0.71.13.
- **Gmail triggers:** Nango defines **no `new_message` event**. Gmail push works through your own Pub/Sub topic plus `users.watch` per connection. Nango then forwards a `type: "forward"` payload containing `{emailAddress, historyId}` ([Nango Gmail webhooks](https://nango.dev/docs/api-integrations/google-mail/webhooks)). Google requires calling `watch` "at least once every 7 days" and caps notifications at one per second per user ([Gmail push](https://developers.google.com/workspace/gmail/api/guides/push)).
- **Pricing** ([pricing](https://www.nango.dev/pricing)):
  - Free: $0, with 10 connections, 10 compute-hours/mo and 10 GB transfer.
  - Pay-as-you-go: $50/mo, including $50 of credits. After that: $0.29/connection/mo (prorated), $0.72 per compute-hour, $0.50/GB.

## 6. Org auto-join by Google Workspace domain

**Verdict: PARTLY TRUE.**

**Better Auth** (`better-auth` 1.7.11)

- The organization plugin has **no built-in domain auto-join**. It offers server-only `addMember` and `databaseHooks` / `beforeAddMember` hooks, so auto-join can be written by hand ([org plugin source](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/organization.mdx)).
- The **SSO plugin** does domain-based provisioning. "Domain-derived assignment from another sign-in method requires domain verification, a verified stored user email, and one unambiguous organization match." Verification uses a DNS TXT record at `_better-auth-token-{provider-id}` ([SSO docs](https://better-auth.com/docs/plugins/sso)). This means a Google social sign-in can be auto-assigned only if an SSO provider with a DNS-verified domain is linked to the org.
- **Google `hd`:** the Google provider takes `hd: "company.com"` (or `"*"`), and Better Auth **enforces the returned ID-token claim**. Tokens without `hd` are rejected ([Google provider docs](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/authentication/google.mdx)).
- **Drizzle:** `drizzleAdapter` from `@better-auth/drizzle-adapter` (1.7.11), `provider: "pg"`. Schema generation is `npx auth@latest generate` ([docs](https://better-auth.com/docs/adapters/drizzle)).

**Clerk**

- **Verified Domains** offers two modes. "Automatic invitation" means the user "will receive an invitation" and must accept it. "Automatic suggestion" sends a membership request that needs admin approval. Neither adds the user silently ([docs](https://clerk.com/docs/guides/organizations/add-members/verified-domains)).
- Verified Domains and Automatic Invitations require the **Enhanced B2B Authentication add-on, $100/mo** ($85 billed annually) on top of Pro at $25/mo ([pricing](https://clerk.com/pricing)).

**Google `hd` claim:** "Provided only if the user belongs to a Google Cloud organization", and absent for consumer accounts. The `hd` request parameter is only a UI hint: "Be sure to validate that the returned ID token has an hd claim value that matches what you expect" ([Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect)).

## 7. Clustering in TypeScript

**Verdict: PARTLY TRUE.**

npm data as of 2026-10-19:

| Package                                                       | Version / last publish | Weekly downloads | Notes                                                                                                                                                                                   |
| ------------------------------------------------------------- | ---------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`hdbscan-ts`](https://github.com/GeLi2001/hdbscan-ts)        | 1.0.17 / 2026-02-14    | 28,310           | Pure TS, MIT, 12 stars, single maintainer. `metric?: "euclidean"` only. Builds a dense n×n mutual-reachability matrix (`dist/hdbscan/core.js`). Returns `labels_` and `probabilities_`. |
| [`@bpinternal/gravity`](https://github.com/botpress/packages) | 0.1.1 / 2026-09        | 533              | Botpress. UMAP + HDBSCAN compiled from Rust to WASM. Version 0.x.                                                                                                                       |
| `clusternova`                                                 | 1.5.5 / 2026-02-02     | 305              | TS HDBSCAN.                                                                                                                                                                             |
| `hdbscanjs`                                                   | 1.0.12 / 2017          | 760              | Unmaintained.                                                                                                                                                                           |
| `ml-kmeans` (mljs)                                            | 7.0.1 / 2026-06        | 78,068           | k-means alternative.                                                                                                                                                                    |
| `umap-js` (PAIR)                                              | 1.4.0 / 2024-06        | 88,734           | Dimensionality reduction before clustering.                                                                                                                                             |

**Postgres/pgvector:** pgvector provides only distance operators and indexes. It uses k-means internally to build IVFFlat lists but exposes no clustering function ([README](https://github.com/pgvector/pgvector)). Neon's extension list has no ML or clustering extension; pgml, madlib, pgvectorscale and vchord are all absent ([Neon extensions](https://neon.com/docs/extensions/pg-extensions)). Clustering therefore runs in application code.

## 8. Neon + pgvector + Drizzle

**Verdict: CONFIRMED.**

- **Drizzle** (`drizzle-orm` 0.45.4; 1.0 is in beta):
  - `vector('embedding', { dimensions: 1536 })`, plus `halfvec`, `sparsevec` and `bit` column types.
  - Distance helpers: `l2Distance`, `l1Distance`, `innerProduct`, `cosineDistance`, `hammingDistance`, `jaccardDistance` (`sql/functions/vector.d.ts`).
  - HNSW index: `index('i').using('hnsw', t.embedding.op('vector_cosine_ops'))`.
  - `CREATE EXTENSION vector;` must go in a migration by hand ([guide](https://orm.drizzle.team/docs/guides/vector-similarity-search)).
- **pgvector:**
  - Operators: `<->` L2, `<#>` negative inner product, `<=>` cosine, `<+>` L1.
  - HNSW and IVFFlat indexes, up to 2,000 dimensions for `vector` and 4,000 for `halfvec`.
  - Upstream latest is 0.8.7 (2026-10-01) ([README](https://github.com/pgvector/pgvector)).
- **Neon:** pgvector 0.8.0 on PG14–17 and **0.8.6 on PG18**, installed with `CREATE EXTENSION vector` ([extensions](https://neon.com/docs/extensions/pg-extensions), [pgvector on Neon](https://neon.com/docs/extensions/pgvector)). Neon joined Databricks in 2025. Its docs now say "Lakebase Postgres", but Neon remains a separate product at neon.com, not a rename ([Neon and Lakebase](https://neon.com/docs/introduction/neon-and-lakebase)).
- **CI branching:** `neondatabase/create-branch-action`, latest release **6.3.1** (2026-03-31) ([action.yml](https://github.com/neondatabase/create-branch-action/blob/main/action.yml)):
  - Inputs: `api_key`, `project_id`, `branch_name`, `parent_branch`, `branch_type` (`default` / `schema-only`), `expires_at`.
  - Outputs: `db_url`, `db_url_pooled`, `branch_id`, `created`.
  - Companion actions: `delete-branch-action` (v3.2.1), `reset-branch-action` and `schema-diff-action` (v1.0.1) ([guide](https://neon.com/docs/guides/branching-github-actions)).

## Discrepancies in `architecture.md`

1. **Stack, "Mastra … (`addDynamicWorkflow` / `rehydrateWorkflow`)".** Both APIs exist, but they are **Beta** and both arrived in August 2026 (1.56.0 and 1.58.0). `addDynamicWorkflow` is the API you'd normally call. `rehydrateWorkflow` is the internal-level deserializer. Specs must compile to **JSON Schema** plus the declarative predicate DSL, not closures.
2. **Dynamic workflows and the job-runner open question.** A runtime-registered Mastra workflow runs only on the `default` or `evented` engine. No path to Inngest or Vercel Workflows was found, so choosing Inngest does not by itself make Mycel's compiled specs durable.
3. **"Discovery runs nightly" on Vercel with Mastra-native.** Mastra's scheduler does not fire on serverless (Mastra docs). Nightly runs need Vercel Cron, Inngest cron, or a long-lived worker.
4. **"Jev (TypeSafe)".** The correct names are **TypeSafe AI** and model ID **`typesafe-ai/jev`**. It is called through the gateway's TypeSafe/Decision API or the AI SDK's **experimental** `experimental_decide`, not the chat/structured-output path used for other roles.
   - Boolean (`noul`) answers return P(true). Choice answers return `probabilities` + `confidence`. The spec's `classify.yes.p` needs mapping onto those fields.
   - "Calibrated" is a vendor claim with no published methodology, and is disputed per data distribution.
   - The open question "Jev access and pricing" is answerable: $0.042/M input tokens, output free, and available on AI Gateway now.
5. **Spec trigger `{ "type": "nango.event", "event": "new_message" }`.** Nango has no such event. Mycel must run Gmail `users.watch` (renewed every 7 days) through Pub/Sub. It then receives forwarded `historyId` notifications and diffs history itself.
6. **Invariant 3 (deletion on Nango report).** The `auth`/`deletion` webhook is **not sent** for bulk deletions, such as deleting an integration or environment, so the webhook alone can't guarantee deletion.
7. **Data handling, "make sure the Nango-side records get cleaned up".** Nango's sync cache keeps payloads 30 days and records 60 days, and `batchDelete` only soft-deletes. Mycel can't purge sync records immediately through the documented SDK.
8. **Open question, "Vercel Workflows".** The product is GA, but it has no built-in cron and no per-key (per-org or per-connection) concurrency or throttling. The promised "lock primitive" is not in the v5 docs.
9. **Open question, auth auto-join.** Clerk's "automatic invitation" still needs the user to accept, and it costs an extra $100/mo. Better Auth's auto-assignment needs the SSO plugin with DNS-verified domains, or custom hook code. Either way, the Google `hd` claim must be validated server-side.
10. **"cluster (HDBSCAN)".** It is doable in TS, but the only well-used package is a small single-maintainer library with Euclidean distance only and O(n²) memory. pgvector and Neon offer no clustering.
