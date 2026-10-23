// The apps a workflow uses, as small marks: wherever a workflow, a review or a pause names an
// app, it shows its mark. Each Google app has its own, a simple glyph in that product's colours
// (never Google's artwork); any other app, such as Microsoft 365, shows a generic one. Apps are
// named as the UI and the catalog name them ("Gmail", "Sheets"), and every mark carries its name
// for screen readers and on hover.
import { AppWindow, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { GOOGLE_APP_NAMES, GOOGLE_APPS, type GoogleApp } from "@/lib/google";
import { cn } from "@/lib/utils";

/** The Google app an app's name marks, or null for any other app, which has the generic mark. */
export function appMarkOf(app: string): GoogleApp | null {
  return GOOGLE_APPS.find((key) => GOOGLE_APP_NAMES[key] === app) ?? null;
}

const RED = "#EA4335";
const GREEN = "#1E8E3E";
const BLUE = "#1A73E8";
const YELLOW = "#FBBC04";
const DRIVE_GREEN = "#34A853";
const DRIVE_BLUE = "#4285F4";
// A page with its corner folded, as Sheets and Docs draw a file.
const PAGE =
  "M6.5 2.5h8L19 7v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V4a1.5 1.5 0 0 1 1.5-1.5Z";

const GLYPHS: Record<GoogleApp, ReactNode> = {
  gmail: (
    <>
      <rect
        x="2.5"
        y="5"
        width="19"
        height="14"
        rx="2.5"
        fill="#FDECEA"
        stroke={RED}
        strokeWidth="1.6"
      />
      <path
        d="M3.5 7 12 13.2 20.5 7"
        fill="none"
        stroke={RED}
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </>
  ),
  drive: (
    <g strokeWidth="0.9" strokeLinejoin="round">
      <path d="M12 2.5 12 10 8.1 16.7 1.5 20.5Z" fill={DRIVE_GREEN} stroke={DRIVE_GREEN} />
      <path d="M12 2.5 22.5 20.5 15.9 16.7 12 10Z" fill={YELLOW} stroke={YELLOW} />
      <path d="M1.5 20.5 8.1 16.7h7.8l6.6 3.8Z" fill={DRIVE_BLUE} stroke={DRIVE_BLUE} />
    </g>
  ),
  sheets: (
    <>
      <path d={PAGE} fill={GREEN} />
      <path d="M14.5 2.5V7H19" fill="#81C995" />
      <rect x="7.75" y="10.5" width="8.5" height="7.5" rx="0.5" fill="#fff" />
      <path d="M7.75 13h8.5M7.75 15.5h8.5M11 10.5V18" stroke={GREEN} strokeWidth="1" />
    </>
  ),
  calendar: (
    <>
      <rect
        x="3"
        y="4"
        width="18"
        height="17"
        rx="2.5"
        fill="#fff"
        stroke={BLUE}
        strokeWidth="1.6"
      />
      <path d="M3 8.5V6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v2Z" fill={BLUE} />
      <path d="M8 2.5v3M16 2.5v3" stroke={BLUE} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7.5 12.5h3v3h-3zM13.5 12.5h3v3h-3z" fill={BLUE} />
    </>
  ),
  docs: (
    <>
      <path d={PAGE} fill={BLUE} />
      <path d="M14.5 2.5V7H19" fill="#8AB4F8" />
      <path d="M8 11h8M8 13.75h8M8 16.5h5" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  tasks: (
    <>
      <circle cx="12" cy="12" r="9.5" fill={BLUE} />
      <path
        d="m7.6 12.3 3 3 5.8-6.2"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="18.6" cy="5.4" r="2.4" fill={YELLOW} stroke="#fff" strokeWidth="1" />
    </>
  ),
};

/** An app's mark alone, `size` pixels square, for beside its name: decorative, so unnamed. */
export function AppIcon({
  app,
  size = 16,
  className,
}: {
  app: string;
  size?: number;
  className?: string;
}) {
  const google = appMarkOf(app);
  if (google === null) {
    return (
      <AppWindow
        aria-hidden
        width={size}
        height={size}
        className={cn("shrink-0 text-muted-foreground", className)}
      />
    );
  }
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
    >
      {GLYPHS[google]}
    </svg>
  );
}

/** An app's mark in a small tile, named for screen readers and, on hover, beside it. */
export function AppMark({ app, size = 16 }: { app: string; size?: number }) {
  return (
    <HoverNamed name={app} className="p-1">
      <AppIcon app={app} size={size} />
    </HoverNamed>
  );
}

/**
 * The apps something uses, as a named group of marks in their order; an org switch's shared
 * inbox, its address, follows them.
 */
export function AppMarks({
  apps,
  sharedInbox = null,
  label = "Apps it uses",
}: {
  apps: readonly string[];
  sharedInbox?: string | null;
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      {apps.map((app) => (
        <AppMark key={app} app={app} />
      ))}
      {sharedInbox === null ? null : (
        <HoverNamed
          name={`Shared inbox ${sharedInbox}`}
          className="ml-1 gap-1.5 py-1 pr-2 pl-1.5 text-xs text-muted-foreground"
        >
          <Inbox aria-hidden className="size-3.5" />
          {sharedInbox.split("@")[0]}
        </HoverNamed>
      )}
    </div>
  );
}

// A tile named `name` for screen readers, which shows the name above it on hover.
function HoverNamed({
  name,
  className,
  children,
}: {
  name: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        "group/app relative inline-flex items-center justify-center rounded-md border bg-background",
        className,
      )}
    >
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs whitespace-nowrap text-background opacity-0 shadow-sm transition-opacity group-hover/app:opacity-100"
      >
        {name}
      </span>
    </span>
  );
}
