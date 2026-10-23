"use client";

// One check of a path's condition: what it tests, chosen from what's above its branch on its
// own path (a classify answer, a fact about the message, or a value a step above gives), and
// how: a minimum confidence for an answer, or an operator its value's type allows.
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import type { CheckChoices } from "@/features/policy/condition-fields";
import {
  checkOn,
  operatorWords,
  withOperator,
  type Operator,
  type ValueCheck,
} from "@/features/spec/conditions";
import type { Check } from "@/features/spec/types";

/** A new check: the first classify answer offered, or else the first field. */
export function firstCheck(choices: CheckChoices): Check {
  const answer = choices.answers.at(0);
  if (answer !== undefined) return { classify: answer.classify, is: answer.is, minP: 0.8 };
  const field = choices.fields.at(0);
  return field === undefined
    ? { subject: { from: "trigger.subject" }, op: "contains", value: "" }
    : checkOn(field);
}

export function CheckEditor({
  check,
  choices,
  onChange,
  onRemove,
}: {
  check: Check;
  choices: CheckChoices;
  onChange: (check: Check) => void;
  /** Left out for a condition's only check: a path that always runs is the otherwise path. */
  onRemove?: () => void;
}) {
  const classify = "classify" in check;
  const answerAt = classify
    ? choices.answers.findIndex((a) => a.classify === check.classify && a.is === check.is)
    : -1;
  const fieldAt = classify
    ? -1
    : choices.fields.findIndex((field) => field.from === check.subject.from);
  const chosen =
    answerAt >= 0
      ? `answer:${String(answerAt)}`
      : fieldAt >= 0
        ? `field:${String(fieldAt)}`
        : "current";
  const current = classify ? `"${check.classify}" says "${check.is}"` : check.subject.from;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-muted/30 p-2">
      <div className="flex items-center gap-1">
        <NativeSelect
          aria-label="What to test"
          className="w-full min-w-0"
          value={chosen}
          onChange={(event) => {
            const [kind, at] = event.target.value.split(":");
            const answer = choices.answers.at(Number(at));
            const field = choices.fields.at(Number(at));
            if (kind === "answer" && answer !== undefined) {
              const minP = classify ? check.minP : 0.8;
              onChange({ classify: answer.classify, is: answer.is, minP });
            } else if (kind === "field" && field !== undefined) {
              onChange(checkOn(field));
            }
          }}
        >
          {chosen === "current" ? (
            <NativeSelectOption value="current">{current} (not above this path)</NativeSelectOption>
          ) : null}
          {choices.answers.length === 0 ? null : (
            <NativeSelectOptGroup label="Classify answers">
              {choices.answers.map((answer, at) => (
                <NativeSelectOption
                  key={`${answer.classify}:${answer.is}`}
                  value={`answer:${String(at)}`}
                >
                  {answer.label}
                </NativeSelectOption>
              ))}
            </NativeSelectOptGroup>
          )}
          <NativeSelectOptGroup label="Values">
            {choices.fields.map((field, at) => (
              <NativeSelectOption key={field.from} value={`field:${String(at)}`}>
                {field.label} ({field.from})
              </NativeSelectOption>
            ))}
          </NativeSelectOptGroup>
        </NativeSelect>
        {onRemove === undefined ? null : (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Remove check"
            onClick={onRemove}
          >
            <X />
          </Button>
        )}
      </div>
      {classify ? (
        <label className="flex items-center gap-1 text-xs">
          <span className="shrink-0">At least</span>
          <Input
            aria-label="Minimum confidence (%)"
            type="number"
            min={0}
            max={100}
            value={Math.round(check.minP * 100)}
            className="w-20"
            onChange={(event) => {
              onChange({ ...check, minP: Number(event.target.value) / 100 });
            }}
          />
          <span>% sure</span>
        </label>
      ) : (
        <ValueTest
          check={check}
          operators={choices.fields[fieldAt]?.operators ?? [check.op]}
          onChange={onChange}
        />
      )}
    </div>
  );
}

/** How a value is checked: the operator, and the value it's compared with, typed to fit. */
function ValueTest({
  check,
  operators,
  onChange,
}: {
  check: ValueCheck;
  operators: readonly Operator[];
  onChange: (check: Check) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <NativeSelect
        aria-label="Operator"
        className="w-full min-w-0"
        value={check.op}
        onChange={(event) => {
          onChange(withOperator(check, event.target.value as Operator));
        }}
      >
        {operators.map((op) => (
          <NativeSelectOption key={op} value={op}>
            {operatorWords(op)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {"value" in check ? (
        <Input
          aria-label="Value"
          type={typeof check.value === "number" ? "number" : "text"}
          value={check.value}
          className="min-w-0"
          onChange={(event) => {
            const typed = event.target.value;
            onChange({
              ...check,
              value: typeof check.value === "number" ? Number(typed) : typed,
            } as Check);
          }}
        />
      ) : null}
    </div>
  );
}
