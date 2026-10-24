// Finding and stopping the Vitest processes a killed `pnpm verify` left running in this
// checkout, which would otherwise keep writing to its test database while the next run starts.
// A process is this checkout's when it's Vitest itself (its main process or a worker) and its
// working directory is exactly this checkout's app/: other worktrees run their own tests at the
// same time, and the main checkout's path is a prefix of every worktree's.
import { execFileSync, spawnSync } from "node:child_process";
import { readlinkSync, realpathSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

export interface RunningProcess {
  pid: number;
  ppid: number;
  command: string;
  cwd: string | undefined;
}

// Vitest's main process (`…/vitest/vitest.mjs`) and its workers (`…/vitest/dist/workers/…`).
const VITEST_COMMAND = /[\\/]vitest[\\/](?:vitest\.mjs|dist[\\/])/;
const STOP_WAIT_MS = 3000;

/** The pids among `processes` that are Vitest running in `appDir`, leaving `protectedPids` out. */
export function staleVitestPids(
  processes: readonly RunningProcess[],
  appDir: string,
  protectedPids: ReadonlySet<number>,
): number[] {
  return processes
    .filter(
      (entry) =>
        VITEST_COMMAND.test(entry.command) && entry.cwd === appDir && !protectedPids.has(entry.pid),
    )
    .map((entry) => entry.pid);
}

/** A pid and every process above it, so a run never stops the command that started it. */
export function ancestorsOf(processes: readonly RunningProcess[], pid: number): Set<number> {
  const parents = new Map(processes.map((entry) => [entry.pid, entry.ppid]));
  const ancestors = new Set<number>();
  for (let next: number | undefined = pid; next !== undefined && next > 0;) {
    if (ancestors.has(next)) break;
    ancestors.add(next);
    next = parents.get(next);
  }
  return ancestors;
}

/** Stops this checkout's Vitest processes (SIGTERM, then SIGKILL) and returns their pids. */
export async function stopStaleVitest(appDir: string): Promise<number[]> {
  if (process.platform !== "darwin" && process.platform !== "linux") return [];
  const listed = listProcesses();
  const vitest = listed.filter((entry) => VITEST_COMMAND.test(entry.command));
  const cwds = workingDirectories(vitest.map((entry) => entry.pid));
  const processes = vitest.map((entry) => ({ ...entry, cwd: cwds.get(entry.pid) }));
  const pids = staleVitestPids(processes, realpathSync(appDir), ancestorsOf(listed, process.pid));
  for (const pid of pids) signal(pid, "SIGTERM");
  const deadline = Date.now() + STOP_WAIT_MS;
  while (pids.some(isRunning) && Date.now() < deadline) await sleep(100);
  for (const pid of pids.filter(isRunning)) signal(pid, "SIGKILL");
  return pids;
}

function listProcesses(): RunningProcess[] {
  const output = execFileSync("ps", ["-A", "-ww", "-o", "pid=,ppid=,command="], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match === null) return [];
    return [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3], cwd: undefined }];
  });
}

// Linux has each process's working directory in /proc; macOS answers through lsof.
function workingDirectories(pids: number[]): Map<number, string> {
  const cwds = new Map<number, string>();
  if (pids.length === 0) return cwds;
  if (process.platform === "linux") {
    for (const pid of pids) {
      try {
        cwds.set(pid, readlinkSync(`/proc/${String(pid)}/cwd`));
      } catch {
        // Gone already, or not ours to read.
      }
    }
    return cwds;
  }
  // lsof exits 1 when any pid has gone, and still lists the rest.
  const { stdout } = spawnSync("lsof", ["-a", "-d", "cwd", "-Fn", "-p", pids.join(",")], {
    encoding: "utf8",
  });
  let pid: number | undefined;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid !== undefined) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name);
  } catch {
    // It ended on its own meanwhile.
  }
}
