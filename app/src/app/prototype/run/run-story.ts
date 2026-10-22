// PROTOTYPE, throwaway: variant C's "what happened", a run told in a few plain sentences. The
// redacted telling says what each step did, never what it found.
import type { RunView } from "./run-view";

export type Story = { headline: string; sentences: string[]; next: string };

export function storyOf(view: RunView): Story {
  const { run, full } = view;
  const message = full ? `"${run.subject}" from ${run.from}` : `a message in ${view.inbox}`;
  switch (run.key) {
    case "check-failed":
      return {
        headline: "It couldn't find an order number, so it stopped.",
        sentences: [
          `Mycel read ${message} and ${full ? "decided it was an order (96% sure)" : "took the Order path"}.`,
          full
            ? "It pulled out the customer (Acme Corp) and the ship date, but left the order number empty."
            : "It pulled out the order's details, but one of them came back empty.",
          "The step's schema check and required-fields check both failed on order_number, so no row was added to the follow-up sheet.",
          "This is the third failure in a row, so the workflow paused itself.",
        ],
        next: "Change the extract step or its checks, publish, then resume the workflow.",
      };
    case "access-refused":
      return {
        headline: "Google wouldn't let it read the price sheet.",
        sentences: [
          `Mycel read ${message} and ${full ? "saw a quote request for 400 kraft mailers" : "took the Quote request path"}.`,
          "When it went to look up the price, Google refused access to the sheet. No draft was written.",
        ],
        next: "Reconnect Google, or ask the sheet's owner to share it, then retry.",
      };
    case "internal-error":
      return {
        headline: "Something broke on our side.",
        sentences: [
          `Mycel read ${message}, took the Quote request path and read the price sheet.`,
          "Writing the reply failed four times with an internal error, and the run stopped.",
          "It's ours to fix: nothing in the workflow is wrong.",
        ],
        next: "Retry later. If it keeps happening, tell us the run ID.",
      };
    default:
      return {
        headline: full ? "It drafted a reply and it's waiting for you." : "It drafted a reply.",
        sentences: [
          `Mycel read ${message} and ${full ? "saw a quote request for 400 kraft mailers" : "took the Quote request path"}.`,
          full
            ? "It read the price sheet and wrote a draft quoting $0.38 each."
            : "It read the price sheet and wrote a draft.",
          "The draft waits in Reviews until someone sends it.",
        ],
        next: full ? "Open the review to send or change the draft." : "Nothing for you to do.",
      };
  }
}
