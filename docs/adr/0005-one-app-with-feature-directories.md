# One Next.js app with feature directories, not a multi-package monorepo

The repo is a pnpm workspace with exactly two members: `app/` (the Next.js app, which also serves Inngest jobs) and `nango-integrations/` (deployed separately by the Nango CLI). Features live in `app/src/features/<name>/`, one directory each, owning their tables, logic, Server Actions, and UI; dependency-cruiser enforces that features import each other only through their entry files. The original plan was an eight-package Turborepo-style monorepo, but there is only one deployable app, so packages would add per-package build config without adding boundaries that lint can't already enforce. Revisit this only if a second deployable app appears.

## Consequences

- A feature's tables are private (`lib/schema.ts`). Other features never import them, even for reads; they call the owning feature's `server.ts` functions, and the owning feature exposes any join a screen needs. This costs an extra query here and there, which is negligible at v1 scale, in exchange for a boundary rule with no exceptions.
