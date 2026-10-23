// The loader for `*.prompt.yml` files, so the prompts are parsed at build time and bundled, and
// never read from disk at runtime: Turbopack runs it through `turbopack.rules` (next.config.ts),
// Vitest through a plugin (vitest.config.mts), and Node, for what it runs itself (scripts and
// the end-to-end tests), through `prompt-hooks.cjs`. A file becomes a module whose default export
// is its parsed YAML, which `definePrompts` checks (src/lib/prompts.ts).
const { FAILSAFE_SCHEMA, load } = require("js-yaml");

/**
 * A prompt file's YAML, parsed. The failsafe schema reads every value as text, so a template
 * that reads `yes` or `1.0` stays as written.
 */
function parsePromptFile(source) {
  return load(source, { schema: FAILSAFE_SCHEMA });
}

/** The ES module a prompt file becomes. */
function promptModule(source) {
  return `export default ${JSON.stringify(parsePromptFile(source))};`;
}

module.exports = function promptLoader(source) {
  return promptModule(source);
};
module.exports.parsePromptFile = parsePromptFile;
module.exports.promptModule = promptModule;
