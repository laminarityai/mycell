import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";

// Next.js files that must use a default export.
const NEXT_DEFAULT_EXPORT_FILES =
  "src/app/**/{page,layout,loading,error,global-error,not-found,forbidden,unauthorized,template,default,opengraph-image,twitter-image,icon,apple-icon,sitemap,robots,manifest}.{ts,tsx}";

const rawClientImport = {
  group: ["@/db/client", "**/db/client"],
  message: "Only src/db may use the raw database client. Query org data through forOrg(ctx).",
};
const authSchemaImport = {
  group: ["@/db/auth-schema", "**/db/auth-schema"],
  message: "Better Auth's tables belong to the orgs feature. Call its server.ts instead.",
};
const driverImports = {
  group: [
    "drizzle-orm/node-postgres",
    "drizzle-orm/neon-*",
    "pg",
    "postgres",
    "@neondatabase/serverless",
  ],
  message: "Database drivers belong in src/db. Query org data through forOrg(ctx).",
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["src/**/*.{ts,tsx}", "e2e/**/*.ts"],
    rules: {
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      "import/no-default-export": "error",
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Import `env` from the env module instead; it is the only place that reads process.env.",
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    // Better Auth's tables key the org as organization_id, so forOrg can't reach them. The orgs
    // feature owns them and queries them directly (docs/conventions.md, "Data access").
    ignores: ["src/db/**", "src/features/orgs/lib/**", "src/features/*/lib/schema.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [rawClientImport, authSchemaImport, driverImports] },
      ],
    },
  },
  {
    // A feature's tables may reference Better Auth's in foreign keys, and nothing more.
    files: ["src/features/*/lib/schema.ts"],
    ignores: ["src/features/orgs/lib/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [rawClientImport, driverImports] }],
    },
  },
  { files: ["src/env.ts"], rules: { "no-restricted-properties": "off" } },
  { files: [NEXT_DEFAULT_EXPORT_FILES], rules: { "import/no-default-export": "off" } },
  // Playwright loads its global setup as a default export.
  { files: ["e2e/global-setup.ts"], rules: { "import/no-default-export": "off" } },
  prettier,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
