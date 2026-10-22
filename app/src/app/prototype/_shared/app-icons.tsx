// PROTOTYPE, throwaway: small product-coloured marks for the Google apps a workflow uses, so a
// list can show "Gmail, Sheets" as icons. Simple glyphs in each app's colour family, not
// Google's artwork. `AppMark` adds the app's name on hover.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type AppKey = "gmail" | "sheets" | "calendar" | "docs" | "tasks" | "drive";

export const APP_NAMES: Record<AppKey, string> = {
  gmail: "Gmail",
  sheets: "Google Sheets",
  calendar: "Google Calendar",
  docs: "Google Docs",
  tasks: "Google Tasks",
  drive: "Google Drive",
};

const BY_LABEL: Record<string, AppKey | undefined> = {
  gmail: "gmail",
  sheets: "sheets",
  calendar: "calendar",
  docs: "docs",
  tasks: "tasks",
  drive: "drive",
};

/** "Sheets" (as fixtures name apps) → "sheets"; undefined for an app with no mark. */
export const appKey = (label: string): AppKey | undefined => BY_LABEL[label.toLowerCase()];

const RED = "#EA4335";
const GREEN = "#1E8E3E";
const BLUE = "#1A73E8";
const YELLOW = "#FBBC04";
const DRIVE_GREEN = "#34A853";
const DRIVE_BLUE = "#4285F4";

const GLYPHS: Record<AppKey, ReactNode> = {
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
  sheets: (
    <>
      <path
        d="M6.5 2.5h8L19 7v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V4a1.5 1.5 0 0 1 1.5-1.5Z"
        fill={GREEN}
      />
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
      <text
        x="12"
        y="18.2"
        textAnchor="middle"
        fontSize="8.5"
        fontWeight="700"
        fill={BLUE}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        22
      </text>
    </>
  ),
  docs: (
    <>
      <path
        d="M6.5 2.5h8L19 7v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V4a1.5 1.5 0 0 1 1.5-1.5Z"
        fill={BLUE}
      />
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
  drive: (
    <g strokeWidth="0.9" strokeLinejoin="round">
      <path d="M12 2.5 12 10 8.1 16.7 1.5 20.5Z" fill={DRIVE_GREEN} stroke={DRIVE_GREEN} />
      <path d="M12 2.5 22.5 20.5 15.9 16.7 12 10Z" fill={YELLOW} stroke={YELLOW} />
      <path d="M1.5 20.5 8.1 16.7h7.8l6.6 3.8Z" fill={DRIVE_BLUE} stroke={DRIVE_BLUE} />
    </g>
  ),
};

/** One app's mark, `size` pixels square. Decorative unless given a `title`. */
export function AppIcon({
  app,
  size = 16,
  title,
  className,
}: {
  app: AppKey;
  size?: number;
  title?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      role={title === undefined ? undefined : "img"}
      aria-hidden={title === undefined ? true : undefined}
      aria-label={title}
    >
      {GLYPHS[app]}
    </svg>
  );
}

/** An app's mark in a small tile, its name showing on hover (and read out by screen readers). */
export function AppMark({ app, size = 16, label }: { app: AppKey; size?: number; label?: string }) {
  const name = label ?? APP_NAMES[app];
  return (
    <span
      role="img"
      aria-label={name}
      className="group/app relative inline-flex items-center justify-center rounded-md border bg-background p-1"
    >
      <AppIcon app={app} size={size} />
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs whitespace-nowrap text-background opacity-0 shadow-sm transition-opacity group-hover/app:opacity-100"
      >
        {name}
      </span>
    </span>
  );
}
