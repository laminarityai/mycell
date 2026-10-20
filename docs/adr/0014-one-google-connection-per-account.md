# One Google connection per account, asking for every Google app at once

Replaces the "one connection per source" part of ADR-0011. Each person, and each org account such as support@, connects Google once. That connection asks for Gmail, Drive, Sheets, Calendar, Docs and Tasks together, and lands in M3, when everyone already has to reconnect to grant write access. Calendar, Docs and Tasks aren't used until M11, so this asks for access before we need it. We accept that for frictionless uptake: one popup, one reconnect, and no second round of "reconnect to allow Calendar" for every teammate in M11. Google checks how each access is used only when we open to outside customers (M10). All three new accesses are sensitive, not restricted, so verification gets no harder than Gmail already makes it.

## Considered options

- Merge in M11 instead: asks only for what's used, but every teammate reconnects twice.
- One connection per Google app: least privilege, but one popup per app.

## Consequences

- The existing Gmail and Drive connections are replaced, not merged. Connecting Google deletes them and their data (invariant 3), and the new connection backfills again. That's cheap while only we use Mycel.
- Google lets people untick apps on the consent screen. Each connection records which apps it was granted. Switching on a workflow that needs a missing one shows "reconnect to allow Calendar", and everything else keeps working.
- Disconnecting removes everything from every Google app at once. A member can't drop just Calendar except by reconnecting and unticking it.
- Revisit at M10, when asking for less matters more to outside customers.
