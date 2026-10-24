// Google Tasks through the Nango proxy, for runs: the list-tasks, create-task and update-task
// actions, all on the person's default list, which is the first `tasklists.list` gives (the REST
// reference doesn't document `@default`). A task's title and notes come into the step that writes
// them, resolved from its input, and only the task's ID leaves it (ADR-0021). A task assigned to
// the person from Docs or Chat is left alone: changing one shows where it was assigned, so it
// reaches other people. Listing leaves them out (`showAssigned=false`) and updating refuses one.
import { z } from "zod";
import { proxyGet, proxyPatch, proxyPost } from "@/features/connections/server";
import { SourceRequestError } from "@/features/connections/types";
import { workflowNames } from "@/features/workflows/server";
import type { Ctx } from "@/lib/ctx";
import { RunStepError } from "./failures";
import type { ActionRunOf } from "./step-context";

const LISTS = "/tasks/v1/users/@me/lists";
// tasks.list's largest page.
const PAGE_SIZE = "100";
// Google's limit on a task's notes.
const NOTES_LIMIT = 8192;

export type NewTask = { title: string; notes?: string; due?: string };
export type TaskChanges = {
  taskId: string;
  title?: string;
  notes?: string;
  due?: string;
  done?: boolean;
};
export type ListedTask = { id: string; title: string; notes?: string; due?: string };

const taskLists = z.object({ items: z.array(z.object({ id: z.string() })).default([]) });
const task = z.object({
  id: z.string(),
  title: z.string().default(""),
  notes: z.string().optional(),
  due: z.string().optional(),
  deleted: z.boolean().optional(),
  assignmentInfo: z.unknown().optional(),
});
const tasksPage = z.object({
  items: z.array(task).default([]),
  nextPageToken: z.string().optional(),
});
const written = z.object({ id: z.string() });

/** The list-tasks action: the default list's open tasks, none assigned from Docs or Chat. */
export async function listTasks(
  ctx: Ctx,
  connectionId: string,
): Promise<{ taskCount: number; tasks: ListedTask[] }> {
  const list = await defaultList(ctx, connectionId);
  const found = await allTasks(ctx, connectionId, list, { showCompleted: "false" });
  const tasks = found
    .filter((item) => item.assignmentInfo === undefined)
    .map((item) => ({
      id: item.id,
      title: item.title,
      ...(item.notes === undefined ? {} : { notes: item.notes }),
      ...(item.due === undefined ? {} : { due: item.due.slice(0, 10) }),
    }));
  return { taskCount: tasks.length, tasks };
}

/**
 * The create-task action: adds the task to the default list, its notes ending with the run
 * step's marker (`mycel:<runId>/<stepId>`) and the workflow that added it. Tasks' insert isn't
 * idempotent, so it first looks for a task carrying the marker, from an earlier try whose answer
 * was lost (completed or hidden since, too), and records that task instead of adding another.
 */
export async function createTask(
  ctx: Ctx,
  connectionId: string,
  input: NewTask,
  marker: string,
  run: ActionRunOf,
): Promise<{ taskId: string }> {
  const list = await defaultList(ctx, connectionId);
  const markerLine = `mycel:${marker}`;
  const earlier = await allTasks(ctx, connectionId, list, {
    showCompleted: "true",
    showHidden: "true",
  });
  const mine = earlier.find((item) => item.notes?.split("\n").includes(markerLine) === true);
  if (mine !== undefined) return { taskId: mine.id };
  const by = await signature(ctx, run, "Added");
  const body = {
    title: input.title,
    notes: taskNotes(input.notes, [markerLine, by]),
    ...(input.due === undefined ? {} : { due: dueTimestamp(input.due) }),
  };
  const made = await tasks(proxyPost(ctx, connectionId, tasksPath(list), body, written));
  return { taskId: made.id };
}

/**
 * The update-task action: changes only what the input names, on a task of the default list that
 * no one assigned from Docs or Chat. New notes end with the workflow that wrote them. A patch
 * sets the same fields however often it's tried, so a retry needs no marker.
 */
