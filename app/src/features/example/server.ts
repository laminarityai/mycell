// Copy-me template for a feature. Root files are entry points; subfolders are private.
// Delete this feature once a real one exists to copy from.
// Real server functions take `ctx` first (AGENTS.md); `ctx` arrives with sign-in, so this one can't yet.
import { formatGreeting } from "./lib/format-greeting";

export function greet(name: string): string {
  return formatGreeting(name.trim());
}
