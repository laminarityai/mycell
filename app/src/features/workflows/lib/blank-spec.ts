// Where a new workflow's editor starts: the settings filled in, no steps yet.

export function blankSpec(): object {
  return {
    specVersion: 1,
    id: "",
    credentials: "member",
    trigger: { type: "gmail.message_received", labelIds: ["INBOX"] },
    steps: [],
    autonomy: { rung: 3 },
  };
}
