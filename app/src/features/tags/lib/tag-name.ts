import { ValidationError } from "@/lib/errors";

const slug = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const maxLength = 40;

/**
 * A tag name as stored: a lowercase kebab-case slug, because specs name tags like identifiers
 * (`"visibility": { "tags": ["sales"] }`). "  Support Team " becomes "support-team".
 */
export function normalizeTagName(input: string): string {
  const name = input.trim().toLowerCase().replace(/\s+/g, "-");
  if (name.length > maxLength || !slug.test(name)) {
    throw new ValidationError(
      `Tag names use lowercase letters, digits, and single hyphens, start with a letter, and are at most ${String(maxLength)} characters (e.g. "support-team").`,
    );
  }
  return name;
}
