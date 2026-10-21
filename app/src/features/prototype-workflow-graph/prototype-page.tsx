"use client";

// PROTOTYPE, never merge. M12's question: what should the workflow graph beside the builder chat
// look like? Three layouts over the same mock data, switched by `?variant=A|B|C`.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { PrototypeToolbar } from "./parts";
import { PrototypeProvider } from "./state";
import { VariantA, VariantB, VariantC } from "./variants";

const VARIANTS = [
  { id: "A", name: "Split + side panel", Component: VariantA },
  { id: "B", name: "Graph first", Component: VariantB },
  { id: "C", name: "Path columns", Component: VariantC },
] as const;

export function PrototypePage() {
  const params = useSearchParams();
  const index = Math.max(
    0,
    VARIANTS.findIndex((v) => v.id === (params.get("variant") ?? "A").toUpperCase()),
  );
  const variant = VARIANTS[index];
  return (
    <PrototypeProvider>
      <div className="flex h-dvh flex-col overflow-hidden">
        <PrototypeToolbar />
        <variant.Component />
      </div>
      <VariantSwitcher index={index} />
    </PrototypeProvider>
  );
}

function VariantSwitcher({ index }: { index: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const go = (by: number) => {
    const next = VARIANTS[(index + by + VARIANTS.length) % VARIANTS.length];
    const query = new URLSearchParams(params.toString());
    query.set("variant", next.id);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      go(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  });

  if (process.env.NODE_ENV === "production") return null;
  const variant = VARIANTS[index];
  return (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-neutral-900 px-1.5 py-1 text-sm text-white shadow-xl">
      <button
        type="button"
        aria-label="Previous variant"
        className="rounded-full p-1.5 hover:bg-white/15"
        onClick={() => {
          go(-1);
        }}
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="px-2 whitespace-nowrap">
        <span className="font-semibold">{variant.id}</span> · {variant.name}
      </span>
      <button
        type="button"
        aria-label="Next variant"
        className="rounded-full p-1.5 hover:bg-white/15"
        onClick={() => {
          go(1);
        }}
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
