/**
 * The canvas-reader eval's questions: things a model should be able to
 * answer about the composite board from its read alone, each with one right
 * answer. Asked all at once, answered as one JSON object, scored question by
 * question after light normalization (case, spacing, dash and minus style,
 * surrounding quotes, a trailing full stop).
 */
import { BOARD_TEXT } from "./fixtures";

/** `exact`: the text, normalized. `latex`: the same, ignoring spaces too. `list`: the same set of labels, in any order. `yesno`: the leading yes or no. */
export type Question = { id: string; question: string; expected: string | string[]; compare: "exact" | "latex" | "list" | "yesno" };

export const QUESTIONS: Question[] = [
  { id: "circled_cell", question: `Which matrix cell is circled with the pen? Answer with its address, for example "M9 row 9 col 9".`, expected: "M2 row 2 col 3", compare: "exact" },
  { id: "circled_entry", question: "What entry is written in that circled cell?", expected: "-1", compare: "exact" },
  { id: "pen_arrow_from", question: "The arrow drawn with the pen: which matrix does it start from? Answer with its label.", expected: "M4", compare: "exact" },
  { id: "pen_arrow_to", question: "Which matrix does that pen arrow point to? Answer with its label.", expected: "M5", compare: "exact" },
  { id: "text_box", question: "What does the user's text box say? Give its exact text.", expected: BOARD_TEXT.textBox, compare: "exact" },
  { id: "math", question: "What LaTeX is in the math element? Give it exactly.", expected: BOARD_TEXT.math, compare: "latex" },
  { id: "note", question: "What does the sticky note say? Give its exact text.", expected: BOARD_TEXT.note, compare: "exact" },
  { id: "underlined_word", question: "Which handwritten word is underlined? Give the word exactly as written.", expected: "2R1", compare: "exact" },
  { id: "underlined_where", question: `Where is that underlined word? Answer with its address, for example "T9 word 9".`, expected: "T1 word 6", compare: "exact" },
  { id: "highlighted", question: `What is the highlighter stroke over? Answer with its address, for example "T9 words 8–9".`, expected: "T5 words 2–4", compare: "exact" },
  { id: "ellipse", question: "What does the ellipse enclose? Answer with a label.", expected: "T7", compare: "exact" },
  { id: "frame_contents", question: "What does frame F1 contain? Answer with a list of labels.", expected: ["M8"], compare: "list" },
  { id: "tool_arrow", question: "What does the arrow made with the arrow tool (not drawn with the pen) point at? Answer with a label.", expected: "N1", compare: "exact" },
  { id: "ai_made", question: "Which element was made by the AI? Answer with its label.", expected: "X2", compare: "exact" },
  { id: "arrow_into_m1", question: `Is there any arrow pointing at M1? Answer "yes" or "no".`, expected: "no", compare: "yesno" },
];

export const SYSTEM = "You read a whiteboard that has been converted to text, and answer questions about it. Answer with JSON only.";

export function buildPrompt(read: string): string {
  return `${read}

QUESTIONS
Answer each question from the text above.
${QUESTIONS.map((q, i) => `${i + 1}. ${q.id}: ${q.question}`).join("\n")}

Reply with ONLY a JSON object with one key per question id. Every answer is a string, except frame_contents, which is a list of strings:
{${QUESTIONS.map((q) => `"${q.id}": ${Array.isArray(q.expected) ? `["..."]` : `"..."`}`).join(", ")}}`;
}

/**
 * The JSON object in a reply — ignoring ``` fences and chatter around it —
 * or null. LaTeX often comes back with its backslashes unescaped ("\det"),
 * which isn't valid JSON; those are doubled and the parse retried.
 */
export function parseAnswers(raw: string): Record<string, unknown> | null {
  const unfenced = raw.replace(/```[a-zA-Z]*/g, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const body = unfenced.slice(start, end + 1);
  const repaired = body.replace(/\\(["\\/bfnrtu])?/g, (escape, valid: string | undefined) => (valid ? escape : "\\\\"));
  for (const attempt of [body, repaired]) {
    try {
      const value: unknown = JSON.parse(attempt);
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // try the next repair
    }
  }
  return null;
}

const normalize = (s: string) => s.normalize("NFKC")
  .replace(/[‐-―−]/g, "-")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/^["'`]+|["'`]+$/g, "")
  .replace(/\.$/, "")
  .toLowerCase();

const asList = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map(String) : String(v ?? "").split(/,|\band\b/)).map(normalize).filter(Boolean).sort();

export type AnswerResult = { id: string; question: string; expected: string; got: string | null; pass: boolean };

export function scoreAnswers(answers: Record<string, unknown> | null): AnswerResult[] {
  return QUESTIONS.map((q) => {
    const value = answers?.[q.id];
    const got = value === undefined || value === null ? null : Array.isArray(value) ? JSON.stringify(value) : String(value);
    const expected = Array.isArray(q.expected) ? JSON.stringify(q.expected) : q.expected;
    let pass = false;
    if (got !== null) {
      if (q.compare === "list") pass = JSON.stringify(asList(value)) === JSON.stringify(asList(q.expected));
      else if (q.compare === "latex") pass = normalize(got).replace(/ /g, "") === normalize(expected).replace(/ /g, "");
      else if (q.compare === "yesno") pass = /^(yes|no)\b/.exec(normalize(got))?.[1] === expected;
      else pass = normalize(got) === normalize(expected);
    }
    return { id: q.id, question: q.question, expected, got, pass };
  });
}