export async function updateTask(
  ctx: Ctx,
  connectionId: string,
  input: TaskChanges,
  run: ActionRunOf,
): Promise<{ taskId: string }> {
  const list = await editableTask(ctx, connectionId, input.taskId);
  const body = {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.notes === undefined
      ? {}
      : { notes: taskNotes(input.notes, [await signature(ctx, run, "Updated")]) }),
    ...(input.due === undefined ? {} : { due: dueTimestamp(input.due) }),
    ...(input.done === undefined ? {} : { status: input.done ? "completed" : "needsAction" }),
  };
  const path = `${tasksPath(list)}/${encodeURIComponent(input.taskId)}`;
  const changed = await tasks(proxyPatch(ctx, connectionId, path, body, written));
  return { taskId: changed.id };
}

/**
 * The default list's ID, when the task is on it, not deleted, and not assigned from Docs or
 * Chat; otherwise the step fails, and isn't retried.
 */
export async function editableTask(
  ctx: Ctx,
  connectionId: string,
  taskId: string,
): Promise<string> {
  const list = await defaultList(ctx, connectionId);
  const path = `${tasksPath(list)}/${encodeURIComponent(taskId)}`;
  const found = await tasks(proxyGet(ctx, connectionId, path, task));
  if (found.deleted === true) throw missingTask();
  if (found.assignmentInfo !== undefined) {
    throw new RunStepError(
      "task_assigned",
      "The task was assigned from Docs or Chat, so Mycel leaves it alone.",
    );
  }
  return list;
}

/**
 * A task's notes as Mycel writes them: the step's own, then a blank line and Mycel's lines,
 * trimmed so the whole fits Google's limit. Mycel's lines always survive.
 */
export function taskNotes(notes: string | undefined, lines: string[]): string {
  const tail = lines.join("\n");
  if (notes === undefined || notes.trim() === "") return tail;
  const room = NOTES_LIMIT - tail.length - 2;
  return `${notes.trimEnd().slice(0, Math.max(0, room))}\n\n${tail}`;
}

/** The line naming the workflow that wrote a task, as `<verb> by the Mycel workflow “<name>”`. */
export async function signature(ctx: Ctx, run: Pick<ActionRunOf, "workflowId">, verb: string) {
  const name =
    run.workflowId === undefined
      ? undefined
      : (await workflowNames(ctx, [run.workflowId])).get(run.workflowId);
  return name === undefined
    ? `${verb} by a Mycel workflow`
    : `${verb} by the Mycel workflow “${name}”`;
}

// Tasks takes a due date as an RFC 3339 timestamp and keeps only its date.
function dueTimestamp(date: string): string {
  return `${date}T00:00:00.000Z`;
}

async function defaultList(ctx: Ctx, connectionId: string): Promise<string> {
  const path = `${LISTS}?maxResults=1`;
  const lists = await tasks(proxyGet(ctx, connectionId, path, taskLists));
  const first = lists.items.at(0);
  if (first === undefined) {
    throw new RunStepError("source_item_missing", "Tasks has no task list.");
  }
  return first.id;
}

// Every task of the list tasks.list gives with `shown`, page by page; never an assigned one.
async function allTasks(
  ctx: Ctx,
  connectionId: string,
  list: string,
  shown: Record<string, string>,
): Promise<z.infer<typeof task>[]> {
  const found: z.infer<typeof task>[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({
      ...shown,
      showAssigned: "false",
      maxResults: PAGE_SIZE,
      ...(pageToken === undefined ? {} : { pageToken }),
    });
    const path = `${tasksPath(list)}?${query.toString()}`;
    const page = await tasks(proxyGet(ctx, connectionId, path, tasksPage));
    found.push(...page.items);
    pageToken = page.nextPageToken;
  } while (pageToken !== undefined);
  return found;
}

function tasksPath(list: string): string {
  return `/tasks/v1/lists/${encodeURIComponent(list)}/tasks`;
}

function missingTask() {
  return new RunStepError("source_item_missing", "Tasks has no such task on the default list.");
}

/**
 * A Tasks request's answer, or the step's failure: no such task (404), a request Tasks refuses
 * (400) and a refusal of access (403) aren't retried, since trying again gets the same answer.
 * Messages name no task, title or note.
 */
async function tasks<T>(request: Promise<T | null>): Promise<T> {
  let result: T | null;
  try {
    result = await request;
  } catch (error) {
    if (error instanceof SourceRequestError && error.status === 403) {
      throw new RunStepError("source_forbidden", "Tasks refused access to the task list.");
    }
    if (error instanceof SourceRequestError && error.status === 400) {
      throw new RunStepError("invalid_input", "Tasks refused the task's fields.");
    }
    throw error;
  }
  if (result === null) throw missingTask();
  return result;
}
