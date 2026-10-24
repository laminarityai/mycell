// What a workflow's monthly credit budget does (M7), in the words shown under its field in the
// editor and on the Health tab.

/** The budget field's help, a paragraph each. */
export const BUDGET_HELP = [
  "The most this workflow's live runs may spend in a calendar month, counted in UTC from the 1st. Try it and builder chats don't count.",
  "Once it's spent, the workflow pauses until next month; the run that reaches it finishes. Raising or removing the budget resumes it at once, as soon as you publish. Leave it empty to let only the company's balance limit it.",
] as const;

/** The budget field's ID, which the Health tab's "Change the budget" moves to. */
export const BUDGET_FIELD_ID = "monthly-credit-budget";
