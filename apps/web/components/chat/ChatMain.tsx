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
import { MathInputBar } from "./MathInputBar";
import { CalculatorButton } from "./CalculatorButton";
import { MathFieldSurface } from "./MathFieldSurface";
import { MATH_CATEGORIES, wrapMathForInsertion } from "./math-symbols";
import { parseSSEChunk } from "./sse";
import { useConfirm, useRefreshSidebar } from "./shell-context";
import type { ActivityEntry, CompactionBoundary, Turn } from "./types";

type MessageStatus = "streaming" | "done" | "error";

type HistoryResponse = {
  chat: { id: string; title: string; courseId: string | null; model: string; thinkingEnabled: number };
  course: { id: string; name: string; number: string | null } | null;
  messages: {
    id: string; role: string; content: string;
    hintRung: HintRung | null; toolCalls: ActivityEntry[] | null; createdAt: string;
    status: MessageStatus; errorMessage: string | null;
  }[];
  artifacts: ArtifactRecord[];
  compactionBoundary: CompactionBoundary | null;
  hasOwnKey: boolean;
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
    // A reload replays whatever's durably persisted — including a turn that
    // was still generating or that failed before this component ever existed
    // (resumable-chat-state fix). A user row's status is always "done" (only
    // assistant rows ever go through "streaming"/"error").
    error: m.status === "error" ? (m.errorMessage ?? "Something went wrong.") : null,
    streaming: m.status === "streaming",
    createdAt: m.createdAt,
  }));
}

const SESSION_CACHE_PREFIX = "mola:chat-history:";

/** sessionStorage-backed twin of the in-memory `historyCache` — same data,
 * surviving a reload of this tab (cleared when the tab closes, never shared
 * with other tabs). The in-memory Map stays the fast path for a same-session
 * revisit; this is only consulted on a cold mount where the Map is empty.
 * Read/write are both best-effort: private browsing, a full quota, or
 * disabled storage should degrade to a plain network fetch, never break the
 * chat. */
function readSessionCache(chatId: string): HistoryResponse | null {
  try {
    const raw = sessionStorage.getItem(SESSION_CACHE_PREFIX + chatId);
    return raw ? (JSON.parse(raw) as HistoryResponse) : null;
  } catch {
    return null;
  }
}

function writeSessionCache(chatId: string, data: HistoryResponse) {
  try {
    sessionStorage.setItem(SESSION_CACHE_PREFIX + chatId, JSON.stringify(data));
  } catch {
    // Quota exceeded or storage disabled — the in-memory cache still covers
    // this tab for the rest of the session.
  }
}

// Module-level (not per-component-instance) so it survives React Strict
// Mode's dev-only mount→cleanup→mount double-invoke of the loading effect
// below, which was firing this exact GET twice back-to-back for the same
// chatId (confirmed live: two /api/chat/{id} responses of identical byte
// size on every single chat open). A second invocation for a chatId that's
// still in flight reuses the same promise instead of issuing a second
// network request and a second DB read.
const inFlightHistoryFetches = new Map<string, Promise<HistoryResponse>>();

function fetchHistory(chatId: string): Promise<HistoryResponse> {
  const existing = inFlightHistoryFetches.get(chatId);
  if (existing) return existing;
  const promise = fetch(`/api/chat/${chatId}`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`failed to load chat (${res.status})`);
      return (await res.json()) as HistoryResponse;
    })
    .finally(() => {
      inFlightHistoryFetches.delete(chatId);
    });
  inFlightHistoryFetches.set(chatId, promise);
  return promise;
}

/** The literal placeholder both client and server store for a hint pull with
 * no typed text (send()'s body, and the POST route's own fallback) — used to
 * tell retryFrom() whether to replay a turn as pullHint rather than as text. */
