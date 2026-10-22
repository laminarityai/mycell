"use client";

// PROTOTYPE, throwaway (branch prototype/v1-views): the floating bar that flips a prototype
// route between its variants (`?variant=`) and any extra toggles (`?as=`, `?state=`). Only
// rendered under /prototype, which 404s in production (app/src/app/prototype/layout.tsx).
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";

export type SwitcherVariant = { key: string; name: string };
export type SwitcherToggle = { param: string; options: string[] };

export function PrototypeSwitcher({
  variants,
  toggles = [],
}: {
  variants: SwitcherVariant[];
  toggles?: SwitcherToggle[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("variant") ?? variants[0].key;
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );

  const set = useCallback(
    (param: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      next.set(param, value);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const step = useCallback(
    (by: number) => {
      const next = variants[(index + by + variants.length) % variants.length];
      set("variant", next.key);
    },
    [index, set, variants],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [step]);

  const variant = variants[index];
  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full bg-fuchsia-700 px-2 py-1.5 text-sm text-white shadow-2xl ring-2 ring-white">
      <button
        type="button"
        aria-label="Previous variant"
        className="rounded-full px-2 hover:bg-white/20"
        onClick={() => {
          step(-1);
        }}
      >
        ←
      </button>
      <span className="min-w-40 text-center font-medium">{`${variant.key} (${variant.name})`}</span>
      <button
        type="button"
        aria-label="Next variant"
        className="rounded-full px-2 hover:bg-white/20"
        onClick={() => {
          step(1);
        }}
      >
        →
      </button>
      {toggles.map((toggle) => (
        <span
          key={toggle.param}
          className="ml-1 flex items-center gap-1 border-l border-white/40 pl-2"
        >
          <span className="text-white/70">{toggle.param}</span>
          {toggle.options.map((option) => {
            const on = (params.get(toggle.param) ?? toggle.options[0]) === option;
            return (
              <button
                key={option}
                type="button"
                className={`rounded-full px-2 ${on ? "bg-white text-fuchsia-800" : "hover:bg-white/20"}`}
                onClick={() => {
                  set(toggle.param, option);
                }}
              >
                {option}
              </button>
            );
          })}
        </span>
      ))}
    </div>
  );
}
