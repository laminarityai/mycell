// A stand-in for Inngest's step tools in tests, which never run Inngest: a server function a job
// calls takes it as the job's RunStep and RunSleep.
import type { RunSleep, RunStep } from "@/lib/inngest";

/**
 * A step runner like Inngest's: it records each step ID it's asked for and memoizes results by
 * ID, so running again replays finished steps instead of re-running them. `crashAt` makes it
 * throw before running that step, as an invocation that dies part-way would. Its `sleep` is
 * Inngest's `step.sleep` the same way: it records each wait in `ids` and `waits` rather than
 * waiting, and a replayed wait, finished already, is neither waited nor recorded in `waits` again.
 */
export function recordingStepRunner() {
  const ids: string[] = [];
  const results = new Map<string, unknown>();
  const slept = new Set<string>();
  const waits: { id: string; ms: number }[] = [];
  let crashAt: string | undefined;
  const runStep: RunStep = async (id, run) => {
    ids.push(id);
    if (results.has(id)) return results.get(id) as Awaited<ReturnType<typeof run>>;
    if (id === crashAt) {
      crashAt = undefined;
      throw new Error(`crashed before ${id}`);
    }
    const result = await run();
    results.set(id, JSON.parse(JSON.stringify(result)) as unknown);
    return result;
  };
  const sleep: RunSleep = (id, ms) => {
    ids.push(id);
    if (!slept.has(id)) {
      slept.add(id);
      waits.push({ id, ms });
    }
    return Promise.resolve();
  };
  return {
    runStep,
    sleep,
    ids,
    waits,
    /** What the step state holds: each finished step's result, by step ID. */
    results: () => Object.fromEntries(results),
    crashAt: (id: string) => {
      crashAt = id;
    },
    /** Holds `result` for step `id` as if an earlier invocation had finished it. */
    memoize: (id: string, result: unknown) => {
      results.set(id, result);
    },
  };
}
