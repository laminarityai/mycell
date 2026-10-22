# Who sees memory follows each app's own sharing

Replaces automatic promotion. A fact is visible to anyone who can see at least one of the sources it came from, and Mycel learns who that is from the app itself: each source record keeps a copy of its access list (a Drive file's sharing list, the people on an email or invite, a channel's members), checked whenever someone asks, and re-read when the app reports a change and nightly. That makes company knowledge such as a policy in a doc shared with the whole company reachable by everyone, without a model guessing what's private. We chose it over promoting facts found in several people's private mail, which can surface something two managers both know to everyone, and over admins approving members' facts, which means admins read members' mail (ADR-0001).

## Consequences

- **Company-wide** means the app's own sharing (a doc shared with the domain, a shared drive), a group list an admin marks as company-wide (such as all@), or any org connection (such as support@). Google tells only admins who is in a group, which we don't use (ADR-0008), so for other groups only confirmed recipients count: people whose own connected mailbox holds the item.
- **Each person's own view.** The agent and the MCP server see exactly what the person using them can see. A summary of an object is built when asked, from only the facts that person can see; nothing merged is stored.
- **Acting:** the agent and MCP clients read memory and act only through workflows and the Reviews page. "Remember this" creates a fact owned by that person. Everything they retrieve is screened for prompt injection, as Google's restricted-scope rules require.
- **Company policy.** Memory is on for every connection; members can't switch it off and don't see its contents. Admins set company-wide exclusions, such as Gmail labels or Drive folders.
- ADR-0001 still governs evidence shown with suggestions.
