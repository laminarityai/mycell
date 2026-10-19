import { Button } from "@/components/ui/button";
import { greet } from "@/features/example/server";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-16">
      <h1 className="text-3xl font-semibold tracking-tight">Mycel</h1>
      <p className="text-muted-foreground">{greet("world")}</p>
      <Button disabled>Coming soon</Button>
    </main>
  );
}
