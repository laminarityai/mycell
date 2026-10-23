// The memory feature's prompts (memory/prompts/), each template with the variables it takes.
import { definePrompts } from "@/lib/prompts";
import extractFile from "../prompts/extract.prompt.yml";
import matchFile from "../prompts/match.prompt.yml";
import summarizeFile from "../prompts/summarize.prompt.yml";

export const extractPrompts = definePrompts(extractFile, {
  emailQuestion: [],
  documentQuestion: [],
  system: ["kind", "domain"],
  prompt: ["kind", "text"],
  objectRef: [],
  objectEmail: [],
  objectDomain: [],
  factAbout: [],
  factStatement: [],
  factEvidence: [],
  factPredicate: [],
  factObject: [],
  factValidFrom: [],
});

export const matchPrompts = definePrompts(matchFile, {
  system: ["kind"],
  prompt: ["new", "existing"],
  recordName: ["name"],
  recordKey: ["kind", "value"],
  recordFacts: [],
  recordFact: ["statement"],
  same: [],
});

export const summarizePrompts = definePrompts(summarizeFile, {
  system: [],
  prompt: ["kind", "name", "facts"],
  fact: ["statement", "recorded"],
});
