"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ArtifactRecord, HintRung } from "@mola/shared";
import { canEscalate as computeCanEscalate } from "@/lib/context/hint-ladder";
import { TurnView } from "./TurnView";
import { HintControl } from "./HintControl";
import { CompactedBanner } from "./CompactedBanner";
import { ArtifactPreviewPanel } from "./ArtifactPreviewPanel";
import { ModelPicker } from "./ModelPicker";
import { parseSSEChunk } from "./sse";
import { useRefreshSidebar } from "./shell-context";
import type { ActivityEntry, CompactionBoundary, Turn } from "./types";

type HistoryResponse = {
  chat: { id: string; title: string; courseId: string | null; model: string; thinkingEnabled: number };
  course: { id: string; name: string; number: string | null } | null;
  messages: {
    id: string; role: string; content: string;
    hintRung: HintRung | null; toolCalls: ActivityEntry[] | null; createdAt: string;
  }[];
  artifacts: ArtifactRecord[];
  compactionBoundary: CompactionBoundary | null;
};

function turnsFromHistory(data: HistoryResponse): Turn[] {
  const rows = data.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const artifactsByMessageId = new Map<string, ArtifactRecord[]>();
  for (const art of data.artifacts) {
    const artCreatedAt = new Date(art.createdAt).toISOString();
    let targetId: string | undefined = rows[0]?.id;
    for (const m of rows) {
      if (m.createdAt <= artCreatedAt) targetId = m.id;
      else break;
    }
    if (targetId) {
      const list = artifactsByMessageId.get(targetId) ?? [];
      list.push(art);
      artifactsByMessageId.set(targetId, list);
    }
  }

  return rows.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    text: m.content,
    activity: m.toolCalls ?? [],
    artifacts: artifactsByMessageId.get(m.id) ?? [],
    hintRung: m.hintRung,
    error: null,
    streaming: false,
  }));
}

function lastRung(turns: Turn[]): HintRung | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t?.role === "assistant" && t.hintRung) return t.hintRung;
  }
  return null;
}

/**
 * The main content pane for a single chat — messages, composer, artifact
 * preview. Rendered as `children` inside the persistent AppShell, which owns
 * the sidebar; this component has no sidebar of its own.
 */
