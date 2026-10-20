# Discovery: multi-app workflows and the entity idea

Status: **decided, with an experiment pending.** ADR-0007 makes the builder chat primary. ADR-0008 records what we build now (deterministic `object_refs`) and the rule the discovery-lens experiment below must pass before we build an entity backbone after v1. This doc holds the reasoning, the evidence, and the experiment's design.

## 1. Context

- Discovery doesn't work by giving everything to an LLM. LLMs can't count frequency reliably, they're too expensive at mailbox scale, they give different answers on each run, and they leave no evidence trail. Discovery is a **funnel**:
  1. remove noise
  2. cheap per-event tagging (Jev)
  3. embed and cluster
  4. pattern detectors
  5. arithmetic ranking
  6. LLM interpretation, only on a few representative examples per candidate
  7. shadow eval
- **Email alone is too narrow.** Many repetitive tasks span Google Workspace apps.
- **The question:** should discovery be **message-centric** (cluster similar messages) or **entity-centric** (follow a customer, order, or project across apps)?

## 2. Workspace sources

| Source                | Signal                                                        | Example pattern                                                          |
| --------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Gmail                 | Requests, replies, templates, chasing                         | Pricing questions answered with the same kind of reply                   |
| Calendar              | Recurring meetings, scheduling, post-meeting behavior         | "Does Tuesday work?" threads; recap email sent soon after a meeting ends |
| Drive / Docs          | Docs created from templates, naming patterns, edit activity   | "Copy of Proposal Template – {client}" created repeatedly                |
| Sheets                | Appended rows, periodic edits, sheet used as a tracker or CRM | Email arrives → a row for the same customer appears                      |
| Forms                 | Submissions and what follows them                             | Submission → follow-up email to the submitter (intake)                   |
| Chat                  | Internal requests and approvals                               | "Can someone approve this invoice?"                                      |
| Meet transcripts      | Action items and commitments                                  | Meeting → manual follow-up tasks (later; sensitive, plan-dependent)      |
| Apps Script / filters | Automations the company already attempted                     | Existing filters and scripts show what they already wanted automated     |

**Decided:** v1 production sources stay **Gmail and Sheets/Drive** (intent non-goal 2). The experiment also reads Calendar metadata. Calendar and Forms join the sources only if the blind lists show meeting→follow-up or form→email tasks. Calendar _actions_ for the builder chat (e.g. scheduling) are a separate catalog decision.

**After v1:** Docs content, Chat, Meet transcripts.

**Constraints:**

- Full Drive and Gmail read access are restricted scopes, which need Google verification and a security assessment before the first external customer. Prefer metadata or activity scopes when content isn't needed.
- Check Nango's catalog coverage for Forms, Chat, and Meet before adding them. Fall back to the Nango proxy or custom functions where it's missing.

