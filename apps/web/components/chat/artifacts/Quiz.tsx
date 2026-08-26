"use client";

import { useState } from "react";
import type { quizPayloadSchema } from "@mola/shared";
import type { z } from "zod";

type Payload = z.infer<typeof quizPayloadSchema>;

export function Quiz({ payload, title }: { payload: Payload; title: string }) {
  return (
    <div className="quiz">
      <div className="quiz-header">
        <span>{title}</span>
        <span className="quiz-difficulty">{payload.difficulty}</span>
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
    <div className="quiz-question">
      <div className="quiz-prompt">{index}. {question.prompt}</div>

      {question.type === "multiple_choice" ? (
        <div className="quiz-options">
          {question.options.map((opt, i) => {
            const isCorrect = revealed && i === question.correctIndex;
            const isWrongPick = revealed && selected === i && i !== question.correctIndex;
            return (
              <button
                type="button"
                key={i}
                className={`quiz-option${isCorrect ? " quiz-option-correct" : ""}${isWrongPick ? " quiz-option-wrong" : ""}`}
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
        <div className="quiz-explanation">{question.explanation}</div>
      )}
    </div>
  );
}

function ShortAnswer({ expected }: { expected: string }) {
  const [value, setValue] = useState("");
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="quiz-short-answer">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Type your answer…"
        rows={2}
        disabled={revealed}
      />
      {!revealed ? (
        <button type="button" onClick={() => setRevealed(true)}>Check against expected answer</button>
      ) : (
        <div className="quiz-expected">Expected: {expected}</div>
      )}
    </div>
  );
}
