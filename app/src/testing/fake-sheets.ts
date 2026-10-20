// A fake Google Sheets, served through the fake Nango's proxy on the Sheets host. It answers
// spreadsheets.values.get and spreadsheets.values.append in the shapes Google documents, from
// spreadsheets a test seeds: values.get leaves out trailing empty rows and cells and renders
// every value as text (FORMATTED_VALUE), and append writes after the last row of the table in
// its range. A1 ranges are `Sheet!A1:C50`, `Sheet!A:C`, `Sheet` or `A1:C50` (the first sheet).
import { HttpResponse } from "msw";
import { z } from "zod";

/** A cell as stored: what a test seeded or a RAW append wrote. */
export type FakeCell = string | number | boolean | null;

/** One values.append Mycel asked for, as the request named it. */
export type FakeAppend = {
  spreadsheetId: string;
  range: string;
  valueInputOption: string | null;
  values: FakeCell[][];
};

type Spreadsheet = { sheets: Map<string, FakeCell[][]>; denied: boolean };

// A range resolved against a spreadsheet: its sheet and its 1-based bounds (inclusive).
type Bounds = { sheet: string; top: number; left: number; bottom?: number; right?: number };

// The grid a new sheet has, which a range with no end runs to (Google's default size).
const GRID = { rows: 1000, columns: 26 };

const appendBody = z.object({ values: z.array(z.array(z.unknown())) });

export class FakeSheets {
  private spreadsheets = new Map<string, Spreadsheet>();
  /** Every append asked for, in order, whether or not its answer was lost. */
  readonly appends: FakeAppend[] = [];
  private answersToLose = 0;

  /** Seeds a spreadsheet's sheet with rows, from A1. Sheets are added in order. */
  add(spreadsheetId: string, sheet: string, rows: FakeCell[][] = []): void {
    const spreadsheet = this.spreadsheets.get(spreadsheetId) ?? {
      sheets: new Map(),
      denied: false,
    };
    spreadsheet.sheets.set(
      sheet,
      rows.map((row) => [...row]),
    );
    this.spreadsheets.set(spreadsheetId, spreadsheet);
  }

  /** The sheet's rows as they stand. */
  rows(spreadsheetId: string, sheet: string): FakeCell[][] {
    const rows = this.spreadsheets.get(spreadsheetId)?.sheets.get(sheet);
    if (rows === undefined) throw new Error(`No sheet ${sheet} in ${spreadsheetId}`);
    return rows;
  }

  /** The spreadsheet exists, but isn't shared with the account: Sheets answers 403. */
  deny(spreadsheetId: string): void {
    const spreadsheet = this.spreadsheets.get(spreadsheetId);
    if (spreadsheet === undefined) throw new Error(`No spreadsheet ${spreadsheetId}`);
    spreadsheet.denied = true;
  }

  /** The next append is made, but answered 503, as when its answer is lost on the way back. */
  loseNextAnswer(): void {
    this.answersToLose += 1;
  }

  /** values.get: `GET /v4/spreadsheets/{id}/values/{range}`. */
  respond(path: string): Response {
    const target = parsePath(path);
    if (target === undefined || target.append) return sheetsError(404, "NOT_FOUND");
    const found = this.resolve(target.spreadsheetId, target.range);
    if (found instanceof Response) return found;
    const { rows, bounds } = found;
    const bottom = bounds.bottom ?? Math.max(GRID.rows, rows.length);
    const right = bounds.right ?? GRID.columns;
    const values = rows
      .slice(bounds.top - 1, bottom)
      .map((row) => Array.from(trimmed(row.slice(bounds.left - 1, right)), formatted));
    while (values.length > 0 && values.at(-1)?.length === 0) values.pop();
    return HttpResponse.json({
      range: a1(bounds.sheet, bounds.top, bounds.left, bottom, right),
      majorDimension: "ROWS",
      ...(values.length > 0 ? { values } : {}),
    });
  }

