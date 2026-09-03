"use client";

import { useState } from "react";
import type { quizPayloadSchema } from "@mola/shared";
import type { z } from "zod";

type Payload = z.infer<typeof quizPayloadSchema>;

export function Quiz({ payload, title }: { payload: Payload; title: string }) {
  return (
    <div>
      <div className="mb-2.5 flex justify-between text-sm text-fg-muted">
        <span>{title}</span>
        <span>{payload.difficulty}</span>
      </div>
      {payload.questions.map((q, i) => (
        <QuizQuestion key={q.id} index={i + 1} question={q} />
      ))}
    </div>
  );
}

function QuizQuestion({ index, question }: { index: number; question: Payload["questions"][number] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="mb-4">
      <div className="mb-2 font-medium text-fg">{index}. {question.prompt}</div>

      {question.type === "multiple_choice" ? (
        <div className="flex flex-col gap-1.5">
          {question.options.map((opt, i) => {
            const isCorrect = revealed && i === question.correctIndex;
            const isWrongPick = revealed && selected === i && i !== question.correctIndex;
            return (
              <button
                type="button"
                key={i}
                className={`rounded-lg border px-3 py-2 text-left disabled:cursor-default ${
                  isCorrect
                    ? "border-green-600 bg-green-600/10"
                    : isWrongPick
                      ? "border-red-600 bg-red-600/10"
                      : "border-border bg-bg"
                }`}
                onClick={() => { setSelected(i); setRevealed(true); }}
                disabled={revealed}
              >
                {opt}
              </button>
            );
          })}
        </div>
      ) : (
        <ShortAnswer expected={question.expectedAnswer} />
      )}

      {revealed && question.explanation && (
        <div className="mt-2 text-sm text-fg-muted">{question.explanation}</div>
      )}
    </div>
  );
}

function ShortAnswer({ expected }: { expected: string }) {
  const [value, setValue] = useState("");
  const [revealed, setRevealed] = useState(false);
  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Type your answer…"
        rows={2}
        disabled={revealed}
        className="w-full rounded-lg border border-border bg-bg p-2 text-fg"
      />
      {!revealed ? (
        <button
          type="button"
          className="mt-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-fg"
          onClick={() => setRevealed(true)}
        >
          Check against expected answer
        </button>
      ) : (
        <div className="mt-1.5 text-sm text-fg-muted">Expected: {expected}</div>
      )}
    </div>
  );
}
