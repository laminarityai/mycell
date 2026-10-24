// What a failure means in words a person can act on, the one place the Runs page and a run's page
// read it from. Built from the failure's code and the record's own message, which hold no
// content (invariant 8), so anyone who may see the run may read it. Pure, so client code may
// import it.
import { INTERNAL_ERROR_MESSAGE } from "./types";

/** A failure, a run's or a step's, as a person reads it. */
export type FailureText = {
  /** What went wrong, in one sentence. */
  summary: string;
  /** The record's own words (the fields or check involved), when they add to the summary. */
  detail: string | null;
  /** What to do about it. */
  todo: string;
  /** A bug of ours: nothing in the workflow needs changing. */
  ours: boolean;
};

const PUBLISH = "then publish a new version";

const TEXTS: Partial<Record<string, Omit<FailureText, "detail">>> = {
  internal_error: {
    summary: INTERNAL_ERROR_MESSAGE,
    todo: "Nothing for you to do: we log every internal error and fix it on our side.",
    ours: true,
  },
  out_of_credits: {
    summary: "The company ran out of credits.",
    todo: "Add credits: workflows start again on new mail once there are some.",
    ours: false,
  },
  connection_gone: {
    summary: "The inbox's connection was deleted while the run was going.",
    todo: "Nothing to fix: the run stopped with its connection.",
    ours: false,
  },
  source_error: {
    summary: "Google refused the request or didn't answer, three times.",
    todo: "If the connection says it needs reconnecting, reconnect Google on the Connections page. Otherwise it was likely passing.",
    ours: false,
  },
  source_forbidden: {
    summary: "Google refused access to the item.",
    todo: "Reconnect Google, or ask the item's owner to share it with this account.",
    ours: false,
  },
  source_item_missing: {
    summary: "The item isn't in its app: it was deleted, or never existed.",
    todo: "Nothing to fix if it was deleted. Otherwise check the step points at the right item.",
    ours: false,
  },
  app_not_connected: {
    summary: "The app this step uses has no connection to run it through.",
    todo: "Connect the app on the Connections page.",
    ours: false,
  },
  suggestions_not_saved: {
    summary:
      "Docs made the edits but saved none of them as suggestions, so they may have changed the doc directly.",
    todo: "Open the doc and undo any edit you don't want. Nothing waits for a review.",
    ours: false,
  },
  bad_reference: {
    summary: "A step refers to a value no earlier step handed on.",
    todo: `Fix the reference in the workflow's editor, ${PUBLISH}.`,
    ours: false,
  },
  invalid_input: {
    summary: "A value the step sends doesn't fit what the app accepts.",
    todo: `Check the step's inputs in the workflow's editor, ${PUBLISH}.`,
    ours: false,
  },
  invalid_output: {
    summary: "The app answered in a shape Mycel didn't expect.",
    todo: "Nothing to change in the workflow: it's ours to fix.",
    ours: true,
  },
  not_available: {
    summary: "Mycel can't run this action yet.",
    todo: `Use an action Mycel runs instead, ${PUBLISH}.`,
    ours: false,
  },
  check_schema: {
    summary: "The model's answer didn't fit the schema.",
    todo: `Make the step's instructions match the schema check, or loosen the check, ${PUBLISH}.`,
    ours: false,
  },
  check_min_p: {
    summary: "The model wasn't sure enough of its answer.",
    todo: `Lower the confidence the check needs, or make the question clearer, ${PUBLISH}.`,
    ours: false,
  },
  check_required_fields: {
    summary: "A required field came back empty.",
    todo: `Tell the step where to find the field, or drop it from the required fields, ${PUBLISH}.`,
    ours: false,
  },
  model_off_schema: {
    summary: "The model's answer didn't fit the schema, three times.",
    todo: `Ask the step for fewer or simpler fields, ${PUBLISH}.`,
    ours: false,
  },
  model_gateway_error: {
    summary: "The model couldn't be reached, three times.",
    todo: "Usually passing. If it keeps happening, tell us.",
    ours: false,
  },
  model_refused: {
    summary: "The model refused to answer.",
    todo: `Reword the step's question or instructions, ${PUBLISH}.`,
    ours: false,
  },
  model_no_probabilities: {
    summary: "The classifier answered without saying how sure it was.",
    todo: "Usually passing. If it keeps happening, tell us.",
    ours: false,
  },
  model_unknown_label: {
    summary: "The classifier chose a label the step doesn't have.",
    todo: `Make the step's labels clearly distinct, ${PUBLISH}.`,
    ours: false,
  },
};

/**
 * What a failure's record says, as the Runs page shows it: its own message, but an
 * `internal_error` is ours to fix, whatever message a record from before that holds.
 */
export function failureMessage(code: string | null, message: string | null): string | null {
  return code === "internal_error" ? INTERNAL_ERROR_MESSAGE : message;
}

/** A failure in words, with what to do about it. */
export function explainFailure(code: string | null, message: string | null): FailureText {
  const known = code === null ? undefined : TEXTS[code];
  if (known === undefined) {
    return {
      summary: message ?? "The step failed.",
      detail: null,
      todo: "Check the step in the workflow's editor.",
      ours: false,
    };
  }
  const detail = known.ours ? null : message;
  return { ...known, detail: detail === known.summary ? null : detail };
}
