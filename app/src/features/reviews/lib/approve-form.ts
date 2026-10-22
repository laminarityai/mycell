// Reading the approve form: the review, and the person's edits, if any. `text` is there only when
// they edited a draft, and `field:<name>` entries only when they edited a held send. The edits
// are held in memory and handed to the adapter, never stored (invariant 8).
import { z } from "zod";
import type { ReviewEdits } from "@/features/runtime/adapters";
import { parseForm } from "@/lib/forms";

const FIELD = "field:";

const approveInput = z.object({ reviewId: z.string().min(1), text: z.string().optional() });

// A held send's edited fields, by input name: each `field:<name>` entry, which must be text.
const editedFields = z
  .record(z.string(), z.unknown())
  .transform((entries) =>
    Object.fromEntries(
      Object.entries(entries).flatMap(([name, value]) =>
        name.startsWith(FIELD) ? [[name.slice(FIELD.length), value]] : [],
      ),
    ),
  )
  .pipe(z.record(z.string().min(1), z.string()));

/** The approve form's review and edits, or ValidationError for a form that doesn't fit. */
export function parseApproveForm(form: FormData): { reviewId: string; edits?: ReviewEdits } {
  const { reviewId, text } = parseForm(approveInput, form);
  const fields = parseForm(editedFields, form);
  if (text !== undefined) return { reviewId, edits: { text } };
  if (Object.keys(fields).length > 0) return { reviewId, edits: { fields } };
  return { reviewId };
}
