import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import jsxA11y from "eslint-plugin-jsx-a11y";
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

// The server renders dates in its own time zone and the browser in the reader's, so formatting
// one anywhere but <DateTime> risks a hydration error and a time the reader can't place.
const dateFormatting = [
  {
    selector: "CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/]",
    message:
      "Show dates with <DateTime> (src/components/date-time.tsx): the server's time zone isn't the reader's.",
  },
  {
    selector:
      ":matches(NewExpression, CallExpression)[callee.object.name='Intl'][callee.property.name='DateTimeFormat']",
    message:
      "Show dates with <DateTime> (src/components/date-time.tsx): the server's time zone isn't the reader's.",
  },
];

// A Server Action goes through runFormAction (or runValueAction), which parses its input inside
// the `try`, turns typed errors into messages and hands a failed form back what it sent.
const ACTION_HELPER =
  "Go through runFormAction or runValueAction from @/features/orgs/form-action.";
const actionImports = [
  { name: "@/features/orgs/server", importNames: ["getCtx"], message: ACTION_HELPER },
  { name: "./server", importNames: ["getCtx"], message: ACTION_HELPER },
  { name: "@/lib/forms", importNames: ["parseForm", "parseValue"], message: ACTION_HELPER },
  { name: "@/lib/errors", importNames: ["actionError"], message: ACTION_HELPER },
];
const actionParsing = {
  selector:
    "CallExpression[callee.property.name=/^(safeParse|parse)(Async)?$/][callee.object.name!='JSON']",
  message: `Don't parse an action's input by hand: a ZodError would reach the user. ${ACTION_HELPER}`,
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
    // eslint-config-next registers the plugin but turns on few of its rules; these are the rest.
    files: ["**/*.tsx"],
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Our ui components that render a form control, so a label wrapping one is tied to it, and
      // a label's text may sit in a span holding its name and hint.
      "jsx-a11y/label-has-associated-control": [
        "error",
        { controlComponents: ["Input", "Textarea", "Checkbox", "Switch"], depth: 3 },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "e2e/**/*.ts", "scripts/**/*.ts"],
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
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/date-time.tsx"],
    rules: { "no-restricted-syntax": ["error", ...dateFormatting] },
  },
  {
    // A rule's options replace, not merge, so the restrictions above are repeated here.
    files: ["src/features/*/actions.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: actionImports,
          patterns: [rawClientImport, authSchemaImport, driverImports],
        },
      ],
      "no-restricted-syntax": ["error", ...dateFormatting, actionParsing],
    },
  },
  { files: ["src/env.ts"], rules: { "no-restricted-properties": "off" } },
  { files: [NEXT_DEFAULT_EXPORT_FILES], rules: { "import/no-default-export": "off" } },
  // Playwright loads its global setup as a default export.
  { files: ["e2e/global-setup.ts"], rules: { "import/no-default-export": "off" } },
  prettier,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
