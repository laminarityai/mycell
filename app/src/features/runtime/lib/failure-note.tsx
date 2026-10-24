// A failure on a run's page, a step's or the run's own: what went wrong, what to do about it,
// and its code, with an internal error marked as ours to fix.
import { Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { explainFailure } from "../failure-texts";

export function FailureNote({
  code,
  message,
  className,
}: {
  code: string | null;
  message: string | null;
  className?: string;
}) {
  const text = explainFailure(code, message);
  return (
    <div
      role="note"
      aria-label="What went wrong"
      className={cn(
        "flex flex-col gap-1 rounded-md border p-3 text-sm",
        text.ours ? "bg-muted/50" : "border-destructive/30 bg-destructive/5",
        className,
      )}
    >
      <p className="flex flex-wrap items-center gap-2 font-medium">
        {text.summary}
        {text.ours ? (
          <Badge variant="outline" className="gap-1">
            <Wrench aria-hidden /> Ours to fix
          </Badge>
        ) : null}
      </p>
      {text.detail === null ? null : (
        <p className="wrap-anywhere text-muted-foreground">{text.detail}</p>
      )}
      <p>
        <span className="font-medium">What to do: </span>
        {text.todo}
      </p>
      {code === null ? null : <p className="font-mono text-xs text-muted-foreground">{code}</p>}
    </div>
  );
}