  /** values.append: `POST /v4/spreadsheets/{id}/values/{range}:append`, as INSERT_ROWS. */
  write(path: string, params: URLSearchParams, body: unknown): Response {
    const target = parsePath(path);
    if (target === undefined || !target.append) return sheetsError(404, "NOT_FOUND");
    const valueInputOption = params.get("valueInputOption");
    if (valueInputOption !== "RAW" && valueInputOption !== "USER_ENTERED") {
      return sheetsError(400, "INVALID_ARGUMENT");
    }
    const found = this.resolve(target.spreadsheetId, target.range);
    if (found instanceof Response) return found;
    const values = appendBody.parse(body).values as FakeCell[][];
    this.appends.push({ ...target, valueInputOption, values });
    const { rows, bounds } = found;
    const right = bounds.right ?? GRID.columns;
    let last = rows.length;
    while (last > 0 && trimmed((rows[last - 1] ?? []).slice(bounds.left - 1, right)).length === 0) {
      last -= 1;
    }
    const first = Math.max(last + 1, bounds.top);
    values.forEach((row, index) => {
      const at = first - 1 + index;
      while (rows.length <= at) rows.push([]);
      const existing = rows[at] ?? [];
      row.forEach((cell, column) => {
        // Like Sheets, a null leaves its cell as it was.
        if (cell !== null) existing[bounds.left - 1 + column] = cell;
      });
      rows[at] = Array.from(existing, (cell) => cell ?? null);
    });
    const width = Math.max(...values.map((row) => row.length));
    const updatedRange = a1(
      bounds.sheet,
      first,
      bounds.left,
      first + values.length - 1,
      bounds.left + width - 1,
    );
    if (this.answersToLose > 0) {
      this.answersToLose -= 1;
      return sheetsError(503, "UNAVAILABLE");
    }
    return HttpResponse.json({
      spreadsheetId: target.spreadsheetId,
      updates: {
        spreadsheetId: target.spreadsheetId,
        updatedRange,
        updatedRows: values.length,
        updatedColumns: width,
        updatedCells: values.reduce((sum, row) => sum + row.length, 0),
      },
    });
  }

  private resolve(spreadsheetId: string, range: string) {
    const spreadsheet = this.spreadsheets.get(spreadsheetId);
    if (spreadsheet === undefined) return sheetsError(404, "NOT_FOUND");
    if (spreadsheet.denied) return sheetsError(403, "PERMISSION_DENIED");
    const bounds = parseRange(range, [...spreadsheet.sheets.keys()]);
    const rows = bounds === undefined ? undefined : spreadsheet.sheets.get(bounds.sheet);
    if (bounds === undefined || rows === undefined) return sheetsError(400, "INVALID_ARGUMENT");
    return { rows, bounds };
  }
}

/** Sheets' error body, as Google APIs answer. */
export function sheetsError(code: number, status: string): Response {
  return HttpResponse.json({ error: { code, message: status, status } }, { status: code });
}

function parsePath(path: string) {
  const match = /^\/v4\/spreadsheets\/([^/]+)\/values\/([^/]+?)(:append)?$/.exec(path);
  if (match === null) return undefined;
  const [, spreadsheetId = "", range = ""] = match;
  return {
    spreadsheetId: decodeURIComponent(spreadsheetId),
    range: decodeURIComponent(range),
    append: path.endsWith(":append"),
  };
}

const CELLS = /^([A-Z]*)(\d*)(?::([A-Z]*)(\d*))?$/i;

function parseRange(range: string, sheets: string[]): Bounds | undefined {
  const bang = range.lastIndexOf("!");
  if (bang === -1 && sheets.includes(range)) return { sheet: range, top: 1, left: 1 };
  const sheet = bang === -1 ? sheets.at(0) : unquote(range.slice(0, bang));
  const match = CELLS.exec(bang === -1 ? range : range.slice(bang + 1));
  if (sheet === undefined || match === null || !sheets.includes(sheet)) return undefined;
  const [, left = "", top = "", right = "", bottom = ""] = match;
  return {
    sheet,
    top: top === "" ? 1 : Number(top),
    left: left === "" ? 1 : columnNumber(left),
    ...(bottom === "" ? {} : { bottom: Number(bottom) }),
    ...(right === "" ? {} : { right: columnNumber(right) }),
  };
}

function unquote(sheet: string): string {
  return sheet.startsWith("'") && sheet.endsWith("'")
    ? sheet.slice(1, -1).replaceAll("''", "'")
    : sheet;
}

function columnNumber(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + letters.toUpperCase().charCodeAt(i) - 64;
  return n;
}

function columnLetters(n: number): string {
  let letters = "";
  for (let rest = n; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  }
  return letters;
}

// Google quotes a sheet name that isn't a plain word.
function a1(sheet: string, top: number, left: number, bottom: number, right: number): string {
  const name = /^[A-Za-z0-9_]+$/.test(sheet) ? sheet : `'${sheet.replaceAll("'", "''")}'`;
  return `${name}!${columnLetters(left)}${String(top)}:${columnLetters(right)}${String(bottom)}`;
}

function isEmpty(cell: FakeCell | undefined): boolean {
  return cell === undefined || cell === null || cell === "";
}

function trimmed(row: FakeCell[]): FakeCell[] {
  let end = row.length;
  while (end > 0 && isEmpty(row[end - 1])) end -= 1;
  return row.slice(0, end);
}

function formatted(cell: FakeCell | undefined): string {
  if (cell === undefined || cell === null) return "";
  if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
  return String(cell);
}
