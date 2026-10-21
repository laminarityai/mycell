// The notifications feature's public types.

/** One email to one person. Never message or draft text (invariant 8): counts, names and links. */
export type Email = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers, such as `List-Unsubscribe`. */
  headers?: Record<string, string>;
  /**
   * Makes a retry of the same send a no-op at the provider: the same key within 24 hours sends
   * nothing more. A job sets one per email it means to send once.
   */
  idempotencyKey?: string;
};
