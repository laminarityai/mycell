// `pnpm test:stop-stale`, the first step of `pnpm verify`: stops any Vitest processes a killed
// run left going in this checkout, so the next run starts on a test database nothing else is
// writing to. Another checkout's tests are never touched (scripts/stale-vitest.ts).
import { join } from "node:path";
import { stopStaleVitest } from "./stale-vitest.ts";

const stopped = await stopStaleVitest(join(import.meta.dirname, ".."));
if (stopped.length > 0) {
  console.log(
    `Stopped ${String(stopped.length)} Vitest process(es) left running in this checkout: ${stopped.join(", ")}`,
  );
}
