// Text written for a model lives in prompt files, `features/<name>/prompts/<name>.prompt.yml`:
// each a map of named templates with `{{variable}}` placeholders, bundled at build time
// (prompt-loader.cjs). `definePrompts` checks a file against the templates and variables its
// code declares when the module loads, and renders each template as a PromptText, which is what
// the model calls take (docs/conventions.md, "Prompts").
import { z } from "zod";
import { InvariantError } from "./errors";

/** Text rendered from a prompt file. Only this module makes one. */
export type PromptText = string & { readonly __brand: "PromptText" };

/** A prompt file as it's bundled (`src/prompt-files.d.ts`): only `definePrompts` reads one. */
export type PromptFile = { readonly __brand: "PromptFile" };

/** The variables each template takes, by its name in the file. */
export type PromptVariables = Record<string, readonly string[]>;

/** Renders a template: with no argument when it takes no variables, else with a value for each. */
export type Render<V extends readonly string[]> = V extends readonly []
  ? () => PromptText
  : (values: { readonly [K in V[number]]: string }) => PromptText;

export type Prompts<D extends PromptVariables> = { readonly [K in keyof D]: Render<D[K]> };

const fileSchema = z.record(z.string(), z.string());

// `{{name}}`. Anything else between double braces is a typo, and fails the check.
const PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g;

/**
 * The file's templates, each a function filling in its variables. Throws, when the module
 * loads, unless the file has exactly the declared templates and each template's placeholders
 * are exactly its declared variables.
 */
export function definePrompts<const D extends PromptVariables>(
  file: PromptFile,
  declared: D,
): Prompts<D> {
  const templates = checkedTemplates(file, declared);
  return Object.fromEntries(
    Object.entries(templates).map(([name, template]) => [
      name,
      (values: Record<string, string> = {}) => fill(template, values),
    ]),
  ) as Prompts<D>;
}

/** Rendered texts joined into one: a line or a blank line apart, or as a list in a sentence. */
export function joinPrompts(
  texts: readonly PromptText[],
  separator: "\n" | "\n\n" | ", " | "; ",
): PromptText {
  return texts.join(separator) as PromptText;
}

function checkedTemplates(file: unknown, declared: PromptVariables): Record<string, string> {
  const parsed = fileSchema.safeParse(file);
  if (!parsed.success) {
    throw new InvariantError(`A prompt file maps names to text: ${z.prettifyError(parsed.error)}`);
  }
  const templates = parsed.data;
  const problems = Object.keys(declared)
    .filter((name) => !Object.hasOwn(templates, name))
    .map((name) => `"${name}" is missing`);
  for (const [name, template] of Object.entries(templates)) {
    if (!Object.hasOwn(declared, name)) {
      problems.push(`"${name}" isn't declared`);
      continue;
    }
    const variables = declared[name];
    const placeholders = new Set(Array.from(template.matchAll(PLACEHOLDER), (match) => match[1]));
    const rest = template.replace(PLACEHOLDER, "");
    if (rest.includes("{{") || rest.includes("}}")) {
      problems.push(`"${name}" has a placeholder that isn't {{name}}`);
    }
    for (const placeholder of placeholders) {
      if (!variables.includes(placeholder)) {
        problems.push(`"${name}" has {{${placeholder}}}, which isn't declared`);
      }
    }
    for (const variable of variables) {
      if (!placeholders.has(variable)) problems.push(`"${name}" has no {{${variable}}}`);
    }
  }
  if (problems.length > 0) {
    throw new InvariantError(
      `A prompt file doesn't match its declaration: ${problems.join("; ")}.`,
    );
  }
  return templates;
}

// One pass, so a value holding `{{…}}` is never filled in itself.
function fill(template: string, values: Record<string, string>): PromptText {
  return template.replace(PLACEHOLDER, (_, name: string) => {
    if (!Object.hasOwn(values, name)) throw new InvariantError(`No value for {{${name}}}.`);
    return values[name];
  }) as PromptText;
}
