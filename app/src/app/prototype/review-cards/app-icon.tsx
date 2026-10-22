// PROTOTYPE, throwaway: the small app mark a review row carries (Gmail, Calendar, Docs, Tasks),
// in the app's neutral palette: an icon, not Google's branding.
import { CalendarDays, FileText, ListChecks, Mail } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = { gmail: Mail, calendar: CalendarDays, docs: FileText, tasks: ListChecks };

export function AppIcon({ app, className }: { app: keyof typeof ICONS; className?: string }) {
  const Icon = ICONS[app];
  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted/60 text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-4" aria-hidden />
    </span>
  );
}
