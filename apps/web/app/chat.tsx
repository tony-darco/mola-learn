"use client";

import { useState } from "react";
import { decodeSSE, type HintRung } from "@mola/shared";
import { signOutAction } from "@/lib/auth/actions";

type Turn = { role: "user" | "assistant"; text: string; tools: string[] };

export function Chat(props: {
  chatId: string;
  chatTitle: string;
  courseName: string | null;
  userName: string;
  /** The course detail page supplies its own nav chrome and chat-list pills. */
  hideSidebar?: boolean;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [rung, setRung] = useState<HintRung | null>(null);
  const [canEscalate, setCanEscalate] = useState(true);

  async function send(pullHint: boolean) {
    if (busy) return;
    const text = input.trim();
    if (!text && !pullHint) return;
    setBusy(true);
    setInput("");
    setTurns((t) => [
      ...t,
      { role: "user", text: text || "(hint, please)", tools: [] },
      { role: "assistant", text: "", tools: [] },
    ]);

    const res = await fetch(`/api/chat/${props.chatId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: text, pullHint }),
    });

    if (!res.body) { setBusy(false); return; }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const ev = decodeSSE(part.trim());
        if (!ev) continue;
        if (ev.type === "text_delta") {
          setTurns((t) => patchLast(t, (last) => ({ ...last, text: last.text + ev.text })));
        } else if (ev.type === "tool_call_start") {
          setTurns((t) => patchLast(t, (last) => ({ ...last, tools: [...last.tools, ev.label] })));
        } else if (ev.type === "hint_state") {
          setRung(ev.rung);
          setCanEscalate(ev.canEscalate);
        } else if (ev.type === "error") {
          setTurns((t) => patchLast(t, (last) => ({ ...last, text: `⚠ ${ev.message}` })));
        }
      }
    }
    setBusy(false);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: props.hideSidebar ? "1fr" : "260px 1fr", height: "100%" }}>
      {!props.hideSidebar && (
      <aside style={{ borderRight: "1px solid var(--border)", padding: 20, background: "var(--panel)" }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Mola</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>{props.userName}</div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
          <a href="/courses" style={{ color: "var(--accent)" }}>Courses</a>
          <a href="/profile" style={{ color: "var(--accent)" }}>Profile</a>
          <a href="/settings" style={{ color: "var(--accent)" }}>Settings</a>
          <form action={signOutAction}>
            <button
              type="submit"
              style={{ background: "none", border: "none", padding: 0, color: "var(--accent)", cursor: "pointer", font: "inherit" }}
            >
              Sign out
            </button>
          </form>
        </nav>
        <div style={{ height: 24 }} />
        {props.courseName && (
          <>
            <div style={{ fontSize: 12, textTransform: "uppercase", color: "var(--muted)" }}>Course</div>
            <div style={{ marginBottom: 20 }}>{props.courseName}</div>
          </>
        )}
        <div style={{ fontSize: 12, textTransform: "uppercase", color: "var(--muted)" }}>Chats</div>
        <div style={{ padding: "6px 0" }}>{props.chatTitle}</div>
      </aside>
      )}

      <main style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ flex: 1, overflowY: "auto", padding: "32px 24px" }}>
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            {turns.length === 0 && (
              <p style={{ color: "var(--muted)" }}>
                Ask something. Mola is Socratic by default — use “Hint” to pull the ladder.
              </p>
            )}
            {turns.map((t, i) => (
              <div key={i} style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                  {t.role === "user" ? "You" : "Mola"}
                </div>
                {t.tools.map((label, j) => (
                  <div key={j} style={{
                    fontSize: 13, color: "var(--muted)", background: "var(--panel)",
                    border: "1px solid var(--border)", borderRadius: 6,
                    padding: "4px 10px", marginBottom: 6, display: "inline-block",
                  }}>
                    ⚙ {label}
                  </div>
                ))}
                <div style={{ whiteSpace: "pre-wrap" }}>{t.text || (busy ? "…" : "")}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ borderTop: "1px solid var(--border)", padding: 16, background: "var(--panel)" }}>
          <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(false)}
              placeholder="Ask about your course…"
              style={{
                flex: 1, padding: "10px 14px", borderRadius: 8,
                border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)",
              }}
            />
            <button onClick={() => send(false)} disabled={busy} style={btn(true)}>Send</button>
            {/* Student-PULLED. Nothing advances this rung on a timer (§3). */}
            <button onClick={() => send(true)} disabled={busy || !canEscalate} style={btn(false)}>
              {rung ? `Hint (${rung})` : "Hint"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

const btn = (primary: boolean) => ({
  padding: "10px 16px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: primary ? "var(--accent)" : "var(--panel)",
  color: primary ? "#fff" : "var(--text)",
  cursor: "pointer",
});

function patchLast(turns: Turn[], fn: (t: Turn) => Turn): Turn[] {
  const copy = [...turns];
  const last = copy.at(-1);
  if (last) copy[copy.length - 1] = fn(last);
  return copy;
}
