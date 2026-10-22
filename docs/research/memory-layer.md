# Memory layer: how others build one, and what businesses and platforms require

Checked 2026-10-21 against primary sources: each product's docs, papers and source, and Google's, Microsoft's and Slack's policy pages. Each claim links to its source. Benchmark figures are the vendors' own. Claims marked † are quoted from official text that wouldn't load on the day (EUR-Lex, the gated AICPA criteria, CCPA PDFs). The decisions this informed are ADR-0022 to ADR-0025.

## 1. How memory layers are built

| System                               | Data model                                                                                                                                                                                           | Matching                                                                            | Storage                                                                                                                                      | Permissions                                                                                                                                                                                                  | Deletion                                                                                                                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Zep / Graphiti**                   | Raw episodes → entities and relations → communities. Bi-temporal facts: when true, when recorded; contradicted facts get an invalid time, not deleted ([paper](https://arxiv.org/html/2501.13956v1)) | Embedding + keyword candidates, LLM confirms; facts compared within one entity pair | Neo4j, FalkorDB or Neptune; Python; keeps raw episodes ([repo](https://github.com/getzep/graphiti))                                          | `group_id` namespaces only                                                                                                                                                                                   | Deleting an episode deletes facts nothing else supports, but "does not regenerate the names or summaries of nodes shared with other episodes" ([docs](https://help.getzep.com/deleting-data-from-the-graph)) |
| **Mem0**                             | Short facts scoped by user, agent, app, run. Since April 2026, add-only: "nothing is overwritten or deleted" ([migration](https://docs.mem0.ai/migration/))                                          | LLM extraction; entity linking by co-occurring names                                | 24+ vector stores incl. pgvector; graph memory now hosted-only ([docs](https://docs.mem0.ai/platform/features/graph-memory)); no source text | IDs only                                                                                                                                                                                                     | By ID or filter ([docs](https://docs.mem0.ai/core-concepts/memory-operations/delete)); by source only if you store a source ID yourself                                                                      |
| **Letta**                            | Agent edits its own memory: in-context blocks, archival passages, history; new agents use a git repo of markdown ([docs](https://docs.letta.com/letta-code/memfs))                                   | None                                                                                | Postgres + pgvector                                                                                                                          | Not verified                                                                                                                                                                                                 | —                                                                                                                                                                                                            |
| **Cognee**                           | Documents → chunks → entities → relations, with an optional provenance ledger ([docs](https://docs.cognee.ai/core-concepts/main-operations/legacy-operations/cognify))                               | Merges on normalized name, so two "John Smith"s merge                               | Relational + vector + graph; Postgres can hold all of it                                                                                     | Per-dataset access lists ([docs](https://docs.cognee.ai/core-concepts/permissions-system/overview))                                                                                                          | `forget()` per item or dataset; shared entities go with the last reference                                                                                                                                   |
| **Microsoft GraphRAG**               | Chunks → entities, relations, claims → communities and reports ([docs](https://microsoft.github.io/graphrag/index/default_dataflow/))                                                                | Exact name and type                                                                 | Parquet                                                                                                                                      | None                                                                                                                                                                                                         | — ; "indexing can be an expensive operation", maintenance mode ([repo](https://github.com/microsoft/graphrag))                                                                                               |
| **LightRAG**                         | LLM extraction, descriptions merged across documents ([repo](https://github.com/HKUDS/LightRAG))                                                                                                     | By name                                                                             | Postgres + pgvector + Apache AGE                                                                                                             | Workspaces                                                                                                                                                                                                   | Deleting a document rebuilds the affected graph                                                                                                                                                              |
| **Supermemory**                      | Documents → chunks → memories; "updates" (supersedes, `isLatest`), "extends", "derives" (inferred) ([docs](https://supermemory.ai/docs/concepts/graph-memory))                                       | Not documented                                                                      | TypeScript, Postgres, Drizzle ([repo](https://github.com/supermemoryai/supermemory))                                                         | Namespaces; source permissions undocumented                                                                                                                                                                  | Per connector, keep or delete documents                                                                                                                                                                      |
| **Glean**                            | Enterprise graph of people, projects, customers, single-tenant ([product](https://www.glean.com/product/knowledge-graph))                                                                            | ML-inferred                                                                         | Closed                                                                                                                                       | Checked when someone searches: `allowed_users`, `allowed_groups`; groups synced separately: "Don't flatten groups into user lists" ([docs](https://developers.glean.com/libraries/indexing-sdk/permissions)) | Follows source sync                                                                                                                                                                                          |
| **Microsoft Copilot semantic index** | Tenant index of SharePoint plus per-user indexes ([docs](https://learn.microsoft.com/en-us/microsoftsearch/semantic-index-for-copilot))                                                              | —                                                                                   | Closed                                                                                                                                       | Results filtered by the user's existing access                                                                                                                                                               | Follows retention policies                                                                                                                                                                                   |
| **Gemini Enterprise**                | Connectors copy into an index or query live ("federation") ([docs](https://docs.cloud.google.com/gemini/enterprise/docs/connectors/introduction-to-connectors-and-data-stores))                      | Not documented                                                                      | Closed                                                                                                                                       | Users and groups synced and mapped to source access lists                                                                                                                                                    | —                                                                                                                                                                                                            |
| **MCP memory server**                | Entities, relations, plain-text observations in one JSONL file ([repo](https://github.com/modelcontextprotocol/servers/tree/main/src/memory))                                                        | Substring                                                                           | File                                                                                                                                         | None                                                                                                                                                                                                         | —                                                                                                                                                                                                            |

**Patterns:**

- link every fact to its sources;
- supersede rather than overwrite;
- find matching candidates cheaply, then let a model confirm;
- search with embeddings, keywords and the graph, with no model call;
- copy each source's permissions and check them when someone searches.

Only the closed enterprise products do the last.

**Pitfalls:**

- merging on names conflates people;
- automatic contradiction detection misfires;
- extraction costs several model calls per record (Graphiti's concurrency limit; GraphRAG's warning);
- merged facts and stored summaries can leak what a restricted source says;
- inferred facts look like stated ones unless marked.

**For Mycel:** no product combines Postgres, TypeScript, deletion by source and copied permissions. Hence ADR-0022: build our own on Graphiti's model, with Glean's permission model.

## 2. What platforms require

**Google** ([Workspace API user data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy), updated 2026-09-03):

- **Storing data.**
  - Google's [API terms](https://developers.google.com/terms) bar "build[ing] databases, or otherwise creat[ing] permanent copies". Its [scope docs](https://developers.google.com/workspace/gmail/api/auth/scopes) still expect server storage, with a security assessment.
  - Our reading: storage that serves a user-facing feature, kept per organization and deleted on revocation, is allowed. Raw copies are the risk, hence facts and pointers only.
  - Derived data is covered: "raw or derived user data … will adhere to the Google User Data Policy, including the Limited Use requirements" ([attestation](https://support.google.com/cloud/answer/13805798)).
- **AI.**
  - Banned: training or improving models "beyond that specific user's personalized model".
  - Allowed: a personalized model "tailored to only that end user or organization", which may "not co-mingle Google User Data with other end users or organizations" ([FAQ](https://support.google.com/cloud/answer/13463817)).
  - The privacy policy must say Workspace APIs "are not used to develop, improve, or train non-personalized AI and/or ML models" ([policy](https://support.google.com/cloud/answer/13806988)).
- **People reading data:** only with "explicit consent … to view specific messages", aggregated and anonymized data, for security, or by law.
- **Transfers,** including to LLM providers: only "to provide or improve your appropriate use case", security, law or a merger. So model providers need no-training, zero-retention terms.
- **New restricted-scope rules:**
  - "Keeping user data and credentials … encrypted at rest";
  - keys "stored in a hardware security module";
  - "Protecting against prompt injection techniques by either using Google Cloud Platform's Model Armor or other prompt injection protection".
- **CASA:**
  - It is yearly ([overview](https://support.google.com/cloud/answer/13465431)), and at assurance level AL2 it tests "any user data storage location" ([tiering](https://appdefensealliance.dev/casa/casa-tiering)).
  - Controls include least privilege, IDOR protection and no secrets in logs ([spec](https://github.com/appdefensealliance/ASA-WG/blob/main/CASA/CASA%20Specification.md)).
  - Google sets no deletion deadline in days.
  - On revocation, delete the refresh token (Required, per Google's Cross-Account Protection, [RISC](https://developers.google.com/identity/protocols/risc)).

**Microsoft** ([API terms](https://learn.microsoft.com/en-us/legal/microsoft-apis/terms-of-use)):

- **Databases:** none "except as necessary to enable an intended usage scenario".
- **Minimum permissions.**
- **Mirror source changes:** "implement corrections, restrictions to data, or the deletion of data as reflected in the data obtained" (§5(b)).
- **Leaving:** delete everything when a customer leaves (§5(c)).
- **Publisher verification:** needed so users can consent ([docs](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)).
- **M365 Certification:** optional; its controls are a buyer blueprint: AES-256 at rest, defined retention, 90 days of security logs, a yearly penetration test ([docs](https://learn.microsoft.com/en-us/microsoft-365-app-certification/docs/certification)).

**Slack** ([API terms](https://slack.com/terms-of-service/api), effective 2025-10-10):

- No training LLMs on API data, and no bulk export.
- Keep data from outside your organization to the minimum.
- For the Data Access and Real-Time Search APIs: no "persistent copies, archives, indexes, or long-term data stores of other organizations' API Data", with caching only when "essential for the immediate operation".

Hence ADR-0025.

## 3. What the law requires

**GDPR:**

- **Roles.** The customer is the controller; Mycel is a processor. Using data for our own purposes, such as matching objects across customers, would make Mycel a controller (Art. 28(10)†).
- **The DPA** must cover (Art. 28†):
  - processing only on instructions;
  - confidentiality;
  - helping with data-subject requests and impact assessments;
  - deleting or returning data at the end;
  - audits;
  - subprocessors only with authorisation and notice.
- **Minimization and storage limitation** (Art. 5†).
- **Erasure** (Art. 17) reaches derived facts and embeddings about an identifiable person, including people who never used Mycel. That needs lineage from each source to everything derived from it.
- **Transfers:** SCCs or the EU–US Data Privacy Framework for US model providers.

**EU AI Act** ([service desk](https://ai-act-service-desk.ec.europa.eu/)):

- A memory or agent is not high-risk, unless it is used to "monitor and evaluate the performance and behaviour" of workers.
- Art. 50 requires telling people they are dealing with AI.

**CCPA** (§1798.140(ag)†, CPPA regulations §7051, [cppa.ca.gov](https://cppa.ca.gov/regulations/)): as a service provider, Mycel must not sell or share the data, use it outside the business purpose, or combine it with other sources, and must cooperate with deletion requests.

**SOC 2:**

- The [Trust Services Criteria](https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022) cover least privilege (CC6.3†), monitoring (CC7.2†), identifying and disposing of confidential information (C1.1–C1.2†), and keeping personal information only as needed (P4.2–P4.3†).
- The common questionnaire is CSA's [CCM/CAIQ](https://cloudsecurityalliance.org/research/cloud-controls-matrix).

## 4. Checklist

L = law, P = platform contract or verification, B = buyer expectation.

1. **[P]** One memory per company: no shared models, no matching across companies. Say so in the privacy policy, in Google's words.
2. **[P/L]** Use only for user-facing features. Minimum scopes and minimum facts.
3. **[P]** Slack, and apps with the same rule: search live, store nothing.
4. **[L/P]** Lineage from every source to every fact and embedding, for deletion by source and by person.
5. **[P]** On revocation, delete tokens at once, then the data. Commit to a deadline and a window for backups (**B**).
6. **[P/B]** Mirror deletions, corrections and access changes at the source.
7. **[L]** Find and erase one person across facts, embeddings, caches, logs and backups.
8. **[P]** Encrypt at rest with keys in a KMS or HSM. A key per customer (**B**).
9. **[P]** Prompt-injection protection on everything retrieved.
10. **[P/B]** Least privilege, IDOR-resistant tenant isolation, and a list of staff with access.
11. **[P/B]** Staff read data only with documented consent, security or law, logged where customers see it.
12. **[B/P]** Security logs kept 90 days, with no secrets in logs.
13. **[L]** A DPA (Art. 28 and CCPA), a subprocessor list with notice, SCCs or the Data Privacy Framework, and model providers on no-training, zero-retention terms.
14. **[P]** Google verification and yearly CASA. Microsoft publisher verification.
15. **[L]** Records of processing, a breach process, and AI disclosure (Art. 50). Never market it as employee monitoring.
16. **[B]** SOC 2 Type II, a completed CAIQ, a yearly penetration test and a written retention policy.