const HINT_PLACEHOLDER = "(asked for a hint)";

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
  const confirm = useConfirm();
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
  const [hasOwnKey, setHasOwnKey] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Keyed by chatId, kept for the life of this mounted ChatMain (it's never
  // remounted between chats — see the comment below). Lets a revisit within
  // the same session hydrate instantly instead of flashing a blank loading
  // state (PROPOSALS.md §1 / e2e/flash-flicker.spec.ts). Mirrored into
  // sessionStorage (see readSessionCache/writeSessionCache above) so a
  // reload of this tab still gets the fast path — this Map alone is wiped
  // by one.
  const historyCache = useRef<Map<string, HistoryResponse>>(new Map());
  const pendingDraftRef = useRef<string | null>(null);
  const [mathCategory, setMathCategory] = useState<string | null>(null);
  const mathInsertPoint = useRef({ start: 0, end: 0 });
  // Message ids this component instance is already receiving live updates
  // for — either send()'s own POST response is still being read, or a
  // reconnect stream is already attached. Guards attachReconnect() against
  // opening a second, redundant connection for a turn send() is already
  // driving (ChatMain is never remounted between chats — see the loading
  // useEffect below — so send()'s reader loop for chat A can still be alive
  // while the user is looking at chat B and back at A again).
  const liveTurnIdsRef = useRef<Set<string>>(new Set());
  // The assistant message id `send()` is currently generating, if any — read
  // by stop() to tell the server which generation to cancel (see the `stop`
  // route). Explicit-cancel-only: nothing here ever aborts on disconnect.
  const currentAssistantIdRef = useRef<string | null>(null);

  /**
   * Reattaches to a turn that's still "streaming" per the DB (started by this
   * tab before a navigation/reload, another tab, or a prior server process
   * that's since restarted). One GET to a held-open SSE endpoint — no
   * interval, no repeated fetch; the server pushes the terminal event the
   * moment Postgres NOTIFYs it (see the `stream` route and packages/db's
   * notify.ts). The loading ellipsis is already showing because hydrate()
   * set streaming: true from the message's persisted status.
   */
  async function attachReconnect(messageId: string) {
    if (liveTurnIdsRef.current.has(messageId)) return;
    liveTurnIdsRef.current.add(messageId);

    try {
      const res = await fetch(`/api/chat/${chatId}/messages/${messageId}/stream`);
      if (!res.ok || !res.body) throw new Error(`reconnect failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSSEChunk(buffer);
        buffer = rest;

        for (const ev of events) {
          switch (ev.type) {
            case "text_delta":
              patchTurn(messageId, (t) => ({ ...t, text: t.text + ev.text }));
              break;
            case "message_end":
              patchTurn(messageId, (t) => ({ ...t, streaming: false }));
              break;
            case "error":
              patchTurn(messageId, (t) => ({ ...t, error: ev.message, streaming: false }));
              break;
            default:
              break;
          }
        }
      }
    } catch (err) {
      console.error(`reconnect to message ${messageId} failed:`, err);
      // Leaves the turn showing "streaming" rather than guessing at a result
      // that was never actually confirmed — the next reload/navigation will
      // reattach and try again, same as any other dropped connection.
    } finally {
      liveTurnIdsRef.current.delete(messageId);
    }
  }

  function hydrate(data: HistoryResponse) {
    const hydrated = turnsFromHistory(data);
    setTurns(hydrated);
    setBoundary(data.compactionBoundary);
    setExpandedCompacted(false);
    setModel(data.chat.model);
    setThinkingEnabled(data.chat.thinkingEnabled === 1);
    setHasOwnKey(data.hasOwnKey);
    const r = lastRung(hydrated);
    setRung(r);
    setCanEscalate(computeCanEscalate(r));

    for (const t of hydrated) {
      if (t.role === "assistant" && t.streaming) void attachReconnect(t.id);
    }
  }

  async function changeModel(next: { model: string; thinkingEnabled: boolean }) {
    const previous = { model, thinkingEnabled };
    setModel(next.model);
    setThinkingEnabled(next.thinkingEnabled);
    try {
      const res = await fetch(`/api/chat/${chatId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error(`failed to update model (${res.status})`);
      // Keep the per-chat cache in sync — otherwise a revisit (or a reload,
      // via the sessionStorage copy) right after this change would briefly
      // redisplay the pre-change model from the stale cached entry before
      // the background revalidation fetch corrects it.
      const cached = historyCache.current.get(chatId);
      if (cached) {
        const updated: HistoryResponse = {
          ...cached,
          chat: { ...cached.chat, model: next.model, thinkingEnabled: next.thinkingEnabled ? 1 : 0 },
        };
        historyCache.current.set(chatId, updated);
        writeSessionCache(chatId, updated);
      }
    } catch (err) {
      // The picker was showing the new selection optimistically — revert it
      // since the server never actually persisted the change, so the next
      // turn (which reads the DB fresh) doesn't silently use something else.
      console.error(`chat ${chatId} model change failed:`, err);
      setModel(previous.model);
      setThinkingEnabled(previous.thinkingEnabled);
    }
  }

  // Reload history on mount AND whenever the chat we're pointed at changes
  // (navigating the sidebar re-renders this component with a new chatId).
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);

    let cached = historyCache.current.get(chatId);
    if (!cached) {
      // Cold mount (fresh tab, or a reload) — the in-memory Map is always
      // empty here regardless of what was cached before, so fall back to
      // sessionStorage's copy of the same data before hitting the network.
      const fromSession = readSessionCache(chatId);
      if (fromSession) {
        cached = fromSession;
        historyCache.current.set(chatId, fromSession);
      }
    }
    if (cached) {
      // Stale-while-revalidate: paint the cached turns immediately (no
      // spinner), then silently refresh from the network below.
      hydrate(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    fetchHistory(chatId)
      .then((data) => {
        if (cancelled) return;
        historyCache.current.set(chatId, data);
        writeSessionCache(chatId, data);
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
  // carries the student's typed text over via `?draft=` — queued here rather
  // than sent immediately, because a brand-new chat's history GET is still
  // in flight at this point and resolves to an empty message list; firing
  // send() before that lands would have hydrate()'s setTurns(hydrated) wipe
  // out the turns send() just optimistically appended.
  useEffect(() => {
    const draft = searchParams.get("draft");
    if (!draft) return;
    pendingDraftRef.current = draft;
    router.replace(`/chats/${chatId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // Fires the queued draft once the initial history load has settled (see
  // above) — this is what makes hitting Enter in the course composer start
  // the chat immediately instead of requiring a second Enter here.
  useEffect(() => {
    if (loading) return;
    const draft = pendingDraftRef.current;
    if (!draft) return;
    pendingDraftRef.current = null;
    void send(false, draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  function patchTurn(id: string, fn: (t: Turn) => Turn) {
    setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
  }

  async function refetchHistory() {
    const res = await fetch(`/api/chat/${chatId}`);
    if (!res.ok) return;
    const data = (await res.json()) as HistoryResponse;
    const refetched = turnsFromHistory(data);
    setTurns(refetched);
    setBoundary(data.compactionBoundary);
    for (const t of refetched) {
      if (t.role === "assistant" && t.streaming) void attachReconnect(t.id);
    }
  }

  async function send(pullHint: boolean, overrideText?: string) {
    if (busy) return;
    const text = (overrideText ?? input).trim();
    if (!text && !pullHint) return;

    setBusy(true);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const userTurnId = `local-user-${Date.now()}`;
    let assistantTurnId = `local-assistant-${Date.now()}`;
    const now = new Date().toISOString();

    setTurns((ts) => [
      ...ts,
      {
        id: userTurnId, role: "user", text: text || HINT_PLACEHOLDER,
        activity: [], artifacts: [], hintRung: null, error: null, streaming: false, createdAt: now,
      },
      {
        id: assistantTurnId, role: "assistant", text: "",
        activity: [], artifacts: [], hintRung: null, error: null, streaming: true, createdAt: now,
      },
    ]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch(`/api/chat/${chatId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, pullHint }),
        signal: controller.signal,
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
              currentAssistantIdRef.current = newId;
              liveTurnIdsRef.current.add(newId);
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
      // A deliberate Stop click aborts the fetch — that's not a failure, so
      // it shouldn't show an error banner over whatever text already
      // streamed in; just end the turn where it stands.
      if (err instanceof DOMException && err.name === "AbortError") {
        patchTurn(assistantTurnId, (t) => ({ ...t, streaming: false }));
      } else {
        const message = err instanceof Error ? err.message : String(err);
        patchTurn(assistantTurnId, (t) => ({ ...t, error: message, streaming: false }));
      }
    } finally {
      abortControllerRef.current = null;
      liveTurnIdsRef.current.delete(assistantTurnId);
      currentAssistantIdRef.current = null;
      setBusy(false);
    }
  }

  /**
   * Stop generating. Aborts THIS tab's own reader loop immediately (same as
   * before — no error banner, the turn just ends where it stands), but that
   * alone no longer reaches the server: generation is deliberately decoupled
   * from the client connection (see the chat route's genController), so a
   * disconnect is never mistaken for an intentional stop. The explicit call
   * to the `stop` route is what actually cancels generation server-side.
   */
  function stop() {
    abortControllerRef.current?.abort();
    const messageId = currentAssistantIdRef.current;
    if (messageId) {
      fetch(`/api/chat/${chatId}/messages/${messageId}/stop`, { method: "POST" }).catch(
        (err: unknown) => console.error(`stop request failed for message ${messageId}:`, err),
      );
    }
  }

  /**
   * Retry (testing-support feature — ships properly later): always discards
   * whatever came after the retried point and resends the ORIGINAL input
   * text fresh, never reusing the old output. Retrying an assistant turn
   * resends the user turn right before it; retrying a user turn resends
   * itself. Either way this truncates the chat back to just before that
   * user turn on the server, so anything after it — including later
   * turns — is genuinely gone, not just hidden.
   */
  async function retryFrom(turn: Turn) {
    if (busy) return;
    const userTurn = turn.role === "user"
      ? turn
      : turns.slice(0, turns.indexOf(turn)).reverse().find((t) => t.role === "user");
    if (!userTurn) return;

    if (!(await confirm("Retry this message? Everything after it will be discarded."))) return;

    const res = await fetch(`/api/chat/${chatId}/messages/${userTurn.id}`, { method: "DELETE" });
    if (!res.ok) return;

    const idx = turns.indexOf(userTurn);
    setTurns((ts) => ts.slice(0, idx));

    if (userTurn.text === HINT_PLACEHOLDER) {
      await send(true);
    } else {
      await send(false, userTurn.text);
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

              {!loading && !loadError && visibleTurns.map((t, i) => {
                const paired = visibleTurns[i + 1];
                const canRetry = t.role === "assistant"
                  ? !t.streaming
                  : paired?.role === "assistant" && !paired.streaming;
                return (
                  <TurnView
                    key={t.id}
                    turn={t}
                    canRetry={canRetry}
                    disabled={busy}
                    onRetry={() => void retryFrom(t)}
                  />
                );
              })}
            </div>
          </div>

          <div className="px-6 py-4">
            <div className="chat-column">
              {/* Sits above the composer, outside its border — hint to the
                  left, model picker to the right. */}
              <div className="mb-1.5 flex items-center justify-between px-1">
                <HintControl rung={rung} canEscalate={canEscalate} disabled={busy} onPull={() => void send(true)} />
                {!hasOwnKey && (
                  <ModelPicker
                    model={model}
                    thinkingEnabled={thinkingEnabled}
                    onChange={(next) => void changeModel(next)}
                    // Also disabled while `loading`: the history fetch for a
                    // just-switched-to chat hasn't hydrated model/thinkingEnabled
                    // yet, so a click here would PATCH this chatId using the
                    // PREVIOUS chat's (or first-mount default) stale values.
                    disabled={busy || loading}
                  />
                )}
              </div>
              <div className="relative rounded-2xl border border-border bg-surface p-2.5">
                {mathCategory ? (
                  <MathFieldSurface
                    category={MATH_CATEGORIES.find((c) => c.id === mathCategory)!}
                    onCancel={() => setMathCategory(null)}
                    onDone={(latex) => {
                      const { start, end } = mathInsertPoint.current;
                      const { value: next, cursor } = wrapMathForInsertion(input, start, end, latex);
                      setInput(next);
                      setMathCategory(null);
                      requestAnimationFrame(() => {
                        textareaRef.current?.focus();
                        textareaRef.current?.setSelectionRange(cursor, cursor);
                      });
                    }}
                  />
                ) : (
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
                      {busy ? (
                        <button
                          type="button"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fg text-bg hover:opacity-80"
                          onClick={stop}
                          title="Stop generating"
                          aria-label="Stop generating"
                        >
                          <span className="h-2.5 w-2.5 rounded-[2px] bg-bg" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="shrink-0 rounded-md bg-transparent px-2 py-1.5 text-xl leading-none text-fg hover:bg-bg disabled:cursor-default disabled:opacity-50"
                          onClick={() => void send(false)}
                          disabled={!input.trim()}
                          title="Send"
                          aria-label="Send"
                        >
                          ⏎
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {/* Sits below the composer, outside its border. */}
              <div className="mt-1.5 flex items-center gap-1 px-1">
                <MathInputBar
                  activeCategory={mathCategory}
                  onSelectCategory={(id) => {
                    if (id) {
                      mathInsertPoint.current = {
                        start: textareaRef.current?.selectionStart ?? input.length,
                        end: textareaRef.current?.selectionEnd ?? input.length,
                      };
                    }
                    setMathCategory(id);
                  }}
                  disabled={busy}
                />
                <CalculatorButton />
                <span className="ml-auto text-xs text-fg-muted">
                  LLMs can make mistakes. Please double-check responses.
                </span>
              </div>
            </div>
          </div>
        </div>

        {artifactPreviewOpen && <ArtifactPreviewPanel onClose={() => setArtifactPreviewOpen(false)} />}
      </div>
    </main>
  );
}
