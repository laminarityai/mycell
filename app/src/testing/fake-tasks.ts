// A fake Google Tasks, served through the fake Nango's proxy on the Tasks host: the account's task
// lists, answering the Tasks API v1 calls Mycel makes (tasklists.list, and tasks.list, get,
// insert and patch) in the shapes Google documents, from tasks a test seeds
// (https://developers.google.com/workspace/tasks/reference/rest). Like Google, tasks.list leaves
// out deleted and hidden tasks, and tasks assigned from Docs or Chat, unless asked for them, and
// leaves `items` out of an empty page; `due` keeps only its date; insert refuses an assigned task;
// a task assigned from Docs can't have notes. A patch to an assigned task is made, as the API has
// allowed since July 2024, and logged, so a test proves Mycel never sends one.
import { randomBytes } from "node:crypto";
import { HttpResponse } from "msw";
import { z } from "zod";

/** Where an assigned task was assigned from, as `assignmentInfo.surfaceType` names it. */
export type FakeAssignedFrom = "DOCUMENT" | "SPACE";

/** A task to seed on a list (the default list unless one is named). */
export type FakeTaskInput = {
  title: string;
  notes?: string;
  // A date, `YYYY-MM-DD`.
  due?: string;
  status?: "needsAction" | "completed";
  // Completed in Google's own apps, which hides a task.
  hidden?: boolean;
  deleted?: boolean;
  assignedFrom?: FakeAssignedFrom;
  list?: string;
};

/** A Task resource, with the fields Google returns. */
export type TaskResource = {
  kind: "tasks#task";
  id: string;
  etag: string;
  title: string;
  updated: string;
  selfLink: string;
  position: string;
  notes?: string;
  status: "needsAction" | "completed";
  due?: string;
  completed?: string;
  deleted?: boolean;
  hidden?: boolean;
  webViewLink: string;
  assignmentInfo?: { linkToTask: string; surfaceType: FakeAssignedFrom };
};

/** One write Mycel asked for, as the request named it, whether or not its answer was lost. */
export type FakeTaskWrite = {
  method: "POST" | "PATCH";
  list: string;
  task?: string;
  body: unknown;
};

type TaskList = { id: string; title: string; tasks: TaskResource[] };

const HOST = "https://tasks.googleapis.com";
// tasks.list's documented default and largest page.
const PAGE = { default: 20, max: 100 };
// Query parameters Mycel doesn't send: the fake fails the test rather than ignore one.
const UNSUPPORTED = ["completedMin", "completedMax", "dueMin", "dueMax", "updatedMin"];

const writable = z.object({
  title: z.string().max(1024).optional(),
  notes: z.string().max(8192).optional(),
  status: z.enum(["needsAction", "completed"]).optional(),
  due: z.iso.datetime({ offset: true }).optional(),
  assignmentInfo: z.unknown().optional(),
});

export class FakeTasks {
  private lists: TaskList[] = [];
  private nextPosition = 0;
  private answersToLose = 0;
  /** Every insert and patch asked for, in order. */
  readonly writes: FakeTaskWrite[] = [];
  /** Every tasks.list request's query parameters, oldest first. */
  readonly listRequests: URLSearchParams[] = [];

  constructor() {
    this.addList("My Tasks");
  }

  /** The list Google's apps add to: the first one. */
  get defaultListId(): string {
    return this.lists[0]?.id ?? "";
  }

  /** Adds a list after the others, and returns its ID. */
  addList(title: string): string {
    const id = randomId();
    this.lists.push({ id, title, tasks: [] });
    return id;
  }

  /** Seeds a task, as the person (or someone assigning it from Docs or Chat) made it. */
  add(input: FakeTaskInput): TaskResource {
    const list = this.list(input.list ?? this.defaultListId);
    if (list === undefined) throw new Error(`No task list ${String(input.list)}`);
    const task = this.make(list.id, {
      title: input.title,
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      status: input.status ?? "needsAction",
      ...(input.due === undefined ? {} : { due: `${input.due}T00:00:00.000Z` }),
    });
    if (input.hidden === true) task.hidden = true;
    if (input.deleted === true) task.deleted = true;
    if (input.assignedFrom !== undefined) {
      task.assignmentInfo = {
        linkToTask: `${HOST}/assigned/${task.id}`,
        surfaceType: input.assignedFrom,
      };
    }
    list.tasks.push(task);
    return task;
  }

