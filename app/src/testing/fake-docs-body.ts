// A fake Google Doc's body, for the fake Docs: its text, character by character, each marked
// with the suggestions on it (a suggested insertion, suggested deletions, suggested style
// changes), and the edits that change it, made directly or as suggestions. Indexes are Docs':
// the body's first character is at 1 (a section break comes first), and suggested text counts,
// as it does in the SUGGESTIONS_INLINE view, the one whose indexes a batchUpdate takes.

/** Thrown for a request Docs refuses; the fake answers it with its status and message. */
export class DocsRequestError extends Error {
  constructor(
    readonly status: 400 | 403,
    message: string,
  ) {
    super(message);
  }
}

type Char = { ch: string; insertedBy?: string; deletedBy: string[]; styledBy: string[] };

/** How a document is read: with its suggestions inline, or as it reads with none applied. */
export type ViewMode = "SUGGESTIONS_INLINE" | "PREVIEW_WITHOUT_SUGGESTIONS";

export class FakeDocBody {
  private chars: Char[];

  constructor(text: string) {
    const body = text.endsWith("\n") ? text : `${text}\n`;
    this.chars = units(body).map((ch) => ({ ch, deletedBy: [], styledBy: [] }));
  }

  clone(): FakeDocBody {
    const copy = new FakeDocBody("");
    copy.chars = this.chars.map((c) => ({
      ...c,
      deletedBy: [...c.deletedBy],
      styledBy: [...c.styledBy],
    }));
    return copy;
  }

  /** The text as it reads with every suggestion left out (none accepted). */
  text(): string {
    return this.chars
      .filter((c) => c.insertedBy === undefined)
      .map((c) => c.ch)
      .join("");
  }

  /** Every suggestion ID marked on the body. */
  suggestionIds(): Set<string> {
    const ids = new Set<string>();
    for (const c of this.chars) {
      if (c.insertedBy !== undefined) ids.add(c.insertedBy);
      for (const id of [...c.deletedBy, ...c.styledBy]) ids.add(id);
    }
    return ids;
  }

  /** insertText at a 1-based index, or at the end of the body (before its last newline). */
  insert(text: string, at: number | "end", suggestion: string | undefined): void {
    const offset = at === "end" ? this.chars.length - 1 : at - 1;
    if (text === "" || offset < 0 || offset > this.chars.length - 1) {
      throw new DocsRequestError(400, "Invalid requests[0].insertText: Index out of bounds.");
    }
    const added = units(text).map((ch): Char => ({
      ch,
      insertedBy: suggestion,
      deletedBy: [],
      styledBy: [],
    }));
    this.chars.splice(offset, 0, ...added);
  }

  /** deleteContentRange over [start, end), which may not take the body's last newline. */
  delete(start: number, end: number, suggestion: string | undefined): void {
    this.checkRange(start, end);
    if (suggestion === undefined) {
      this.chars.splice(start - 1, end - start);
      return;
    }
    for (const c of this.chars.slice(start - 1, end - 1)) c.deletedBy.push(suggestion);
  }

  /** updateTextStyle over [start, end): only a suggested change is marked; styles aren't kept. */
  style(start: number, end: number, suggestion: string | undefined): void {
    this.checkRange(start, end);
    if (suggestion === undefined) return;
    for (const c of this.chars.slice(start - 1, end - 1)) c.styledBy.push(suggestion);
  }

  /**
   * replaceAllText over the text no suggestion deletes, each match its own suggestion (from
   * `next`), its text marked deleted and the replacement inserted after it. Returns how many
   * matched.
   */
  replaceAll(find: string, replace: string, matchCase: boolean, next?: () => string): number {
    const same = (a: string, b: string) =>
      matchCase ? a === b : a.toLowerCase() === b.toLowerCase();
    let count = 0;
    for (let i = 0; i + find.length <= this.chars.length; i++) {
      const run = this.chars.slice(i, i + find.length);
      if (find === "" || run.some((c) => c.deletedBy.length > 0)) continue;
      if (!same(run.map((c) => c.ch).join(""), find)) continue;
      count += 1;
      const suggestion = next?.();
      const added = units(replace).map((ch): Char => ({
        ch,
        insertedBy: suggestion,
        deletedBy: [],
        styledBy: [],
      }));
      if (suggestion === undefined) {
        this.chars.splice(i, find.length, ...added);
      } else {
        for (const c of run) c.deletedBy.push(suggestion);
        this.chars.splice(i + find.length, 0, ...added);
      }
      i += (suggestion === undefined ? 0 : find.length) + added.length - 1;
    }
    return count;
  }

