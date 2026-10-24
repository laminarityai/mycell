"use client";

import { ArrowUp, Mic, PanelRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { demoModels } from "../data";
import { compact } from "../format";
import type { DemoAgent } from "../types";
import {
  ActivityPanel,
  browsePattern,
  browserSteps,
  scheduleFor,
  schedulePattern,
  type BrowserRun,
  type Routine,
} from "./activity-panel";
import { AgentAvatar } from "./avatar";
import { useVoiceInput } from "./voice-input";

export type Message = { id: number; mine: boolean; text: string; tokens: number };

// Agent turns carry context and tool results, so even short questions use a few thousand tokens.
const turnTokens = (text: string) => Math.min(60_000, 2_500 + text.length * 40);

/** One conversation with one agent, like a text thread with a coworker. Replies are simulated. */
export function Thread({
  agent,
  messages,
  onSend,
  tokensLeft,
}: {
  agent: DemoAgent;
  messages: Message[];
  onSend: (message: Message, reply: Message) => void;
  tokensLeft: number | null;
}) {
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState("auto");
  const [reasoning, setReasoning] = useState("Auto");
  const [panelOpen, setPanelOpen] = useState(false);
  const [browser, setBrowser] = useState<BrowserRun | null>(null);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const timers = useRef<number[]>([]);
  const voice = useVoiceInput(setDraft);
  const limited = tokensLeft !== null && tokensLeft <= 0;
  useEffect(
    () => () => {
      timers.current.forEach((timer) => {
        window.clearTimeout(timer);
      });
    },
    [],
  );

  const send = () => {
    const text = draft.trim();
    if (!text || limited) return;
    voice.stop();
    const label =
      model === "auto" ? "Auto" : (demoModels.find((item) => item.id === model)?.label ?? model);
    onSend(
      { id: messages.length, mine: true, text, tokens: 0 },
      {
        id: messages.length + 1,
        mine: false,
        text: `You asked: "${text}"\n\nIn the product, ${agent.name} would answer here using ${label}${reasoning === "Auto" ? "" : ` with ${reasoning.toLowerCase()} reasoning`}. The demo doesn't run agents.`,
        tokens: turnTokens(text),
      },
    );
    setDraft("");
    if (browsePattern.test(text)) {
      setBrowser({ url: `google.com/search?q=${encodeURIComponent(text.slice(0, 40))}`, step: 0 });
      setPanelOpen(true);
      browserSteps.forEach((_, index) =>
        timers.current.push(
          window.setTimeout(
            () => {
              setBrowser((run) => run && { ...run, step: index + 1 });
            },
            500 + index * 600,
          ),
        ),
      );
    }
    if (schedulePattern.test(text)) {
      setRoutines([...routines, { name: text.slice(0, 40), when: scheduleFor(text) }]);
      setPanelOpen(true);
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <section
        aria-label={`Conversation with ${agent.name}`}
        className="flex min-w-0 flex-1 flex-col"
      >
        <header className="flex h-14 items-center gap-3 border-b px-4">
          <AgentAvatar name={agent.name} className="size-8 text-xs" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold">{agent.name}</h2>
            <p className="truncate text-xs text-muted-foreground">{agent.description}</p>
          </div>
          <Button
            size="icon-sm"
            variant={panelOpen ? "secondary" : "ghost"}
            aria-label="Activity"
            aria-pressed={panelOpen}
            onClick={() => {
              setPanelOpen(!panelOpen);
            }}
          >
            <PanelRight />
          </Button>
        </header>
        <ol className="flex flex-1 flex-col justify-end gap-2 overflow-y-auto p-4">
          {messages.length === 0 && (
            <li className="m-auto text-sm text-muted-foreground">
              Message {agent.name} like you would a coworker.
            </li>
          )}
          {messages.map((message) => (
            <li key={message.id} className={message.mine ? "flex justify-end" : "flex"}>
              <p
                className={
                  message.mine
                    ? "max-w-[78%] rounded-[20px] rounded-br-md bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground"
                    : "max-w-[78%] rounded-[20px] rounded-bl-md bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap"
                }
              >
                {message.text}
              </p>
            </li>
          ))}
        </ol>
        <form
          className="space-y-1 border-t p-3"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <div className="flex items-end gap-2">
            <Textarea
              aria-label="Message"
              rows={1}
              value={draft}
              disabled={limited}
              placeholder={limited ? "You've reached today's token limit" : `Message ${agent.name}`}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            {voice.supported && (
              <Button
                type="button"
                size="icon"
                variant={voice.listening ? "destructive" : "ghost"}
                aria-label={voice.listening ? "Stop voice input" : "Voice input"}
                aria-pressed={voice.listening}
                onClick={() => {
                  if (voice.listening) voice.stop();
                  else voice.start(draft);
                }}
              >
                <Mic />
              </Button>
            )}
            <Button
              type="submit"
              size="icon"
              aria-label="Send message"
              disabled={!draft.trim() || limited}
            >
              <ArrowUp />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <NativeSelect
              size="sm"
              aria-label="Model"
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
              }}
            >
              <NativeSelectOption value="auto">Auto</NativeSelectOption>
              {demoModels.map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {item.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <NativeSelect
              size="sm"
              aria-label="Reasoning level"
              value={reasoning}
              onChange={(event) => {
                setReasoning(event.target.value);
              }}
            >
              {["Auto", "Low", "Medium", "High"].map((level) => (
                <NativeSelectOption key={level}>{level}</NativeSelectOption>
              ))}
            </NativeSelect>
            {tokensLeft !== null && (
              <span className="ml-auto">{compact(Math.max(0, tokensLeft))} tokens left today</span>
            )}
          </div>
        </form>
      </section>
      {panelOpen && (
        <ActivityPanel
          browser={browser}
          routines={routines}
          connections={agent.connections}
          onClose={() => {
            setPanelOpen(false);
          }}
        />
      )}
    </div>
  );
}
