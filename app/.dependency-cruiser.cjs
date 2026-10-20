// @ts-check
// Deep-module enforcement for dependency-cruiser, adapted from the setup-ts-deep-modules skill.
//
// Each feature under FEATURES_ROOT is a deep module. Its root files are its entry points
// (server.ts, actions.ts, ui.tsx, jobs.ts, types.ts; see docs/conventions.md). Everything in
// its subfolders (lib/, tests/, …) is private. There is no index.ts barrel.

/** Where features live. One immediate child dir per feature (flat, no nesting). */
const FEATURES_ROOT = "src/features";

// --- derived patterns (no need to edit) -------------------------------------
const R = FEATURES_ROOT; // short alias used in the patterns below
/**
 * A feature's private internals: anything nested inside a feature subfolder.
 * The feature's root files are its entry points and are NOT matched here:
 * they stay importable from outside.
 */
const FEATURE_INTERNALS = `^${R}/[^/]+/[^/]+/`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "entrypoint-boundary-from-app",
      comment:
        "App/root code may import a feature's entry points (its root files), but nothing inside its subfolders.",
      severity: "error",
      from: { pathNot: `^${R}/` }, // importer is NOT inside any feature
      to: { path: FEATURE_INTERNALS },
    },
    {
      name: "entrypoint-boundary-across-features",
      comment:
        "A feature's own files import each other freely, but may reach OTHER features only through their entry points, never their internals.",
      severity: "error",
      // importer is inside a feature ($1), but is not a test file
      from: { path: `^${R}/([^/]+)/`, pathNot: `^${R}/[^/]+/tests/` },
      to: {
        path: FEATURE_INTERNALS,
        pathNot: [
          `^${R}/$1/`, // same feature → intra-feature freedom
          `^${R}/[^/]+/lib/schema\\.ts$`, // the next rule covers other features' schemas
        ],
      },
    },
    {
      name: "schemas-only-from-schemas",
      comment:
        "A feature's lib/schema.ts may import another feature's lib/schema.ts, only so its foreign keys can reference that table (derived data cascades from its connection). Nothing else may.",
      severity: "error",
      from: { path: `^${R}/([^/]+)/`, pathNot: `^${R}/[^/]+/lib/schema\\.ts$` },
      to: { path: `^${R}/[^/]+/lib/schema\\.ts$`, pathNot: `^${R}/$1/` },
    },
    {
      name: "tests-through-entrypoints",
      comment:
        "A feature's tests exercise it through its entry points like everyone else: they may import any feature's entry points and their own tests/ fixtures, but never any feature's internals, not even their own.",
      severity: "error",
      from: { path: `^${R}/([^/]+)/tests/` }, // a test file, in feature $1
      to: {
        path: FEATURE_INTERNALS,
        pathNot: `^${R}/$1/tests/`, // own tests/ fixtures → allowed
      },
    },
    {
      name: "tests-folder-is-private",
      comment:
        "A feature's tests/ folder is reachable only from tests: nothing else may import fixtures.",
      severity: "error",
      from: { pathNot: `^${R}/[^/]+/tests/` }, // importer is not itself a test
      to: { path: `^${R}/[^/]+/tests/` },
    },
    {
      name: "no-circular",
      comment:
        "No dependency cycles. Scope to `^${R}/` if you want to allow cycles outside features.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
  },
};
