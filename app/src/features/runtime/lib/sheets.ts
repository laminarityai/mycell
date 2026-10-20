// Google Sheets through the Nango proxy, for runs: the read-range and append-row actions, and a
// range's values as a draft's context. Values are read inside the step that uses them and held
// in memory only (invariant 8); what leaves a step is the range and its counts.
import { z } from "zod";
import { proxyGet, proxyPost } from "@/features/connections/server";
import { SourceRequestError } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import { RunStepError } from "./failures";

const SPREADSHEETS = "/v4/spreadsheets";

type Cell = string | number | boolean | null;
type RangeInput = { spreadsheetId: string; range: string };

// values.get leaves `values` out for an empty range, and trailing empty cells off each row.
const valueRange = z.object({
  range: z.string(),
  values: z.array(z.array(z.unknown())).default([]),
});
const appended = z.object({ updates: z.object({ updatedRange: z.string() }) });

/** The read-range action: the range as Sheets names it, and how many rows and columns it has. */
export async function readRange(
  ctx: Ctx,
  connectionId: string,
  input: RangeInput,
): Promise<{ range: string; rowCount: number; columnCount: number }> {
  const { range, values } = await getValues(ctx, connectionId, input.spreadsheetId, input.range);
  return {
    range,
    rowCount: values.length,
    columnCount: Math.max(0, ...values.map((row) => row.length)),
  };
}

/** The range's values as a model reads them: one line per row, its cells separated by tabs. */
export async function rangeText(
  ctx: Ctx,
  connectionId: string,
  input: RangeInput,
): Promise<string> {
  const { values } = await getValues(ctx, connectionId, input.spreadsheetId, input.range);
  return values.map((row) => row.map((cell) => text(cell)).join("\t")).join("\n");
}

/**
 * The append-row action: appends `values` as one row after the range's table, with the run
 * step's marker (`mycel:<runId>/<stepId>`) in the cell after the last, as typed (RAW: nothing
 * is read as a formula). Sheets' append isn't idempotent, so it first looks for a row carrying
 * the marker, from an earlier try whose answer was lost, and records that row instead of
 * appending again. The catalog makes the range name its sheet, and the marker is looked for in
 * that whole sheet.
 */
export async function appendRow(
  ctx: Ctx,
  connectionId: string,
  input: RangeInput & { values: Cell[] },
  marker: string,
): Promise<{ updatedRange: string }> {
  const cell = `mycel:${marker}`;
  const earlier = await markedRow(ctx, connectionId, input, cell);
  if (earlier !== undefined) return { updatedRange: earlier };
  const query = new URLSearchParams({ valueInputOption: "RAW", insertDataOption: "INSERT_ROWS" });
  const path = `${valuesPath(input.spreadsheetId, input.range)}:append?${query.toString()}`;
  const body = { majorDimension: "ROWS", values: [[...input.values, cell]] };
  const result = await sheets(proxyPost(ctx, connectionId, path, body, appended));
  return { updatedRange: result.updates.updatedRange };
}

// The A1 range of the row carrying the marker, from its first value to the marker's cell.
async function markedRow(
  ctx: Ctx,
  connectionId: string,
  input: RangeInput & { values: Cell[] },
  marker: string,
): Promise<string | undefined> {
  const sheet = input.range.slice(0, input.range.lastIndexOf("!"));
  const read = await getValues(ctx, connectionId, input.spreadsheetId, sheet);
  const rowIndex = read.values.findIndex((row) => row.includes(marker));
  if (rowIndex === -1) return undefined;
  const markerColumn = read.values[rowIndex]?.indexOf(marker) ?? 0;
  const start = /^(.*)!([A-Z]+)(\d+)/i.exec(read.range);
  if (start === null) return read.range;
  const [, name = "", letters = "", row = ""] = start;
  const top = Number(row) + rowIndex;
  const left = columnNumber(letters) + markerColumn - input.values.length;
  const right = columnNumber(letters) + markerColumn;
  return `${name}!${columnLetters(left)}${String(top)}:${columnLetters(right)}${String(top)}`;
}

async function getValues(ctx: Ctx, connectionId: string, spreadsheetId: string, range: string) {
  return sheets(proxyGet(ctx, connectionId, valuesPath(spreadsheetId, range), valueRange));
}

function valuesPath(spreadsheetId: string, range: string): string {
  return `${SPREADSHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
}

/**
 * A Sheets request's answer, or the step's failure: no such spreadsheet (404), a range Sheets
 * can't read (400) and a spreadsheet the account may not open (403) aren't retried, since
 * trying again gets the same answer. Messages name no spreadsheet, range or value.
 */
async function sheets<T>(request: Promise<T | null>): Promise<T> {
  let result: T | null;
  try {
    result = await request;
  } catch (error) {
    if (error instanceof SourceRequestError && error.status === 403) {
      throw new RunStepError("source_forbidden", "Sheets refused access to the spreadsheet.");
    }
    if (error instanceof SourceRequestError && error.status === 400) {
      throw new RunStepError("invalid_input", "Sheets couldn't read the range.");
    }
    throw error;
  }
  if (result === null) {
    throw new RunStepError("source_item_missing", "Sheets has no such spreadsheet.");
  }
  return result;
}

function text(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  return typeof cell === "string" ? cell : JSON.stringify(cell);
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