**Decided: no admin-level data access in v1.** The Admin SDK Reports API (domain-wide activity metadata from one admin connection) and domain-wide delegation (one admin grants access to everyone's Gmail) both observe members' activity at org level, which conflicts with owner scopes and ADR-0001. Revisit at M10 if an external customer needs it.

## 3. The entity (object-centric) idea

**Concept:** extract entities from events, resolve them into canonical business objects, and study each object's lifecycle across apps.

> quote request email → "Copy of Proposal Template – Acme" doc created → PDF emailed → tracker row set to "sent" → "just following up" email 5 days later → calendar meeting → row set to "won"

If many customers follow the same sequence, that's a process with handoffs and wait times. Candidate automations: proposal generation, follow-up nudges, tracker updates. Message clustering alone would only find "many quote emails."

**Prior art:** object-centric process mining (OCPM) and the **OCEL 2.0** event log standard. OCEL 2.0 records events, objects, event-to-object links, object-to-object links, and object attribute values over time.

**Limits of an entity-only approach:**

- **It finds mentions, not actions.** Every event still needs an **activity label** (e.g. "quote requested"), so classification and clustering are still needed.
- **Resolution is the hard part, extraction is the easy one.** "Acme", "Acme Corp", and dana@acme.com need to become one object.
- **Single-step work has no lifecycle** (e.g. answering pricing questions from one-off prospects). Message clustering is what catches it.
- **Entity explosion.** Restrict to business object types (customer, order, invoice, project, product) and to objects that appear in at least 2 events.

## 4. Extraction tooling

- **Structured fields first:** attendees, file names, sheet cells, and form fields need no NER.
- **Regex** for IDs and amounts.
- **Jev is a classifier and scorer, not an extractor.** Its text primitives are `choice`, `score`, and `noul`, and it has no NER primitive ([docs](https://docs.typesafe.ai/introduction), [llms.txt](https://docs.typesafe.ai/llms.txt)). TypeSafe documents two patterns that fit us: a cheap pass proposes candidate spans and Jev picks among them ([value extraction](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook.md)), and Jev scores candidate pairs for entity alignment ([entity alignment](https://docs.typesafe.ai/cookbooks/entity_alignment.md)). Batching several questions per request is documented as much cheaper ([parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions.md)). Documented weaknesses: counting, maths, dates as ordered quantities, and bias toward the first-listed choice ([jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md)). It is a hosted API only (no open weights), with Python and JS clients. TypeSafe publishes no eval numbers of its own, and we found no Jev-vs-GLiNER NER comparison.
- **GLiNER** proposes typed spans zero-shot, with entity types named at runtime ([paper](https://arxiv.org/abs/2311.08526)). The Python library is mature. The TypeScript port (`gliner` on npm, 0.0.19) was last pushed in March 2025, and the int8 model (183 MB) plus onnxruntime-node (about 300 MB) exceeds Vercel's 250 MB function limit. So it is an experiment tool, not a production one.

**Decided production path, if the experiment passes (ADR-0008):** structured fields and regex → a `fast`-role LLM proposes free-text spans → Jev types each candidate and scores candidate pairs for resolution, all in TypeScript through the AI SDK. No GLiNER in production unless the experiment shows the LLM proposer clearly losing to it, and even then a Python service needs a new ADR that supersedes ADR-0004.

## 5. Candidate pipeline (if the entity view proves its value)

Use an **object-centric event log as the backbone**, with two ways of reading it:

1. **Normalize** events from all sources (existing event schema).
2. **Extract entities:** structured fields → regex → LLM span proposals, typed by Jev.
3. **Resolve** into canonical objects: deterministic keys first, then Jev-scored candidate pairs.
4. **Label activities:** build the activity list from a sample (cluster, then have an LLM name each cluster, as in TnT-LLM), then tag every event at scale with Jev.
5. **Event log entries** are `(event, activity, objects[])`, OCEL-like.
6. **Two lenses:**
   - **By object type:** frequent activity sequences, cross-app handoffs, wait times. These are multi-step workflows.
   - **By activity:** frequency, templates, reply consistency. These are single-step automations such as drafting.
7. **Rank, then shadow eval**, unchanged.

## 6. What the evidence does and doesn't support

**Supported:**

- **Cross-app work is common and costly.** An HBR study of 137 people at three Fortune 500 companies found about 1,200 app switches per day and roughly 4 hours per week spent reorienting (about 9% of work time). Caveats: these are large enterprises, switching isn't the same as automatable handoffs, and other measurements are lower (about 300 per day).
- **Copying data between apps is a recognized automatable class** in robotic process mining (Leno, Dumas et al.). Caveat: they detect it from UI interaction logs, which capture the actual copy. We only see API data.
- **OCPM works on real data** (e.g. an after-sales case study with about 65,000 events). Caveat: its own authors call the benefits underexplored, and the studies used clean system logs with real object IDs, not mentions extracted from text.
- **Mining processes from email** has proof-of-concept work (e.g. evaluated on Enron). Modest evidence.

**Not supported (our bet):**

- No study we found shows that linking Workspace data through APIs finds more or better automation opportunities than analyzing a single source, for any company size.
- Our handoff heuristic ("an email mentions X, then a sheet row with X appears") never observes the actual copy. Expect coincidental matches, and fuzzy resolution adds more errors.

## 7. The discovery-lens experiment

An **experiment** is a throwaway investigation that settles one open decision against a rule written before it runs (see `GLOSSARY.md`). This one runs alongside M1 and doesn't block it. It has no timebox. Its code lives in `experiments/discovery-lenses/`, and a new ADR records its result.

**Build now regardless (cheap, no lock-in):** `object_refs` on the normalized event, filled by deterministic links only (exact email addresses, IDs, file references).

**Steps:**

1. Before anyone sees output, everyone on the team, plus anyone outside it who is willing, writes a **blind list** of their repetitive tasks and tags each one `single-app` or `cross-app`, and `worth automating` or not.
2. Gather whatever real Gmail, Drive, and Calendar metadata the participants have, up to 90 days.
3. Build a **minimal synthetic company generator** whose planted workflows are copied from the blind lists, not invented, so the plants don't decide the answer.
4. Run **both lenses** on the real data and the synthetic data.
5. Measure how many listed tasks each lens recovers. Report entity-lens recovery for **deterministic links only** and for the **full** lens separately, and compare GLiNER with a `fast`-role LLM as the span proposer (each followed by Jev typing).

**Where each condition's evidence comes from:**

- _Cross-app share_ is a fact about real work, so it comes only from the real blind lists. A generator can't answer it, because we choose what to plant.
- _Entity-lens recovery_ comes from the real data plus the synthetic data. With little real data, treat the result as directional and say so in the ADR.

**Decision rule (agreed before running; also in ADR-0008):**

- Build the entity backbone after v1 **only if** at least 25% of blind-list tasks are tagged cross-app **and** the full entity lens recovers at least max(3, 15% of the list) "worth automating" tasks that the message lens misses.
- Otherwise keep the deterministic links and invest in the message lens.
- Whichever lens recovers more real tasks gets more weight in ranking.

**Terms (the experiment is exempt from the app's invariants on these terms only):**

- It may be Python (ADR-0004 covers the product, and nothing here ships).
- Raw content stays on the machine that runs it and is deleted when it ends.
- Only participants who explicitly opt in are included.
- It skips the credits ledger.
- It pins the same exact Jev model ID as the app (e.g. `typesafe-ai/jev-1.14.0`, not `jev-latest`) and records the version in the results.

**Tooling:** Python, with GLiNER, the Jev client (`typesafe-sdk`), scikit-learn/hdbscan for the message lens, and pm4py for the OCEL 2.0 log and sequence mining. pm4py is AGPL-3.0, which is fine for an experiment and another reason the code can't ship. TypeScript has no comparable process-mining library.

## 8. Evals relevant to this work

- **Synthetic company generator.** A minimal version is part of the experiment. The eval-grade version is an M2 entry task: about 90 days for a ~15-person company with roughly 10 **planted workflows** at known frequencies, including cross-app ones (email → sheet, form → email, meeting → recap). It also plants **decoys**: one-offs, near-duplicates, and newsletters. Output is event logs plus the content of a few key files, with realistic mess. Measure recall and precision of the planted workflows.
- **Enron subset:** a realism check only; don't tune to it.
- **Dogfood blind lists:** recall against the lists, plus precision as the share of suggestions rated "real and worth automating".
- **Stage evals for the entity path:**
  - extraction precision and recall per type
  - resolution accuracy (pairwise precision and recall on labeled merges)
  - activity-label accuracy and Jev calibration
  - handoff-link precision (how often a detected email→sheet link is real)
- **Ablations:** turn off each detector or lens to measure what it contributes.

## 9. How Trace appears to do it (public info only)

- **Stated:** it connects tools (Slack, Jira, Notion, email, etc.) and builds a "context engine" or unified index from wikis, activity logs, and people data. Demo screens show entity and relation counts. The main flow is **top-down**: describe a process or goal, Trace breaks it into steps and routes each step to AI or a human. Routing uses rule gates (e.g. a $50K approval threshold) and confidence gates (e.g. below 75% goes to human review). Evaluation checks sit **at each handoff** between steps to catch drift.
- **Inferred, not confirmed:** bottom-up repetition detection seems to come mostly **after deployment**, from work flowing through Trace's own platform, where its logs are clean. The graph mainly serves as **context for agents**, not as the main discovery engine.

**What we took from it:**

1. Top-down is proven ground, so the builder chat is primary (ADR-0007). Bottom-up discovery is our differentiator and our biggest unknown, and the experiment tests it.
2. **Mine our own run logs.** Workflow runs, approvals, edits, and overrides form a clean event log we own. Continuous discovery (M9) reads it as a source.
3. **Handoff checks in specs.** An optional per-step `checks` field (schema, confidence floor, required fields), surfaced in observability, goes into the M3 spec schema.

## References

- OCEL 2.0 specification: https://arxiv.org/abs/2403.01975
- GLiNER (Zaratiana et al., NAACL 2024): https://arxiv.org/abs/2311.08526 · https://github.com/urchade/GLiNER
- TnT-LLM (Wan et al.): https://arxiv.org/abs/2403.12173
- Leno et al., data transformations for RPA: https://arxiv.org/abs/2001.01007
- Leno et al., executable routine specifications from UI logs: https://arxiv.org/abs/2106.13446
- Park et al., OCPM after-sales case study: https://arxiv.org/abs/2310.10174
- OCPM in insurance (AI-enhanced automation): https://arxiv.org/abs/2504.17295
- Mining process models from email logs: https://arxiv.org/abs/1609.06127
- HBR toggling study (coverage; link reconstructed from a garbled copy, unverified): https://www.canadianunderwriter.ca/brokers/how-much-time-you-waste-toggling-between-applications
- Jev docs: https://docs.typesafe.ai/introduction · models and pricing: https://docs.typesafe.ai/models.md
- GLiNER.js: https://npmjs.com/package/gliner · Vercel function limits: https://vercel.com/docs/functions/limitations
- pm4py: https://github.com/process-intelligence-solutions/pm4py
- Trace: https://www.trace.so/ · handoff-layer evals post: https://www.trace.so/blog/why-we-build-evaluation-into-handoff-layer · founder profile: https://yespress.io/tim-cherkasov
