"use client";

// The app shell's frame: the sidebar on the left (behind a menu button on a narrow screen), a
// full-width banner slot above the page, and the page's title and content. It takes the
// sidebar's contents as a slot, so `AppShell` can stream them in while the page draws.
import { Menu, X } from "lucide-react";
import { createContext, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Closes the narrow screen's menu; a sidebar link calls it as it's followed. */
export const ShellMenuContext = createContext<() => void>(() => undefined);

/**
 * `narrow` is a reading column, `wide` a wider one for tables, and `full` fills the window
 * below a slim title bar (the builder chat).
 */
export type ShellWidth = "narrow" | "wide" | "full";

export function ShellFrame({
  sidebar,
  banner,
  title,
  actions,
  width = "narrow",
  children,
}: {
  sidebar: ReactNode;
  /** Above the page, the whole width of the content column. M8's out-of-credits banner. */
  banner?: ReactNode;
  title: string;
  /** Beside the title, right-aligned. */
  actions?: ReactNode;
  width?: ShellWidth;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
  };
  // Escape closes the menu, wherever focus is.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const full = width === "full";
  return (
    <ShellMenuContext value={close}>
      <div className={cn("flex w-full flex-1", full ? "h-dvh" : "min-h-dvh")}>
        {open ? (
          // The dimmed page behind the menu; tapping it closes the menu, as the X button does.
          <Button
            variant="ghost"
            aria-hidden
            tabIndex={-1}
            onClick={close}
            className="fixed inset-0 z-30 h-auto rounded-none bg-black/20 hover:bg-black/20 md:hidden"
          />
        ) : null}
        <aside
          id="app-sidebar"
          className={cn(
            "fixed inset-y-0 left-0 z-40 w-64 flex-col border-r bg-background",
            "md:sticky md:top-0 md:z-auto md:flex md:h-dvh md:w-60 md:shrink-0 md:bg-muted/40",
            open ? "flex" : "hidden",
          )}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close menu"
            onClick={close}
            className="absolute top-4 right-2 md:hidden"
          >
            <X />
          </Button>
          {sidebar}
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background px-4 py-2 md:hidden">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Menu"
              aria-expanded={open}
              aria-controls="app-sidebar"
              onClick={() => {
                setOpen(true);
              }}
            >
              <Menu />
            </Button>
            <span className="font-semibold tracking-tight">Mycel</span>
          </div>
          {banner}
          <main
            className={cn(
              "flex w-full flex-col",
              width === "narrow" && "max-w-3xl gap-6 px-4 py-6 md:px-8",
              width === "wide" && "max-w-5xl gap-6 px-4 py-6 md:px-8",
              full && "min-h-0 flex-1",
            )}
          >
            <header
              className={cn(
                "flex flex-wrap items-center justify-between gap-4",
                full && "border-b px-4 py-3",
              )}
            >
              <h1 className={cn("font-semibold tracking-tight", full ? "text-lg" : "text-2xl")}>
                {title}
              </h1>
              {actions}
            </header>
            {children}
          </main>
        </div>
      </div>
    </ShellMenuContext>
  );
}
