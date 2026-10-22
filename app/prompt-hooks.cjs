// Node's hooks for `*.prompt.yml` files, for code Node runs without Turbopack or Vitest: the
// scripts that call features (`node --import tsx --import ./prompt-hooks.cjs`) and the
// end-to-end tests (playwright.config.ts). Each file loads as its parsed YAML, as
// prompt-loader.cjs bundles it.
const { readFileSync } = require("node:fs");
const { registerHooks } = require("node:module");
const { fileURLToPath } = require("node:url");
const { parsePromptFile } = require("./prompt-loader.cjs");

registerHooks({
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
