import { describe, expect, it } from "vitest";
import {
  headerValue,
  headerValues,
  htmlToText,
  labelNamed,
  messageBody,
  type MessagePart,
} from "../gmail";

const data = (text: string) => Buffer.from(text, "utf8").toString("base64url");
const part = (mimeType: string, text: string, filename?: string): MessagePart => ({
  mimeType,
  ...(filename === undefined ? {} : { filename }),
  body: { data: data(text) },
});
const multipart = (...parts: MessagePart[]): MessagePart => ({
  mimeType: "multipart/mixed",
  parts,
});

describe("messageBody", () => {
  it("reads every plain-text part, and no HTML when there is one", () => {
    const payload = multipart(
      { mimeType: "multipart/alternative", parts: [part("text/plain", "First")] },
      part("text/html", "<p>Not this</p>"),
      part("text/plain", "Second"),
    );

    expect(messageBody(payload)).toEqual({ text: "First\nSecond", links: [] });
  });

  it("reads the HTML as text, with its links, when there's no plain text", () => {
    const payload = multipart(
      part("text/html", '<p>See <a href="https://example.test/?a=1&amp;b=2">the plan</a></p>'),
    );

    expect(messageBody(payload)).toEqual({
      text: "See the plan",
      links: ["https://example.test/?a=1&b=2"],
    });
  });

  it("leaves attached files out, even text ones", () => {
    const payload = multipart(
      part("text/plain", "ATTACHED", "notes.txt"),
      part("text/plain", "Hi"),
    );

    expect(messageBody(payload).text).toBe("Hi");
  });

  it("is empty for a message with no payload", () => {
    expect(messageBody(undefined)).toEqual({ text: "", links: [] });
  });
});

describe("htmlToText", () => {
  it("drops scripts and styles, and makes tags and runs of white space one space", () => {
    expect(
      htmlToText("<style>p { color: red }</style><p>Hello</p>\n\n<script>x()</script><b>there</b>"),
    ).toBe("Hello there");
  });

  it("decodes named, decimal and hex character references", () => {
    expect(htmlToText("&lt;a&gt; &quot;b&quot; &apos;c&apos;&nbsp;d &#64; &#x41; &amp;")).toBe(
      "<a> \"b\" 'c' d @ A &",
    );
  });

  it("decodes &amp; last, so an escaped reference reads as written", () => {
    expect(htmlToText("&amp;lt; &amp;#64;")).toBe("&lt; &#64;");
  });

  it("reads a character code no character has as U+FFFD rather than throwing", () => {
    expect(htmlToText("&#99999999; &#x110000; dave&#64;partner.example")).toBe(
      "� � dave@partner.example",
    );
  });
});

describe("headers", () => {
  const headers = [
    { name: "To", value: "a@example.test" },
    { name: "subject", value: "Hello" },
    { name: "TO", value: "b@example.test" },
  ];

  it("finds a header's values regardless of case, in order", () => {
    expect(headerValues(headers, "to")).toEqual(["a@example.test", "b@example.test"]);
    expect(headerValue(headers, "Subject")).toBe("Hello");
  });

  it("finds nothing for a header a message doesn't have", () => {
    expect(headerValue(headers, "Cc")).toBeUndefined();
    expect(headerValues(undefined, "To")).toEqual([]);
  });
});

describe("labelNamed", () => {
  it("finds a label by name regardless of case", () => {
    const labels = [
      { id: "Label_1", name: "Invoices" },
      { id: "Label_2", name: "Clients/Acme" },
    ];

    expect(labelNamed(labels, "invoices")?.id).toBe("Label_1");
    expect(labelNamed(labels, "Receipts")).toBeUndefined();
  });
});
