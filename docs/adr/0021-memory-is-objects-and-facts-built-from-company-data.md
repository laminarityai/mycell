# Memory is objects and facts built from company data

Replaces ADR-0008's gate on an entity backbone. Mycel builds a memory of each company: **objects** (people, companies, deals, projects, documents), the links between them, and **facts** about them, drawn from the company's connected apps. Discovery mines it for repetitive work, and workflows, the builder, an agent (M9) and later an MCP server use it as context. We build it whether or not it improves discovery, because workflows and the agent need it anyway, so the discovery-lens experiment no longer blocks it; M2's synthetic-company generator measures discovery instead. No memory product we studied copies each app's sharing rules and deletes by source (`docs/research/memory-layer.md`), so we build our own in Postgres with pgvector, in TypeScript (ADR-0004), on Graphiti's data model.

## Consequences

- **Facts and pointers only.** A fact is a short statement ("Acme's renewal is in March") linked to the source records it came from. No source text is stored; citations and re-extraction re-fetch the source (invariant 8). Google's terms ban "creating permanent copies" of user data.
- **Only stated facts.** A fact is something a source says or a person told Mycel ("remember this"). Judgements such as "Acme seems unhappy" are made when someone asks and never stored.
- **Time:** a contradicted fact is superseded, not overwritten: each keeps when it was true and when it was recorded, and answers use the newest.
- **Matching:** exact keys (email address, domain, CRM ID, file ID) and fuzzy and similarity techniques find candidates; an AI model confirms them. Objects are never matched across companies, which would make Mycel a GDPR controller.
- **What it learns from:** a cheap `classify` step skips newsletters, marketing, notifications and personal mail, and facts are extracted only from business items in Gmail, Drive docs and Calendar, within a monthly extraction budget per company, estimated before the first run (invariant 7).
- **People outside the company** (customers, vendors) are kept with work facts only: name, company, role, relationship, recent interactions.
- **Retrieval** combines embeddings, keyword search and links between objects, with no model call when someone searches.
- Who sees what is ADR-0022; retention, deletion and logging are ADR-0023.