  /** The list's tasks as they stand, deleted ones included. */
  tasks(listId = this.defaultListId): TaskResource[] {
    const list = this.list(listId);
    if (list === undefined) throw new Error(`No task list ${listId}`);
    return list.tasks.map((task) => structuredClone(task));
  }

  /** The person ticks the task off in Google's own app, which also hides it. */
  completeInApp(taskId: string): void {
    const task = this.lists.flatMap((list) => list.tasks).find((t) => t.id === taskId);
    if (task === undefined) throw new Error(`No task ${taskId}`);
    task.status = "completed";
    task.completed = new Date().toISOString();
    task.hidden = true;
  }

  /** The next insert is made, but answered 503, as when its answer is lost on the way back. */
  loseNextAnswer(): void {
    this.answersToLose += 1;
  }

  /** tasklists.list, tasks.list and tasks.get. */
  respond(path: string, params: URLSearchParams): Response {
    if (path === "/tasks/v1/users/@me/lists") {
      const items = this.lists.map(({ id, title }) => ({
        kind: "tasks#taskList",
        id,
        etag: `"${id}"`,
        title,
        updated: new Date().toISOString(),
        selfLink: `${HOST}/tasks/v1/users/@me/lists/${id}`,
      }));
      return this.page("tasks#taskLists", items, params, { default: 1000, max: 1000 });
    }
    const target = parsePath(path);
    if (target === undefined) return tasksError(404, "notFound", "Not Found");
    const list = this.list(target.list);
    if (list === undefined) return tasksError(404, "notFound", "Task list not found.");
    if (target.task !== undefined) {
      const task = list.tasks.find((t) => t.id === target.task);
      if (task === undefined) return tasksError(404, "notFound", "Task not found.");
      return HttpResponse.json(task);
    }
    this.listRequests.push(new URLSearchParams(params));
    for (const name of UNSUPPORTED) {
      if (params.has(name)) throw new Error(`The fake Tasks doesn't filter by ${name}`);
    }
    const shown = (name: string, byDefault: boolean) =>
      params.has(name) ? params.get(name) === "true" : byDefault;
    const items = list.tasks.filter(
      (task) =>
        (shown("showDeleted", false) || task.deleted !== true) &&
        (shown("showHidden", false) || task.hidden !== true) &&
        (shown("showCompleted", true) || task.status !== "completed") &&
        (shown("showAssigned", false) || task.assignmentInfo === undefined),
    );
    return this.page("tasks#tasks", items, params, PAGE);
  }

  /** tasks.insert (POST) and tasks.patch (PATCH). */
  write(path: string, params: URLSearchParams, body: unknown, method: string): Response {
    const target = parsePath(path);
    if (method !== "POST" && method !== "PATCH")
      throw new Error(`The fake Tasks takes no ${method}s`);
    if (params.has("parent") || params.has("previous")) {
      throw new Error("The fake Tasks doesn't place tasks under others");
    }
    if (target === undefined) return tasksError(404, "notFound", "Not Found");
    const list = this.list(target.list);
    if (list === undefined) return tasksError(404, "notFound", "Task list not found.");
    const parsed = writable.safeParse(body);
    if (!parsed.success) return tasksError(400, "invalid", "Invalid value.");
    const fields = parsed.data;
    this.writes.push({
      method,
      list: list.id,
      ...(target.task ? { task: target.task } : {}),
      body,
    });
    if (method === "POST") {
      if (target.task !== undefined) return tasksError(404, "notFound", "Not Found");
      if (fields.assignmentInfo !== undefined) {
        return tasksError(400, "invalid", "Assigned tasks can't be created through the API.");
      }
      const task = this.make(list.id, {
        title: fields.title ?? "",
        ...(fields.notes === undefined ? {} : { notes: fields.notes }),
        status: fields.status ?? "needsAction",
        ...(fields.due === undefined ? {} : { due: dateOnly(fields.due) }),
      });
      list.tasks.unshift(task);
      return this.answer(task);
    }
    const task = list.tasks.find((t) => t.id === target.task);
    if (task === undefined || target.task === undefined) {
      return tasksError(404, "notFound", "Task not found.");
    }
    if (fields.notes !== undefined && task.assignmentInfo?.surfaceType === "DOCUMENT") {
      return tasksError(400, "invalid", "Tasks assigned from Google Docs cannot have notes.");
    }
    if (fields.title !== undefined) task.title = fields.title;
    if (fields.notes !== undefined) task.notes = fields.notes;
    if (fields.due !== undefined) task.due = dateOnly(fields.due);
    if (fields.status !== undefined) {
      task.status = fields.status;
      if (fields.status === "completed") task.completed = new Date().toISOString();
      else delete task.completed;
    }
    task.updated = new Date().toISOString();
    return this.answer(task);
  }

