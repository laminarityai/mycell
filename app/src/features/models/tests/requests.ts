// The prompts the models feature's tests send, rendered like any other (tests/requests.prompt.yml).
import { definePrompts } from "@/lib/prompts";
import requestsFile from "./requests.prompt.yml";

export const testPrompts = definePrompts(requestsFile, {
  hi: [],
  writeAReply: [],
  extractTheOrder: [],
  isItAQuote: [],
  which: [],
  answerFromTools: [],
  lookUp: [],
});
