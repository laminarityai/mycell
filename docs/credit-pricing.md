# Credit pricing

What a credit is worth, and how much each model role must find in the balance before a call. Chosen in #167 (2026-10-23) for dogfooding; revisit at M10, when the margin is set.

## The rule

**1 credit is 1 US cent of what the Vercel AI Gateway charges us**, with no margin: `CREDITS_PER_USD=100`. A call's usage entry is its gateway cost (`providerMetadata.gateway.cost`) times 100, so a call the gateway bills $0.0042 records 0.42 credits. The ledger's `amount` is a decimal, so a fraction of a credit is recorded as it is, never rounded. The injection screen (Model Armor) is converted at the same ratio.

Each role's **estimate** (`CREDIT_ESTIMATE_<ROLE>`) is the balance a call on that role must find before it's made (`checkCredits`). Nothing is reserved: the call then records what it really cost, more or less than the estimate. So the estimate only needs to be a sensible upper-typical cost for the role's model at the role's usual size. Too low, and a nearly empty balance lets one call take it further below zero; too high, and an org with credits left is refused early. Try it checks the dearest of its steps' estimates before it runs, and memory's per-item estimate is the sum of two screens and the `classify`, `fast` and `embed` estimates (`creditsPerItem`).

Each estimate is rounded up to a whole credit, with **1 credit as the least**. A Jev or embedding call costs a few hundredths of a credit, but a whole credit still covers even the largest such call, and a balance under one credit (one cent) is empty in practice.

## The numbers

Prices are the gateway's list prices from its model list, `https://ai-gateway.vercel.sh/v1/models`, fetched 2026-10-23 (the per-model pages at `https://vercel.com/ai-gateway/models/<model>` show the same; Claude Sonnet 4.5's was checked). The gateway adds no markup to providers' prices. A token is about four characters of English, as the injection screen also assumes.

| Role       | Default model                   | Gateway price (per million tokens)             | Upper-typical call                          | Its cost | Estimate        |
| ---------- | ------------------------------- | ---------------------------------------------- | ------------------------------------------- | -------- | --------------- |
| `classify` | `typesafe-ai/jev-1.14.0`        | $0.042 input, output free                      | 6,500 tokens in                             | 0.03 ¢   | **1** (was 1)   |
| `fast`     | `openai/gpt-5-mini`             | $0.25 input, $2 output                         | 7,500 in, 5,000 out (reasoning counted)     | 1.2 ¢    | **2** (was 5)   |
| `smart`    | `anthropic/claude-sonnet-4.5`   | $3 input, $15 output (up to 200,000 tokens in) | a 4-step builder turn: 66,000 in, 3,200 out | 24.6 ¢   | **25** (was 50) |
| `judge`    | `anthropic/claude-sonnet-4.5`   | $3 input, $15 output                           | 10,000 in, 1,000 out                        | 4.5 ¢    | **5** (was 50)  |
| `embed`    | `openai/text-embedding-3-small` | $0.02 input                                    | 2,100 tokens in                             | 0.004 ¢  | **1** (was 1)   |

The old values were placeholders at `CREDITS_PER_USD=1000` (ADR-0010).

### How each call size was worked out

- **`classify`.** Jev reads the state (the message or document) and the question, and its answers are free. The most memory hands it is a Google Doc cut at 24,000 characters (`MAX_DOC_CHARS`), about 6,000 tokens, plus the question: 6,500 tokens is $0.00027. A workflow's classify step reads the triggering email, usually less. Even a call filling Jev's whole 32,000-token context costs 0.13 credits, so 1 credit covers any call.
- **`fast`.** Its largest regular call is memory's extraction: a Google Doc at 24,000 characters (an email is cut at 13,000, `MAX_TEXT_CHARS`), the extraction instructions and the output schema, about 7,500 tokens in ($0.0019). GPT-5 mini is a reasoning model and bills its reasoning as output: the objects and facts plus reasoning at its default effort come to about 5,000 tokens ($0.010). That's 1.2 credits, rounded up to 2 to leave room for longer reasoning. Its other calls are smaller: the classify fallback, match confirmations (names, keys and up to 10 short facts), summaries over an object's facts, and extract steps on one email.
- **`smart`.** Its largest call is the builder chat's turn: one streamed call of up to 8 model steps (`MAX_STEPS`), each sending the whole prompt again (no prompt caching). The instructions and tool definitions measured 15,200 and 8,000 characters for an org with nothing connected (the first request of `streamTurn` against the fake gateway, 2026-10-23), about 6,000 tokens. With a real org's connections, suggestions, custom actions and an earlier exchange or two, the first step is about 12,000 tokens, and each tool result and reply adds about 3,000 to the next. A typical turn of 3 to 4 steps sends 45,000 to 66,000 tokens and writes about 800 tokens a step: 17 to 25 credits. 25 covers the 4-step turn. A turn that uses all 8 steps of a long conversation can reach about 65 credits; it's recorded at what it cost, and the next turn's check sees the lower balance. A draft step on `smart` (instructions, a thread, about 10,000 tokens in and 800 out) costs about 4 credits.
- **`judge`.** Same model as `smart`. Nothing calls it on its own yet: a spec's draft or extract step may name it, and the shadow eval (`docs/architecture.md`, "Discovery pipeline") will compare a candidate's output with what a person did. Either is about a draft step's size: 10,000 tokens in ($0.030) and 1,000 out ($0.015), 4.5 credits, so 5.
- **`embed`.** Memory embeds each item's kept fact statements in one call, each at most 280 characters (about 70 tokens). Thirty statements are 2,100 tokens, $0.00004. A full request of 2,048 texts would be about 143,000 tokens, still only 0.29 credits, so 1 credit covers any call.

### What memory's estimate comes to

`creditsPerItem` is two injection screens of 24,000 characters (6,000 tokens each at Model Armor's $0.10 per million: 0.12 credits together), plus 1 (`classify`), 2 (`fast`) and 1 (`embed`): **4.12 credits an item**, an upper bound. What an item really costs is nearer 1.3 credits (the screens, about 1.2 for extraction, and a few hundredths for the rest), since `classify` and `embed` cost far below their 1-credit minimums. It leaves out match confirmations (a `fast` call per candidate, at most three, each a fraction of a credit).

## Setting them

`app/.env.example` carries these values. The defaults in `app/src/env.ts` stay the old placeholders, because the tests are written against them (one expects a `fast` call to need 5 credits, and memory's budget tests count costs at 1,000 credits a dollar), so **production must set all six** (`docs/runbooks/deploy.md`, section 9). At 100 credits a dollar, a grant of 5,000 credits is $50 of gateway cost.

## Checking them

After a couple of weeks of dogfooding, compare the estimates with what calls really cost, in credits:

```sql
select role, count(*) as calls,
  round((percentile_cont(0.5) within group (order by cost_usd) * 100)::numeric, 3) as median,
  round((percentile_cont(0.9) within group (order by cost_usd) * 100)::numeric, 3) as p90,
  round((max(cost_usd) * 100)::numeric, 3) as most
from credit_ledger
where kind = 'usage' and outcome = 'succeeded' and role is not null
  and created_at > now() - interval '14 days'
group by role;
```

An estimate near the 90th percentile is about right. Change the env values in Vercel if it isn't, and update this page. If an org's own model for a role (`model_roles`) is much dearer than the default, the estimate still uses the default's price.

## Revisit at M10

Before the first outside customer: the margin over gateway cost (and so `CREDITS_PER_USD`), the free or included allowance, and these estimates again with real usage and whatever models the roles use then.
