// Node's hooks for `*.prompt.yml` files, for code Node runs without Turbopack or Vitest: the
// scripts that call features (`node --import tsx --import ./prompt-hooks.cjs`), `pnpm db:generate`
// and `db:migrate` (drizzle-kit loads schemas whose imports reach prompt files) and the
// end-to-end tests and their fake servers (playwright.config.ts). Each file loads as its parsed
// YAML, as prompt-loader.cjs bundles it. `server-only` resolves as a server bundle resolves it
// (the react-server condition, an empty module), since that code runs on the server here too.
const { readFileSync } = require("node:fs");
const { registerHooks } = require("node:module");
const { fileURLToPath } = require("node:url");
const { parsePromptFile } = require("./prompt-loader.cjs");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "server-only") return nextResolve(specifier, context);
    return nextResolve(specifier, {
      ...context,
      conditions: [...context.conditions, "react-server"],
    });
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(".prompt.yml")) return nextLoad(url, context);
    const parsed = parsePromptFile(readFileSync(fileURLToPath(url), "utf8"));
    return {
      format: "commonjs",
      source: `module.exports = ${JSON.stringify(parsed)};`,
      shortCircuit: true,
    };
  },
});
