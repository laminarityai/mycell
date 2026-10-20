# Ask for Google write access up front, in as few connections as possible

The connection layout is replaced by ADR-0014 (one Google connection per account). The write-access decision still stands.

Workflows need to label mail, create drafts and append sheet rows, so from M3 on Gmail connections ask for `gmail.modify` instead of `gmail.readonly`, and the Drive connection also asks for `spreadsheets` and serves Sheets calls (through Nango's base-URL override) instead of a separate Sheets connection. Least privilege would ask for read-only access and add write access only when someone switches on a workflow that writes, in a connection per API. We chose frictionless uptake instead: one popup per source, and switching a workflow on never sends anyone back through Google. The cost in verification is small, because `gmail.readonly` and `drive.readonly` are already restricted scopes, `gmail.modify` covers everything `gmail.readonly` does, and `spreadsheets` is only sensitive.

## Considered options

- Write access only when a workflow needs it: a better trust story for outside customers, so worth revisiting at M10.
- `drive.file` with the Google Picker for Sheets: least privilege and non-sensitive, but every sheet must be picked by hand first.

## Consequences

- Connections made before M3 hold read-only scopes. They show "reconnect to grant write access", and `connections` records each connection's granted scopes.
- Whether a Nango reconnect adds scopes to an existing connection is unconfirmed, so M3's dogfood check tests it.
