"use client";

import { useRef, useState } from "react";
import {
  parseCanvasChatEvents, type CanvasChatMessage, type CanvasChatRequest, type CanvasContext,
} from "@/lib/canvas/chat";
import type { Rect } from "@/lib/canvas/marquee";

export type CanvasTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** User turns: what the model was shown with this message — null until the server says. */
  context: CanvasContext | null;
  streaming: boolean;
  error: string | null;
};

function fromStored(m: CanvasChatMessage): CanvasTurn {
  return {
    id: m.id, role: m.role, text: m.content, context: m.canvasContext,
    streaming: false, error: m.status === "error" ? m.errorMessage : null,
  };
}

/** The canvas's conversation (app/api/canvas/[canvasId]/chat): loaded once on first use, then sent to and streamed into. */
export function useCanvasChat(canvasId: string) {
  const [turns, setTurns] = useState<CanvasTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadRef = useRef<Promise<void> | null>(null);
  const busyRef = useRef(false);

  function ensureLoaded(): Promise<void> {
    loadRef.current ??= (async () => {
      try {
        const res = await fetch(`/api/canvas/${canvasId}/chat`);
        if (!res.ok) throw new Error(`request failed (${res.status})`);
        const data = (await res.json()) as { messages: CanvasChatMessage[] };
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

  /** `rect`: the selection the message is about, in world coordinates; null asks about the whole canvas. */
  async function send(message: string, rect: Rect | null) {
    const text = message.trim();
    if (!text || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    await ensureLoaded();

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
              const context = { text: ev.text, region: ev.region };
              setTurns((ts) => ts.map((t) => (
                t.id === localUser ? { ...t, id: userId, context } : t.id === localAssistant ? { ...t, id: assistantId } : t
              )));
              break;
            }
            case "text_delta":
              patch(assistantId, (t) => ({ ...t, text: t.text + ev.text }));
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

  return { turns, busy, loadError, ensureLoaded, send };
}
