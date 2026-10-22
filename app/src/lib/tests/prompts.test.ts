import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { definePrompts } from "../prompts";
import greetings from "./greetings.prompt.yml";
import misspelled from "./misspelled.prompt.yml";

const SRC = join(import.meta.dirname, "../..");
const files = readdirSync(SRC, { recursive: true, encoding: "utf8" });
const promptFiles = files.filter((file) => file.endsWith(".prompt.yml"));

/** Each `.ts`/`.tsx` file that imports a prompt file, with the prompt files it imports. */
const importers = files
  .filter((file) => /\.tsx?$/.test(file))
  .map((file) => {
    const source = readFileSync(join(SRC, file), "utf8");
    const imported = Array.from(
      source.matchAll(/(?:from|import)\s+["']([^"']+\.prompt\.yml)["']/g),
      ([, specifier]) =>
        specifier.startsWith("@/")
          ? specifier.slice(2)
          : relative(SRC, join(SRC, dirname(file), specifier)),
    );
    return { file, imported };
  })
  .filter(({ imported }) => imported.length > 0);

describe("prompt files", () => {
  it("live in a feature's prompts/ folder, or beside the tests that use them", () => {
    const misplaced = promptFiles.filter(
      (file) =>
        !/^features\/[^/]+\/prompts\/[^/]+\.prompt\.yml$/.test(file) &&
        !/^(features\/[^/]+|lib)\/tests\/[^/]+\.prompt\.yml$/.test(file),
    );

    expect(misplaced).toEqual([]);
  });

  it("are each imported by code", () => {
    const imported = new Set(importers.flatMap((importer) => importer.imported));

    expect(promptFiles.filter((file) => !imported.has(file))).toEqual([]);
  });

  it("match what their code declares, so every module defining prompts loads", async () => {
    const modules = importers.filter(({ file }) => !file.endsWith(".test.ts"));

    expect(modules.length).toBeGreaterThan(0);
    for (const { file } of modules) await import(join(SRC, file));
  });
});

describe("definePrompts", () => {
  const declared = { greet: ["name", "place"], farewell: [] } as const;

  it("renders each template, filling in its variables once", () => {
    const prompts = definePrompts(greetings, declared);

    expect(prompts.greet({ name: "Ada", place: "{{name}}" })).toBe(
      "Hello, Ada. Welcome to {{name}}.",
    );
    expect(prompts.farewell()).toBe("Goodbye.");
  });

  it("takes exactly a template's variables, in the types too", () => {
    const prompts = definePrompts(greetings, declared);

    // @ts-expect-error: place is missing.
    expect(() => prompts.greet({ name: "Ada" })).toThrow("No value for {{place}}.");
    // @ts-expect-error: greet has no variable called plcae.
    expect(prompts.greet({ name: "Ada", place: "Mycel", plcae: "Mycel" })).toBe(
      "Hello, Ada. Welcome to Mycel.",
    );
  });

  it("throws when the file lacks a declared template", () => {
    expect(() => definePrompts(greetings, { ...declared, welcome: [] })).toThrow(
      '"welcome" is missing',
    );
  });

  it("throws when the file has a template that isn't declared", () => {
    expect(() => definePrompts(greetings, { greet: ["name", "place"] })).toThrow(
      `"farewell" isn't declared`,
    );
  });

  it("throws when a template's placeholders aren't its declared variables", () => {
    expect(() => definePrompts(greetings, { greet: ["name"], farewell: [] })).toThrow(
      `"greet" has {{place}}, which isn't declared`,
    );
    expect(() =>
      definePrompts(greetings, { greet: ["name", "place", "time"], farewell: [] }),
    ).toThrow('"greet" has no {{time}}');
  });

  it("throws on a placeholder that isn't {{name}}", () => {
    expect(() => definePrompts(misspelled, { spaced: [], unclosed: [] })).toThrow(
      `"spaced" has a placeholder that isn't {{name}}; "unclosed" has a placeholder that isn't {{name}}`,
    );
  });
});
