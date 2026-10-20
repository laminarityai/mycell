# Conventions

The always-on rules live in `AGENTS.md` ("Invariants", "Writing code"). This file holds the detail behind them. Consistency matters more than any single rule: when this file doesn't cover a case, match the code next to it.

## Inside a feature directory

Every `app/src/features/<name>/` has the same shape. Root files are the public entry points (each optional), and subfolders are private. dependency-cruiser makes it a lint error to import a subfolder from outside its feature.

| File         | Exports                                        | Imported by                             |
| ------------ | ---------------------------------------------- | --------------------------------------- |
| `server.ts`  | server-side functions, each taking `ctx` first | Server Components, other features, jobs |
| `actions.ts` | Server Actions (`"use server"`)                | client components                       |
| `ui.tsx`     | the feature's React components                 | pages in `src/app/`                     |
| `jobs.ts`    | the feature's Inngest functions                | the single Inngest route                |
| `types.ts`   | public types and Zod schemas                   | anyone                                  |

- `server.ts` functions that exist before any `ctx` does (sign-in, resolving the session to `ctx`, the auth route) are the only ones that don't take it first; they live in `orgs`.
- `lib/`: implementation, including `lib/schema.ts` for the feature's tables.
- `tests/`: tests that import only the feature's entry files.
- `tests/isolation-cases.ts`: a case for every function `server.ts` exports, proving it stays inside the caller's org (see "Tests" below).
- **Tables are private to their feature (ADR-0005).** A feature that needs another feature's data calls that feature's `server.ts`, which also exposes any join a screen needs.
- Import from the file that owns the thing. A directory has no `index.ts` re-exporting it.

`src/app/` holds routes only (pages, layouts, route handlers), kept thin: they call features. `src/db/` holds the Drizzle client, migrations, `forOrg(ctx)`, Better Auth's generated schema (`auth-schema.ts`), and the shared test fixtures in `testing/`, and no feature tables. `src/components/ui/` holds shadcn/ui components and `src/lib/` holds shared helpers that belong to no feature. To start a feature, copy the shape of an existing one, but not the data access of `orgs`, which is the one feature that skips `forOrg` (see below).

## Data access and config

- **Tenant data (ADR-0003):** feature code queries through `forOrg(ctx)`, which always filters by `org_id` and sets it on inserts from `ctx`, never from caller input. A tenant table names its column `orgId` (`org_id` in SQL). Importing the raw Drizzle client outside `src/db/` is a lint error. There is no Postgres RLS. Better Auth's tables are the one exception: they key the org as `organization_id`, aren't reached through `forOrg`, and only the `orgs` feature touches them. Lint lets `src/features/orgs/lib/` import the raw client and `@/db/auth-schema`, and nothing else outside `src/db/`. The one other exception: a feature's `lib/schema.ts` may import `@/db/auth-schema` so its foreign keys can reference a member as `(org_id, user_id)`, which keeps the row in the member's org and deletes it when the member is removed.
- **Request context:** `ctx` is passed explicitly. There is no AsyncLocalStorage or other hidden request state.
- **Server boundary:** reads and writes go through Server Components and Server Actions. Add tRPC, a REST layer, or a client-side data cache only when a real need appears, and record it as an ADR.
- **Local database:** `pnpm db:up` starts Postgres with pgvector in Docker on port 5433 (`pnpm db:down` stops it). Copy `app/.env.example` to `app/.env`. Install the browser the e2e tests drive once with `pnpm --filter app exec playwright install chromium`.
- **Migrations:** `pnpm db:generate` (`drizzle-kit generate`) writes SQL files to `src/db/migrations/`, which are committed and applied with `pnpm db:migrate` (`drizzle-kit migrate`). Every schema change goes through a reviewed migration file; `drizzle-kit push` is not used. SQL Drizzle can't express (extensions) goes in a `drizzle-kit generate --custom` migration.
- **Config:** environment variables are parsed once by a Zod schema in `src/env.ts`, and everything else imports from there. Reading `process.env` elsewhere is a lint error.
- **Errors:** a small set of typed error classes (`NotFoundError`, `ForbiddenError`, `OutOfCreditsError`, …) is thrown and caught at the Server Action or route boundary. Plain `throw`, no Result/Either types, no Effect.

## UI

Tailwind plus shadcn/ui, with component source copied into the repo. shadcn/ui is built on Radix primitives, so new Radix pieces arrive as shadcn components, keeping one component library.

## Tooling

- **TypeScript:** strict. Typed values at every feature boundary; Zod at every IO boundary.
- **ESLint:** typescript-eslint `strict-type-checked`, plus the Next.js config. It catches bugs and never formats. `max-lines` caps files at 300 lines, and `import/no-default-export` enforces named exports outside the Next.js special files.
- **Version pins:** ESLint stays on 9 and TypeScript on 6.0 until `eslint-config-next`'s plugins support ESLint 10 and typescript-eslint supports TypeScript 7.
- **Prettier:** the only formatter.
- **Tests:** Vitest. Database tests run against real Postgres with pgvector (Docker locally, a service container in CI), in a separate `mycel_test` database that the test run creates and migrates. Each test file starts from an empty database, so files run one at a time.
- **End-to-end tests:** Playwright, Chromium only, in `app/e2e/`. They drive the production build through `next start` on port 3100 (so `pnpm verify` runs them after `pnpm build`; run `pnpm build` before a standalone `pnpm e2e`) against a separate `mycel_e2e` database that Playwright's global setup creates and migrates. Each test that takes the `orgs` fixture starts from an empty database seeded with `seedTwoOrgs()`, and tests run one at a time. Sign-in is Google-only, so `signInAs(user)` stores a Better Auth session and sets its signed session cookie on the browser (`e2e/sign-in-as.ts`); production code has no test login route. Keep them few and about user-visible behavior through the UI; logic belongs in Vitest.
- **Isolation tests:** `seedTwoOrgs()` from `src/db/testing/two-org-fixture.ts` seeds org A and org B, each with an admin and a member and a `ctx` for each. Each feature's `tests/isolation-cases.ts` passes `defineIsolationCases(server, { … })` a case for every `server.ts` export. `src/db/tests/isolation.test.ts` runs every case and fails, as does typecheck, when an export has none. It checks `server.ts` only, so `actions.ts` and `jobs.ts` stay thin and call `server.ts`. Mark a function that touches no org data `notTenantScoped("why")`.
- **Pre-commit (Husky + lint-staged):** Prettier and ESLint `--fix` on staged files, then typecheck. Tests stay out of the hook.
- **Pre-push:** `pnpm verify`.
- **CI:** the GitHub Actions workflow runs `pnpm verify` and nothing else (after installing dependencies and Playwright's Chromium), so a laptop and CI always check the same things.

## Naming

- Files: `kebab-case.ts`.
- Exports: named. Default exports only where Next.js requires them (`page.tsx`, `layout.tsx`, …).
- DB tables: `snake_case` plural (`workflow_versions`). TypeScript types: `PascalCase` singular (`WorkflowVersion`).
- Domain names: `GLOSSARY.md` terms, using the term itself rather than its listed _Avoid_ words (`Enablement`, not `Subscription`).
