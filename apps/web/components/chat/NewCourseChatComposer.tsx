"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Starts a chat scoped to this course. Creates the chat, then hands the
 * typed text to the chat page as a prefilled draft (`?draft=`) rather than
 * sending it itself — the student still presses Send there, so a slow
 * network doesn't silently drop their first message.
 */
export function NewCourseChatComposer({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function start() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId }),
      });
      if (!res.ok) throw new Error(`failed to create chat (${res.status})`);
      const { id } = (await res.json()) as { id: string };
      const draft = text.trim();
      router.push(draft ? `/chats/${id}?draft=${encodeURIComponent(draft)}` : `/chats/${id}`);
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-2.5">
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // `e.keyCode` is deprecated but kept as a fallback: some IMEs and
            // virtual keyboards report `key: "Unidentified"` for Enter/Return.
            if ((e.key === "Enter" || e.keyCode === 13) && !e.shiftKey) {
              e.preventDefault();
              void start();
            }
          }}
          placeholder="How can I help you today?"
          disabled={busy}
          rows={1}
          className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-base text-fg placeholder:text-fg-muted focus:outline-none disabled:opacity-60"
        />
        <button
          type="button"
          className="shrink-0 rounded-md bg-transparent px-2 py-1.5 text-xl leading-none text-fg hover:bg-bg disabled:cursor-default disabled:opacity-50"
          onClick={() => void start()}
          disabled={busy}
          title="Start chat"
          aria-label="Start chat"
        >
          ⏎
        </button>
      </div>
    </div>
  );
}
