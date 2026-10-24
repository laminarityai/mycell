"use client";

// "What I've told Mycel"'s filter: words, and "Include older notes". Both live in the address
// (`?q=…&older=1`), so the page reads them like any other request and a filtered view can be
// reloaded or shared with oneself; typing waits a moment before asking again.
import { Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

const TYPING_MS = 250;

export function ToldFilter({ words, includeOlder }: { words: string; includeOlder: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [text, setText] = useState(words);
  const typing = useRef<ReturnType<typeof setTimeout>>(undefined);

  const go = (next: { words: string; includeOlder: boolean }) => {
    const params = new URLSearchParams();
    if (next.words.trim() !== "") params.set("q", next.words.trim());
    if (next.includeOlder) params.set("older", "1");
    const query = params.toString();
    router.replace(query === "" ? pathname : `${pathname}?${query}`, { scroll: false });
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <label htmlFor="told-filter" className="sr-only">
          Filter what you&apos;ve told Mycel
        </label>
        <Input
          id="told-filter"
          type="search"
          value={text}
          placeholder="Filter by name or words"
          className="w-72 pl-8"
          onChange={(event) => {
            const value = event.target.value;
            setText(value);
            clearTimeout(typing.current);
            typing.current = setTimeout(() => {
              go({ words: value, includeOlder });
            }, TYPING_MS);
          }}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={includeOlder}
          onCheckedChange={(checked) => {
            clearTimeout(typing.current);
            go({ words: text, includeOlder: checked });
          }}
        />
        Include older notes
      </label>
    </div>
  );
}
