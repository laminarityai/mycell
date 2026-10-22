// PROTOTYPE, throwaway: builds a prototype route's page. It reads `?variant=` (and any toggles,
// such as `?as=admin|member`), renders that variant, and floats the switcher over it. Each
// variant owns its whole layout, header included (`PrototypeHeader`).
import { Suspense, type ComponentType } from "react";
import { PrototypeSwitcher, type SwitcherToggle } from "@/components/prototype-switcher";

/** The current value of each toggle, by param ("as" → "member"), defaulting to its first option. */
export type VariantProps = { params: Record<string, string> };

export type Variant = { key: string; name: string; Component: ComponentType<VariantProps> };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function prototypePage({
  variants,
  toggles = [],
}: {
  variants: Variant[];
  toggles?: SwitcherToggle[];
}) {
  return function PrototypeRoute({ searchParams }: { searchParams: SearchParams }) {
    return (
      <Suspense fallback={null}>
        <Body searchParams={searchParams} variants={variants} toggles={toggles} />
      </Suspense>
    );
  };
}

async function Body({
  searchParams,
  variants,
  toggles,
}: {
  searchParams: SearchParams;
  variants: Variant[];
  toggles: SwitcherToggle[];
}) {
  const raw = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const variant = variants.find((v) => v.key === one(raw.variant)) ?? variants[0];
  const params = Object.fromEntries(
    toggles.map((t) => [t.param, one(raw[t.param]) ?? t.options[0]]),
  );
  const { Component } = variant;
  return (
    <>
      <Component params={params} />
      <div className="h-20" />
      <PrototypeSwitcher
        variants={variants.map(({ key, name }) => ({ key, name }))}
        toggles={toggles}
      />
    </>
  );
}
