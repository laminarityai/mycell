// A `*.prompt.yml` file, as prompt-loader.cjs bundles it: its parsed YAML, which only
// `definePrompts` reads (src/lib/prompts.ts).
declare module "*.prompt.yml" {
  import type { PromptFile } from "@/lib/prompts";

  const file: PromptFile;
  export default file;
}