export function ChatMain({ chatId }: { chatId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const refreshSidebar = useRefreshSidebar();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rung, setRung] = useState<HintRung | null>(null);
  const [canEscalate, setCanEscalate] = useState(true);
  const [boundary, setBoundary] = useState<CompactionBoundary | null>(null);
  const [expandedCompacted, setExpandedCompacted] = useState(false);
  const [input, setInput] = useState("");
  const [artifactPreviewOpen, setArtifactPreviewOpen] = useState(false);
  const [model, setModel] = useState("qwen3.6:27b");
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Keyed by chatId, kept for the life of this mounted ChatMain (it's never
  // remounted between chats — see the comment below). Lets a revisit within
  // the same session hydrate instantly instead of flashing a blank loading
  // state (PROPOSALS.md §1 / e2e/flash-flicker.spec.ts).
  const historyCache = useRef<Map<string, HistoryResponse>>(new Map());

  function hydrate(data: HistoryResponse) {
    const hydrated = turnsFromHistory(data);
    setTurns(hydrated);
    setBoundary(data.compactionBoundary);
    setExpandedCompacted(false);
    setModel(data.chat.model);
    setThinkingEnabled(data.chat.thinkingEnabled === 1);
    const r = lastRung(hydrated);
    setRung(r);
    setCanEscalate(computeCanEscalate(r));
  }

  async function changeModel(next: { model: string; thinkingEnabled: boolean }) {
    setModel(next.model);
    setThinkingEnabled(next.thinkingEnabled);
    try {
      await fetch(`/api/chat/${chatId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
    } catch {
      // Best-effort — the next turn just uses whatever the server still has on record.
    }
  }

  // Reload history on mount AND whenever the chat we're pointed at changes
  // (navigating the sidebar re-renders this component with a new chatId).
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);

    const cached = historyCache.current.get(chatId);
    if (cached) {
      // Stale-while-revalidate: paint the cached turns immediately (no
      // spinner), then silently refresh from the network below.
      hydrate(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    fetch(`/api/chat/${chatId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`failed to load chat (${res.status})`);
        return (await res.json()) as HistoryResponse;
      })
      .then((data) => {
        if (cancelled) return;
        historyCache.current.set(chatId, data);
        hydrate(data);
      })
      .catch((err: Error) => {
        if (!cancelled && !cached) setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [chatId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns]);

  // A chat started from a course page's composer (NewCourseChatComposer)
  // carries the student's typed text over as a prefilled draft rather than
  // sending it itself — this just fills the box; the student still presses
  // Send.
  useEffect(() => {
    const draft = searchParams.get("draft");
    if (!draft) return;
    setInput(draft);
    router.replace(`/chats/${chatId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  function patchTurn(id: string, fn: (t: Turn) => Turn) {
    setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
  }

  async function refetchHistory() {
    const res = await fetch(`/api/chat/${chatId}`);
    if (!res.ok) return;
    const data = (await res.json()) as HistoryResponse;
    setTurns(turnsFromHistory(data));
    setBoundary(data.compactionBoundary);
  }

  async function send(pullHint: boolean) {
    if (busy) return;
    const text = input.trim();
    if (!text && !pullHint) return;

    setBusy(true);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const userTurnId = `local-user-${Date.now()}`;
    let assistantTurnId = `local-assistant-${Date.now()}`;

    setTurns((ts) => [
      ...ts,
      {
        id: userTurnId, role: "user", text: text || "(asked for a hint)",
        activity: [], artifacts: [], hintRung: null, error: null, streaming: false,
      },
      {
        id: assistantTurnId, role: "assistant", text: "",
        activity: [], artifacts: [], hintRung: null, error: null, streaming: true,
      },
    ]);

    try {
      const res = await fetch(`/api/chat/${chatId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, pullHint }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let compactedDuringStream = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSSEChunk(buffer);
        buffer = rest;

        for (const ev of events) {
          switch (ev.type) {
            case "message_start": {
              const newId = ev.messageId;
              const oldId = assistantTurnId;
              assistantTurnId = newId;
              setTurns((ts) => ts.map((t) => (t.id === oldId ? { ...t, id: newId } : t)));
              break;
            }
            case "text_delta":
              patchTurn(assistantTurnId, (t) => ({ ...t, text: t.text + ev.text }));
              break;
            case "tool_call_start":
              patchTurn(assistantTurnId, (t) => ({
                ...t,
                activity: [...t.activity, { kind: "tool", id: ev.toolCallId, name: ev.name, label: ev.label, status: "running" }],
              }));
              break;
            case "tool_call_end":
              patchTurn(assistantTurnId, (t) => ({
                ...t,
                activity: t.activity.map((a) =>
                  a.kind === "tool" && a.id === ev.toolCallId
                    ? { ...a, status: ev.status, summary: ev.summary }
                    : a,
                ),
              }));
              break;
            case "subagent_start":
              patchTurn(assistantTurnId, (t) => ({
                ...t,
                activity: [...t.activity, { kind: "subagent", id: ev.subagentId, label: ev.label, status: "running" }],
              }));
              break;
            case "subagent_end":
              patchTurn(assistantTurnId, (t) => ({
                ...t,
                activity: t.activity.map((a) =>
                  a.kind === "subagent" && a.id === ev.subagentId ? { ...a, status: "done" } : a,
                ),
              }));
              break;
            case "artifact":
              patchTurn(assistantTurnId, (t) => ({ ...t, artifacts: [...t.artifacts, ev.artifact] }));
              break;
            case "hint_state":
              setRung(ev.rung);
              setCanEscalate(ev.canEscalate);
              patchTurn(assistantTurnId, (t) => ({ ...t, hintRung: ev.rung }));
              break;
            case "compacted":
              compactedDuringStream = true;
              break;
            case "message_end":
              patchTurn(assistantTurnId, (t) => ({ ...t, streaming: false }));
              break;
            case "error":
              patchTurn(assistantTurnId, (t) => ({ ...t, error: ev.message, streaming: false }));
              break;
          }
        }
      }

      if (compactedDuringStream) {
        // The server just wrote a new boundary; refetch rather than guess its
        // summary text client-side.
        await refetchHistory();
      }
      // The chat's title may have just changed from "New chat" to something
      // real (or moved position by recency) — let the sidebar know.
      refreshSidebar();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      patchTurn(assistantTurnId, (t) => ({ ...t, error: message, streaming: false }));
    } finally {
      setBusy(false);
    }
  }

  const boundaryIdx = boundary ? turns.findIndex((t) => t.id === boundary.upToMessageId) : -1;
  const hiddenTurns = boundaryIdx >= 0 ? turns.slice(0, boundaryIdx + 1) : [];
  const visibleTurns = boundaryIdx >= 0 ? turns.slice(boundaryIdx + 1) : turns;

  return (
    <main className="chat-main relative">
      <button
        type="button"
        className={`absolute right-4 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md border text-base ${
          artifactPreviewOpen
            ? "border-accent bg-accent text-accent-fg"
            : "border-border bg-surface text-fg-muted hover:bg-bg"
        }`}
        onClick={() => setArtifactPreviewOpen((o) => !o)}
        title="Preview artifact renderers (dev)"
        aria-label="Preview artifact renderers"
        aria-expanded={artifactPreviewOpen}
      >
        ⧉
      </button>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="chat-scroll" ref={scrollRef}>
            <div className="chat-column">
              {loading && <div className="py-2 text-base text-fg-muted">Loading conversation…</div>}
              {loadError && (
                <div className="py-2 text-base text-red-700 dark:text-red-400">
                  Couldn&apos;t load this conversation: {loadError}
                </div>
              )}

              {!loading && !loadError && turns.length === 0 && (
                <p className="text-base text-fg-muted">
                  Ask something. Mola is Socratic by default — use &ldquo;Hint&rdquo; to pull the ladder.
                </p>
              )}

              {!loading && !loadError && hiddenTurns.length > 0 && boundary && (
                <CompactedBanner
                  boundary={boundary}
                  hiddenCount={hiddenTurns.length}
                  expanded={expandedCompacted}
                  onToggle={() => setExpandedCompacted((e) => !e)}
                />
              )}

              {!loading && !loadError && expandedCompacted && hiddenTurns.map((t) => (
                <TurnView key={t.id} turn={t} />
              ))}

              {!loading && !loadError && visibleTurns.map((t) => (
                <TurnView key={t.id} turn={t} />
              ))}
            </div>
          </div>

          <div className="px-6 py-4">
            <div className="chat-column">
              <div className="rounded-2xl border border-border bg-surface p-2.5">
                <div className="flex items-end gap-2">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      e.target.style.height = "auto";
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                    }}
                    onKeyDown={(e) => {
                      // `e.keyCode` is deprecated but kept as a fallback: some IMEs and
                      // virtual keyboards report `key: "Unidentified"` for Enter/Return.
                      if ((e.key === "Enter" || e.keyCode === 13) && !e.shiftKey) {
                        e.preventDefault();
                        void send(false);
                      }
                    }}
                    placeholder="Ask about your course…"
                    disabled={busy}
                    rows={1}
                    className="max-h-40 min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-base text-fg placeholder:text-fg-muted focus:outline-none disabled:opacity-60"
                  />
                  <div className="flex shrink-0 items-center gap-2">
                    <ModelPicker model={model} thinkingEnabled={thinkingEnabled} onChange={(next) => void changeModel(next)} disabled={busy} />
                    <HintControl rung={rung} canEscalate={canEscalate} disabled={busy} onPull={() => void send(true)} />
                    <button
                      type="button"
                      className="shrink-0 rounded-md bg-transparent px-2 py-1.5 text-xl leading-none text-fg hover:bg-bg disabled:cursor-default disabled:opacity-50"
                      onClick={() => void send(false)}
                      disabled={busy || !input.trim()}
                      title="Send"
                      aria-label="Send"
                    >
                      ⏎
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {artifactPreviewOpen && <ArtifactPreviewPanel onClose={() => setArtifactPreviewOpen(false)} />}
      </div>
    </main>
  );
}