  private list(id: string): TaskList | undefined {
    return this.lists.find((list) => list.id === id);
  }

  private make(
    listId: string,
    fields: Pick<TaskResource, "title" | "notes" | "status" | "due">,
  ): TaskResource {
    const id = randomId();
    const now = new Date().toISOString();
    // A new task goes to the top of its list.
    this.nextPosition -= 1;
    return {
      kind: "tasks#task",
      id,
      etag: `"${id}"`,
      updated: now,
      selfLink: `${HOST}/tasks/v1/lists/${listId}/tasks/${id}`,
      position: String(1e10 + this.nextPosition).padStart(20, "0"),
      webViewLink: `https://tasks.google.com/task/${id}`,
      ...fields,
      ...(fields.status === "completed" ? { completed: now } : {}),
    };
  }

  // The write's answer, or a 503 once a test asked for its answer to be lost.
  private answer(task: TaskResource): Response {
    if (this.answersToLose > 0) {
      this.answersToLose -= 1;
      return tasksError(503, "backendError", "Backend Error");
    }
    return HttpResponse.json(task);
  }

  // One page of `items`, from the page token's offset; `items` is left out of an empty page.
  private page(
    kind: string,
    items: unknown[],
    params: URLSearchParams,
    size: { default: number; max: number },
  ): Response {
    const offset = params.has("pageToken") ? Number(params.get("pageToken")) : 0;
    if (!Number.isInteger(offset) || offset < 0) {
      return tasksError(400, "invalid", "Invalid page token.");
    }
    const wanted = params.has("maxResults") ? Number(params.get("maxResults")) : size.default;
    const count = Math.min(Math.max(1, wanted), size.max);
    const page = items.slice(offset, offset + count);
    const next = offset + count < items.length ? String(offset + count) : undefined;
    return HttpResponse.json({
      kind,
      etag: `"${randomId()}"`,
      ...(next === undefined ? {} : { nextPageToken: next }),
      ...(page.length > 0 ? { items: page } : {}),
    });
  }
}

/** Tasks' error body, as Google APIs answer. */
export function tasksError(code: number, reason: string, message: string): Response {
  return HttpResponse.json(
    { error: { code, message, errors: [{ domain: "global", reason, message }] } },
    { status: code },
  );
}

function parsePath(path: string): { list: string; task?: string } | undefined {
  const match = /^\/tasks\/v1\/lists\/([^/]+)\/tasks(?:\/([^/]+))?$/.exec(path);
  if (match === null) return undefined;
  // A group that didn't take part is undefined.
  const list = match.at(1) ?? "";
  const task = match.at(2);
  return {
    list: decodeURIComponent(list),
    ...(task === undefined ? {} : { task: decodeURIComponent(task) }),
  };
}

// Google keeps only a due date's date: the time of day is discarded.
function dateOnly(timestamp: string): string {
  return `${timestamp.slice(0, 10)}T00:00:00.000Z`;
}

function randomId(): string {
  return randomBytes(12).toString("base64url");
}
