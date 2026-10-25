import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  ancestorsOf,
  staleVitestPids,
  stopStaleVitest,
  type RunningProcess,
} from "../stale-vitest";

const MAIN = "/repo/mycell";
const WORKTREE = "/repo/mycell/.claude/worktrees/w1";
const VITEST_MAIN = "node ./node_modules/.bin/../vitest/vitest.mjs run";
const VITEST_WORKER = (root: string) =>
  `/usr/bin/node --require ${root}/node_modules/.pnpm/vitest@5/node_modules/vitest/suppress-warnings.cjs ${root}/node_modules/.pnpm/vitest@5/node_modules/vitest/dist/workers/forks.js`;

function entry(pid: number, command: string, cwd: string | undefined, ppid = 1): RunningProcess {
  return { pid, ppid, command, cwd };
}

describe("staleVitestPids", () => {
  it("picks Vitest's main process and workers running in this checkout's app/", () => {
    const processes = [
      entry(10, VITEST_MAIN, `${WORKTREE}/app`),
      entry(11, VITEST_WORKER(WORKTREE), `${WORKTREE}/app`, 10),
    ];

    expect(staleVitestPids(processes, `${WORKTREE}/app`, new Set())).toEqual([10, 11]);
  });

  it("leaves another checkout's Vitest alone, the main checkout's whose path is a prefix too", () => {
    const processes = [
      entry(20, VITEST_MAIN, `${MAIN}/app`),
      entry(21, VITEST_WORKER(MAIN), `${MAIN}/app`, 20),
      entry(22, VITEST_MAIN, "/repo/mycell/.claude/worktrees/w2/app"),
      entry(23, VITEST_MAIN, `${WORKTREE}/app/src`),
    ];

    expect(staleVitestPids(processes, `${WORKTREE}/app`, new Set())).toEqual([]);
    expect(staleVitestPids(processes, `${MAIN}/app`, new Set())).toEqual([20, 21]);
  });

  it("leaves what isn't Vitest itself, and the processes it's told to protect", () => {
    const processes = [
      entry(30, "node /opt/homebrew/bin/pnpm vitest run", `${WORKTREE}/app`),
      entry(31, "/bin/zsh -c pnpm vitest run src/features", `${WORKTREE}/app`),
      entry(32, "node scripts/vitest-notes.ts", `${WORKTREE}/app`),
      entry(33, VITEST_MAIN, `${WORKTREE}/app`),
      entry(34, VITEST_MAIN, undefined),
    ];

    expect(staleVitestPids(processes, `${WORKTREE}/app`, new Set([33]))).toEqual([]);
  });
});

describe("ancestorsOf", () => {
  it("follows parents up from a pid, stopping at one it has seen", () => {
    const processes = [
      entry(1, "launchd", "/", 0),
      entry(5, "pnpm", "/", 1),
      entry(9, "node", "/", 5),
    ];

    expect([...ancestorsOf(processes, 9)]).toEqual([9, 5, 1]);
    expect([...ancestorsOf([entry(2, "a", "/", 3), entry(3, "b", "/", 2)], 2)]).toEqual([2, 3]);
  });
});

describe("stopStaleVitest", () => {
  const children: ChildProcess[] = [];
  const dirs: string[] = [];

  afterEach(() => {
    for (const child of children.splice(0)) child.kill("SIGKILL");
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  // A stand-in for Vitest: a script at node_modules/vitest/vitest.mjs that runs until stopped.
  function checkout(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "stale-vitest-")));
    dirs.push(dir);
    mkdirSync(join(dir, "node_modules", "vitest"), { recursive: true });
    writeFileSync(
      join(dir, "node_modules", "vitest", "vitest.mjs"),
      "setInterval(() => {}, 1000);",
    );
    return dir;
  }

  function startVitest(dir: string): ChildProcess {
    const child = spawn(process.execPath, [join(dir, "node_modules", "vitest", "vitest.mjs")], {
      cwd: dir,
      stdio: "ignore",
    });
    children.push(child);
    return child;
  }

  function exited(child: ChildProcess): Promise<NodeJS.Signals | null> {
    if (child.exitCode !== null || child.signalCode !== null) {
      return Promise.resolve(child.signalCode);
    }
    return new Promise((resolve) => {
      child.once("exit", (_code, signal) => {
        resolve(signal);
      });
    });
  }

  it("stops the Vitest running in this checkout and no other checkout's", async () => {
    const ours = checkout();
    const theirs = checkout();
    const stale = startVitest(ours);
    const other = startVitest(theirs);
    await sleep(300);

    const stopped = await stopStaleVitest(ours);

    expect(stopped).toEqual([stale.pid]);
    expect(await exited(stale)).toBe("SIGTERM");
    expect(other.exitCode).toBeNull();
    expect(other.signalCode).toBeNull();
  });

  it("stops nothing when nothing is left running", async () => {
    expect(await stopStaleVitest(checkout())).toEqual([]);
  });
});
