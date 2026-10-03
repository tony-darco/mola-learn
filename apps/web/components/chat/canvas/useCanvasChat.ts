"use client";

import { useRef, useState } from "react";
import type { CanvasElement } from "@mola/shared";
import {
  parseCanvasChatEvents, type CanvasChatMessage, type CanvasChatRequest, type CanvasContext, type CanvasEditsResponse,
} from "@/lib/canvas/chat";
import type { Rect } from "@/lib/canvas/marquee";

export type CanvasTurn = {
  id: string;
  /** "event": an entry in the edit log — a change to the board, between the turns. */
  role: "user" | "assistant" | "event";
  text: string;
  /** User turns: what the model was shown with this message — null until the server says. */
  context: CanvasContext | null;
  streaming: boolean;
  error: string | null;
};

function fromStored(m: CanvasChatMessage): CanvasTurn {
  if (m.role === "event") return { id: m.id, role: "event", text: m.content, context: null, streaming: false, error: null };
  return {
    id: m.id, role: m.role, text: m.content, context: m.canvasContext,
    streaming: false, error: m.status === "error" ? m.errorMessage : null,
  };
}

/** `entries` written into `ts`: a rewritten one in place, a new one at the end — or just before `before`, the turn they came ahead of. */
function withEntries(ts: CanvasTurn[], entries: CanvasChatMessage[], before?: string): CanvasTurn[] {
  let out = ts;
  for (const entry of entries.map(fromStored)) {
    if (out.some((t) => t.id === entry.id)) out = out.map((t) => (t.id === entry.id ? entry : t));
    else {
      const at = before ? out.findIndex((t) => t.id === before) : -1;
      out = at < 0 ? [...out, entry] : [...out.slice(0, at), entry, ...out.slice(at)];
    }
  }
  return out;
}

/**
 * The canvas's conversation (app/api/canvas/[canvasId]/chat): loaded once on
 * first use, then sent to and streamed into — and, after every save, its
 * edit log brought up to the board (syncEdits). What the AI puts on the
 * board while it replies goes to `onAIElement`, with the reply's id.
 */
export function useCanvasChat(canvasId: string, onAIElement: (messageId: string, element: CanvasElement) => void) {
  const onAIElementRef = useRef(onAIElement);
  onAIElementRef.current = onAIElement;
  const [turns, setTurns] = useState<CanvasTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadRef = useRef<Promise<void> | null>(null);
  const busyRef = useRef(false);
  /** Whether this canvas has a chat to log into: unknown until the server says; a first message makes one. */
  const hasChatRef = useRef<boolean | null>(null);
  const syncRef = useRef<{ running: Promise<void> | null; again: boolean }>({ running: null, again: false });

  function ensureLoaded(): Promise<void> {
    loadRef.current ??= (async () => {
      try {
        const res = await fetch(`/api/canvas/${canvasId}/chat`);
        if (!res.ok) throw new Error(`request failed (${res.status})`);
        const data = (await res.json()) as { chatId: string | null; messages: CanvasChatMessage[] };
        hasChatRef.current ??= data.chatId !== null;
        setTurns(data.messages.map(fromStored));
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return loadRef.current;
  }

  function patch(id: string, fn: (t: CanvasTurn) => CanvasTurn) {
    setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
  }

  /**
   * Brings the edit log up to the board as saved — call after each save that
   * went through. One request at a time: asked again meanwhile, it runs once
   * more when that one is done, which covers every save in between.
   */
  function syncEdits(): void {
    const sync = syncRef.current;
    if (hasChatRef.current === false) return;
    if (sync.running) { sync.again = true; return; }
    sync.running = (async () => {
      try {
        const res = await fetch(`/api/canvas/${canvasId}/chat/edits`, { method: "POST" });
        if (!res.ok) return;
        const data = (await res.json()) as CanvasEditsResponse;
        if (data.chatId === null) hasChatRef.current = false;
        // Not loaded yet: loading brings these with it. Loading now: they go in after it.
        if (data.entries.length > 0 && loadRef.current) {
          await loadRef.current;
          setTurns((ts) => withEntries(ts, data.entries));
        }
      } catch {
        // The next save tries again, and the next message catches the log up regardless.
      } finally {
        sync.running = null;
        if (sync.again) { sync.again = false; syncEdits(); }
      }
    })();
  }

  /** `rect`: the selection the message is about, in world coordinates; null asks about the whole canvas. */
  async function send(message: string, rect: Rect | null) {
    const text = message.trim();
    if (!text || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    await ensureLoaded();
    // Entries already on their way belong before this message.
    while (syncRef.current.running) await syncRef.current.running;

    let userId = `local-user-${Date.now()}`;
    let assistantId = `local-assistant-${Date.now()}`;
    setTurns((ts) => [
      ...ts,
      { id: userId, role: "user", text, context: null, streaming: false, error: null },
      { id: assistantId, role: "assistant", text: "", context: null, streaming: true, error: null },
    ]);

    try {
      const body: CanvasChatRequest = rect ? { message: text, selection: { rect } } : { message: text };
      const res = await fetch(`/api/canvas/${canvasId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) throw new Error(`request failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseCanvasChatEvents(buffer);
        buffer = rest;
        for (const ev of events) {
          switch (ev.type) {
            case "canvas_context": {
              const [localUser, localAssistant] = [userId, assistantId];
              userId = ev.userMessageId;
              assistantId = ev.messageId;
              hasChatRef.current = true;
              const context = { text: ev.text, region: ev.region, changes: ev.changes };
              setTurns((ts) => withEntries(ts, ev.edits, localUser).map((t) => (
                t.id === localUser ? { ...t, id: userId, context } : t.id === localAssistant ? { ...t, id: assistantId } : t
              )));
              break;
            }
            case "text_delta":
              patch(assistantId, (t) => ({ ...t, text: t.text + ev.text }));
              break;
            case "annotation":
              onAIElementRef.current(assistantId, ev.element);
              break;
            case "message_end":
              patch(assistantId, (t) => ({ ...t, streaming: false }));
              break;
            case "error":
              patch(assistantId, (t) => ({ ...t, error: ev.message, streaming: false }));
              break;
          }
        }
      }
    } catch (err) {
      patch(assistantId, (t) => ({ ...t, error: err instanceof Error ? err.message : String(err) }));
    } finally {
      patch(assistantId, (t) => ({ ...t, streaming: false }));
      busyRef.current = false;
      setBusy(false);
    }
  }

  return { turns, busy, loadError, ensureLoaded, send, syncEdits };
}