  /** Accepts the suggestion: its insertions stay, its deletions go. False if it isn't here. */
  accept(id: string): boolean {
    if (!this.suggestionIds().has(id)) return false;
    this.chars = this.chars.filter((c) => !c.deletedBy.includes(id));
    for (const c of this.chars) {
      if (c.insertedBy === id) delete c.insertedBy;
      c.deletedBy = c.deletedBy.filter((other) => other !== id);
      c.styledBy = c.styledBy.filter((other) => other !== id);
    }
    return true;
  }

  /** Rejects the suggestion: its insertions go, its deletions stay. False if it isn't here. */
  reject(id: string): boolean {
    if (!this.suggestionIds().has(id)) return false;
    this.chars = this.chars.filter((c) => c.insertedBy !== id);
    for (const c of this.chars) {
      c.deletedBy = c.deletedBy.filter((other) => other !== id);
      c.styledBy = c.styledBy.filter((other) => other !== id);
    }
    return true;
  }

  /**
   * The body's `content` as documents.get gives it: a section break, then a paragraph per line,
   * each made of text runs whose characters carry the same suggestions.
   */
  content(mode: ViewMode): unknown[] {
    const shown: Char[] =
      mode === "SUGGESTIONS_INLINE"
        ? this.chars
        : this.chars
            .filter((c) => c.insertedBy === undefined)
            .map((c) => ({ ch: c.ch, deletedBy: [], styledBy: [] }));
    const content: unknown[] = [{ endIndex: 1, sectionBreak: { sectionStyle: {} } }];
    let paragraph: { startIndex: number; runs: Run[] } | undefined;
    shown.forEach((c, i) => {
      const index = i + 1;
      paragraph ??= { startIndex: index, runs: [] };
      const last = paragraph.runs.at(-1);
      if (last !== undefined && sameMarks(last.marks, c)) {
        last.content += c.ch;
        last.endIndex = index + 1;
      } else {
        paragraph.runs.push({ startIndex: index, endIndex: index + 1, marks: c, content: c.ch });
      }
      if (c.ch === "\n") {
        content.push({
          startIndex: paragraph.startIndex,
          endIndex: index + 1,
          paragraph: {
            elements: paragraph.runs.map((r) => ({
              startIndex: r.startIndex,
              endIndex: r.endIndex,
              textRun: textRun(r.content, r.marks),
            })),
            paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
          },
        });
        paragraph = undefined;
      }
    });
    return content;
  }

  private checkRange(start: number, end: number): void {
    if (start < 1 || end <= start || end > this.chars.length) {
      throw new DocsRequestError(400, "Invalid requests[0]: The range is out of bounds.");
    }
  }
}

function sameMarks(a: Char, b: Char): boolean {
  return (
    a.insertedBy === b.insertedBy &&
    a.deletedBy.join() === b.deletedBy.join() &&
    a.styledBy.join() === b.styledBy.join()
  );
}

// One run of characters carrying the same suggestions, as the body is rendered.
type Run = { startIndex: number; endIndex: number; marks: Char; content: string };

// A string's UTF-16 code units, which Docs' indexes count.
function units(text: string): string[] {
  return Array.from({ length: text.length }, (_, i) => text.charAt(i));
}

// A textRun as Docs gives it, with the suggestion IDs on it.
function textRun(content: string, c: Char) {
  return {
    content,
    textStyle: {},
    ...(c.insertedBy === undefined ? {} : { suggestedInsertionIds: [c.insertedBy] }),
    ...(c.deletedBy.length === 0 ? {} : { suggestedDeletionIds: [...c.deletedBy] }),
    ...(c.styledBy.length === 0
      ? {}
      : {
          suggestedTextStyleChanges: Object.fromEntries(
            c.styledBy.map((id) => [id, { textStyle: {}, textStyleSuggestionState: {} }]),
          ),
        }),
  };
}
