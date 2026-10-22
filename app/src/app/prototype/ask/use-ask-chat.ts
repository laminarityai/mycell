"use client";

// PROTOTYPE, throwaway: Ask Mycel's local state, shared by the variants (not their layout). The
// conversations, their threads, sending (a canned reply that types in, as streaming would), new
// and delete, and each proposed run's state. Nothing reaches a server.
import { useEffect, useState } from "react";
import { NOW } from "../_shared/fixtures";
import { CANNED_REPLY, type ConversationSummary, type Message } from "./conversation";
import { CONVERSATIONS, threadsFor } from "./threads";

/** A proposed run waits for Run, then starts, then finishes with its draft waiting as a review. */
export type RunState = "proposed" | "started" | "finished";

export { STARTED_RUN_ID } from "./conversation";

/** `google` is the toggle: "none" when the viewer hasn't connected Google. */
export function useAskChat(google: string) {
  const [conversations, setConversations] = useState<ConversationSummary[]>(CONVERSATIONS);
  const [threads, setThreads] = useState<Record<string, Message[] | undefined>>(() =>
    threadsFor(google),
  );
  const [activeId, setActiveId] = useState<string | null>(CONVERSATIONS[0].id);
  const [runs, setRuns] = useState<Record<string, RunState | undefined>>({});
  const [streaming, setStreaming] = useState<{ id: string; shown: number } | null>(null);
  const [count, setCount] = useState(0);
  // The google toggle changes without remounting the page: start its threads afresh.
  const [threadsGoogle, setThreadsGoogle] = useState(google);
  if (threadsGoogle !== google) {
    setThreadsGoogle(google);
    setThreads(threadsFor(google));
  }

  useEffect(() => {
    if (streaming === null) return;
    const timer = setTimeout(() => {
      const shown = streaming.shown + 3;
      setStreaming(shown >= CANNED_REPLY.length ? null : { id: streaming.id, shown });
    }, 18);
    return () => {
      clearTimeout(timer);
    };
  }, [streaming]);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const messages = activeId === null ? [] : (threads[activeId] ?? []);

  function newConversation() {
    const id = `new-${String(count)}`;
    setCount(count + 1);
    setConversations([{ id, title: "New conversation", updatedAt: NOW }, ...conversations]);
    setThreads({ ...threads, [id]: [] });
    setActiveId(id);
  }

  function deleteConversation(id: string) {
    const rest = conversations.filter((c) => c.id !== id);
    setConversations(rest);
    if (id === activeId) setActiveId(rest.length === 0 ? null : rest[0].id);
  }

  function send(text: string) {
    let id = activeId;
    let list = conversations;
    if (id === null) {
      id = `new-${String(count)}`;
      setCount(count + 1);
      list = [{ id, title: text.slice(0, 40), updatedAt: NOW }, ...conversations];
      setActiveId(id);
    } else if (messages.length === 0) {
      list = conversations.map((c) => (c.id === id ? { ...c, title: text.slice(0, 40) } : c));
    }
    setConversations(list);
    const replyId = `${id}-${String(Date.now())}`;
    const sent: Message[] = [
      { id: `${replyId}-q`, role: "person", at: NOW, parts: [{ kind: "text", text }] },
      { id: replyId, role: "mycel", at: NOW, parts: [{ kind: "text", text: CANNED_REPLY }] },
    ];
    setThreads({ ...threads, [id]: [...(threads[id] ?? []), ...sent] });
    setStreaming({ id: replyId, shown: 0 });
  }

  /** The text a message's part shows now: all of it, or as much as has "streamed". */
  function shownText(messageId: string, text: string) {
    return streaming?.id === messageId ? text.slice(0, streaming.shown) : text;
  }

  function run(messageId: string) {
    setRuns((current) => ({ ...current, [messageId]: "started" }));
    setTimeout(() => {
      setRuns((current) => ({ ...current, [messageId]: "finished" }));
    }, 2500);
  }

  return {
    /** False when the viewer hasn't connected Google: message search and runs need it. */
    googleConnected: google !== "none",
    conversations,
    /** Every conversation's messages, by id, for searching across them. */
    threads,
    active,
    activeId,
    setActiveId,
    messages,
    newConversation,
    deleteConversation,
    send,
    shownText,
    isStreaming: streaming !== null,
    /** Grows as the canned reply types in, for scrolling to follow it. */
    streamProgress: streaming?.shown ?? 0,
    runState: (messageId: string): RunState => runs[messageId] ?? "proposed",
    run,
  };
}

export type AskChat = ReturnType<typeof useAskChat>;
