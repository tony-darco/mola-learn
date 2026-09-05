import { HOST } from "./ollama";

/**
 * Auto-titles a chat right after its first exchange completes. Deliberately
 * always uses a small, fast model (llama3.2:1b) regardless of what chat
 * model the student picked — a title is a few words summarizing one
 * exchange, not a task worth spending the main model's time or the
 * thinking-budget headroom on. One-shot, non-streaming, no tools: this is
 * not the agent loop (contract 4), just a single Ollama completion.
 */
const TITLE_MODEL = process.env.MOLA_TITLE_MODEL ?? "llama3.2:1b";

const SYSTEM = `Generate a short chat title summarizing the exchange below.
Rules: 3 to 6 words. No quotation marks. No trailing period. Plain phrasing,
not a question. Reply with ONLY the title — nothing else.`;

export async function generateChatTitle(userText: string, assistantText: string): Promise<string | null> {
  try {
    const res = await fetch(`${HOST}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: TITLE_MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Student: ${userText}\nTutor: ${assistantText}` },
        ],
        stream: false,
        think: false,
        options: { temperature: 0.3, num_predict: 20 },
      }),
    });

    if (!res.ok) {
      console.error(`title generation failed: ollama ${res.status}: ${await res.text()}`);
      return null;
    }

    const data = (await res.json()) as { message?: { content?: string } };
    const title = cleanTitle(data.message?.content ?? "");
    return title || null;
  } catch (err) {
    console.error("title generation failed:", err);
    return null;
  }
}

/** llama3.2:1b doesn't reliably stop at one line despite the system prompt —
 * confirmed live: it sometimes writes the title, then a blank line, then a
 * rambling explanation that just gets cut off by num_predict. Only the
 * first non-empty line is ever the actual title. Also strips quoting,
 * markdown emphasis, and trailing punctuation it tends to add anyway, and
 * caps length as a last-resort safety net against a runaway generation. */
function cleanTitle(raw: string): string {
  const firstLine = raw.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return firstLine
    .replace(/^["'“”*_]+|["'“”*_]+$/g, "")
    .replace(/[.!?]+$/, "")
    .trim()
    .slice(0, 60);
}
