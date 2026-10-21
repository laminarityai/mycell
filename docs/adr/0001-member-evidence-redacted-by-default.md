# Admins see member-scope evidence only as aggregates unless the member shares it

When a suggestion is mined partly from a member's own mailbox, admins see counts, cluster labels, and slot-redacted templates, never the raw messages. A member can choose to share specific examples. Evidence from org connections (e.g. a support@ inbox) is shown raw to admins. We picked this over showing admins re-fetched raw evidence because at a small company the admin is often the boss, and members won't connect an inbox their boss can read. It is the simplest rule consistent with the promotion model, and loosening it later is far easier than winning back trust.

Promotion is replaced by ADR-0022 (who sees memory follows each app's own sharing). This rule for evidence shown with suggestions still stands.
