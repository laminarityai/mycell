"use client";

import { useRef, useState, useSyncExternalStore } from "react";

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};
type RecognitionWindow = {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

const speechConstructor = () =>
  (window as RecognitionWindow).SpeechRecognition ??
  (window as RecognitionWindow).webkitSpeechRecognition;
const browserSupport = () => Boolean(speechConstructor());
const subscribeNever = () => () => undefined;

/** Dictation through the browser's own speech recognition; spoken words follow any typed text. */
export function useVoiceInput(onText: (text: string) => void) {
  const recognition = useRef<Recognition | null>(null);
  const [listening, setListening] = useState(false);
  // Known only in the browser: the server renders no microphone, then the browser adds one.
  const supported = useSyncExternalStore(subscribeNever, browserSupport, () => false);
  const speech = supported ? speechConstructor() : undefined;
  return {
    supported,
    listening,
    start(typed: string) {
      if (!speech) return;
      const next = new speech();
      next.continuous = true;
      next.interimResults = true;
      next.lang = navigator.language || "en-US";
      next.onresult = (event) => {
        const spoken = Array.from(event.results, (result) => result[0].transcript).join("");
        onText(`${typed}${typed && !typed.endsWith(" ") ? " " : ""}${spoken}`);
      };
      next.onend = () => {
        setListening(false);
      };
      recognition.current = next;
      next.start();
      setListening(true);
    },
    stop() {
      recognition.current?.stop();
      setListening(false);
    },
  };
}
