# Mycel holds a waiting send when the app has no way to hold it

Replaces ADR-0013's rule that an app with no pending form waits until we design one. Slack, Teams, Google Chat, Zendesk replies and comments everywhere have no unsent state, so under that rule most apps beyond Google could never send anything. When an app can't hold an action, Mycel holds it: the request and its text, encrypted, until the review ends, then deleted. A review of a held send that nobody ends within 30 days ends as **expired** and its content is deleted; reviews of items an app holds, such as Gmail drafts, still never expire, since Mycel holds nothing for them. Where an app can hold an action, its own pending form still comes first (ADR-0013). We accepted storing content, against invariant 8, because the alternative was no sending in most apps, and limited it to waiting sends, encrypted, for at most 30 days.

## Consequences

- Disconnecting deletes held sends with everything else from the connection (invariant 3).
- A held send can't be finished in the app, so it never ends as "done in the app".
