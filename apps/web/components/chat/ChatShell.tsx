"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ArtifactRecord, HintRung } from "@mola/shared";
import { canEscalate as computeCanEscalate } from "@/lib/context/hint-ladder";
import { Sidebar } from "./Sidebar";
import { TurnView } from "./TurnView";
import { HintControl } from "./HintControl";
import { CompactedBanner } from "./CompactedBanner";
import { ArtifactPreviewPanel } from "./ArtifactPreviewPanel";
import { parseSSEChunk } from "./sse";
import type { ActivityEntry, ChatSummary, CompactionBoundary, CourseSummary, Turn } from "./types";

type HistoryResponse = {
  chat: { id: string; title: string; courseId: string | null };
  course: { id: string; name: string; number: string | null } | null;
  messages: {
    id: string; role: string; content: string;
    hintRung: HintRung | null; toolCalls: ActivityEntry[] | null; createdAt: string;
  }[];
  artifacts: ArtifactRecord[];
  compactionBoundary: CompactionBoundary | null;
};

type ListResponse = { chats: ChatSummary[]; courses: CourseSummary[] };

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

export function ChatShell(props: {
  chatId: string;
  initialTitle: string;
  initialCourseId: string | null;
  initialCourseName: string | null;
  userName: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rung, setRung] = useState<HintRung | null>(null);
  const [canEscalate, setCanEscalate] = useState(true);
  const [boundary, setBoundary] = useState<CompactionBoundary | null>(null);
  const [expandedCompacted, setExpandedCompacted] = useState(false);
  const [input, setInput] = useState("");
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [newChatBusy, setNewChatBusy] = useState(false);
  const [artifactPreviewOpen, setArtifactPreviewOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reload history on mount AND whenever the chat we're pointed at changes
  // (navigating the sidebar re-renders this component with a new chatId).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    fetch(`/api/chat/${props.chatId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`failed to load chat (${res.status})`);
        return (await res.json()) as HistoryResponse;
      })
      .then((data) => {
        if (cancelled) return;
        const hydrated = turnsFromHistory(data);
        setTurns(hydrated);
        setBoundary(data.compactionBoundary);
        setExpandedCompacted(false);
        const r = lastRung(hydrated);
        setRung(r);
        setCanEscalate(computeCanEscalate(r));
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [props.chatId]);

  useEffect(() => {
    fetch("/api/chat")
      .then((res) => (res.ok ? (res.json() as Promise<ListResponse>) : null))
      .then((data) => {
        if (!data) return;
        setChats(data.chats);
        setCourses(data.courses);
      })
      .catch(() => { /* sidebar list is a convenience, not load-bearing */ });
  }, [props.chatId, turns.length]);

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
    router.replace(`/chats/${props.chatId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.chatId]);

  function patchTurn(id: string, fn: (t: Turn) => Turn) {
    setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
  }

  async function refetchHistory() {
    const res = await fetch(`/api/chat/${props.chatId}`);
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
      const res = await fetch(`/api/chat/${props.chatId}`, {
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      patchTurn(assistantTurnId, (t) => ({ ...t, error: message, streaming: false }));
    } finally {
      setBusy(false);
    }
  }

  async function handleNewChat(courseId: string | null) {
    if (newChatBusy) return;
    setNewChatBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId }),
      });
      if (!res.ok) throw new Error(`failed to create chat (${res.status})`);
      const { id } = (await res.json()) as { id: string };
      router.push(`/chats/${id}`);
    } catch {
      // Sidebar action failing is non-fatal — the user stays where they are.
    } finally {
      setNewChatBusy(false);
    }
  }

  const boundaryIdx = boundary ? turns.findIndex((t) => t.id === boundary.upToMessageId) : -1;
  const hiddenTurns = boundaryIdx >= 0 ? turns.slice(0, boundaryIdx + 1) : [];
  const visibleTurns = boundaryIdx >= 0 ? turns.slice(boundaryIdx + 1) : turns;

  return (
    <div className="chat-layout">
      <Sidebar
        userName={props.userName}
        activeChatId={props.chatId}
        chats={chats.length ? chats : [{ id: props.chatId, title: props.initialTitle, courseId: props.initialCourseId, updatedAt: "" }]}
        courses={courses.length ? courses : props.initialCourseName && props.initialCourseId
          ? [{ id: props.initialCourseId, name: props.initialCourseName, number: null }]
          : []}
        onNewChat={handleNewChat}
        newChatBusy={newChatBusy}
      />

      <main className="chat-main relative">
        <button
          type="button"
          className={`absolute right-4 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md border text-sm ${
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
          <div className="chat-scroll" ref={scrollRef}>
            <div className="chat-column">
              {loading && <div className="py-2 text-fg-muted">Loading conversation…</div>}
              {loadError && (
                <div className="py-2 text-red-700 dark:text-red-400">
                  Couldn&apos;t load this conversation: {loadError}
                </div>
              )}

              {!loading && !loadError && turns.length === 0 && (
                <p className="text-fg-muted">
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

          {artifactPreviewOpen && <ArtifactPreviewPanel onClose={() => setArtifactPreviewOpen(false)} />}
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
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send(false);
                    }
                  }}
                  placeholder="Ask about your course…"
                  disabled={busy}
                  rows={1}
                  className="max-h-40 min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-fg placeholder:text-fg-muted focus:outline-none disabled:opacity-60"
                />
                <div className="flex shrink-0 items-center gap-2">
                  <HintControl rung={rung} canEscalate={canEscalate} disabled={busy} onPull={() => void send(true)} />
                  <button
                    type="button"
                    className="shrink-0 rounded-md bg-transparent px-2 py-1.5 text-lg leading-none text-fg hover:bg-bg disabled:cursor-default disabled:opacity-50"
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
      </main>
    </div>
  );
}
