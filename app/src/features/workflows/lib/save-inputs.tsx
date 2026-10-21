// What a save of a working spec sends besides its name, for both editors: the workflow (none
// for a new one), the revision it was opened at (a save over a newer one is refused), and the
// spec as text.
export function SaveInputs({
  workflowId,
  revision,
  specText,
}: {
  workflowId?: string;
  revision?: number;
  specText: string;
}) {
  return (
    <>
      {workflowId === undefined ? null : (
        <input type="hidden" name="workflowId" value={workflowId} />
      )}
      {revision === undefined ? null : <input type="hidden" name="baseRevision" value={revision} />}
      <input type="hidden" name="spec" value={specText} />
    </>
  );
}
