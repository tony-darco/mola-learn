"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ModelPicker } from "./ModelPicker";
import { MathInputBar } from "./MathInputBar";
import { CalculatorButton } from "./CalculatorButton";
import { MathFieldSurface } from "./MathFieldSurface";
import { MATH_CATEGORIES, wrapMathForInsertion } from "./math-symbols";

/**
 * Starts a chat, optionally scoped to a course. Creates the chat, then hands
 * the typed text to the chat page via `?draft=`, which sends it immediately
 * once that page's own history load settles (ChatMain) — so pressing Enter
 * here starts the conversation in one step rather than requiring a second
 * Enter on the chat page.
 */
export function NewCourseChatComposer({
  courseId, placeholder, defaultModel = "qwen3.6:27b", defaultThinkingEnabled = true, hasOwnKey = false,
  prefillText, prefillToken,
}: {
  courseId?: string;
  placeholder?: string;
  /** The signed-in user's current default (server-fetched by the page) — what a fresh composer starts on. */
  defaultModel?: string;
  defaultThinkingEnabled?: boolean;
  /** A BYOK user's model/thinking choice has no effect (resolveProvider ignores it for OpenAI/Anthropic) — hide the picker rather than show one that silently does nothing. */
  hasOwnKey?: boolean;
  /**
   * External text insertion (e.g. the landing page's suggestion pills).
   * `prefillToken` must change on every insert — including re-picking the
   * same suggestion twice — since the effect below keys off it, not
   * `prefillText`, so a repeat pick still overwrites anything the user typed.
   */
  prefillText?: string;
  prefillToken?: number;
}) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState(defaultModel);
  const [thinkingEnabled, setThinkingEnabled] = useState(defaultThinkingEnabled);
  const [mathCategory, setMathCategory] = useState<string | null>(null);
  const mathInsertPoint = useRef({ start: 0, end: 0 });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (prefillToken === undefined) return;
    setText(prefillText ?? "");
    textareaRef.current?.focus();
  }, [prefillToken]);

  async function start() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(courseId ? { courseId } : {}), model, thinkingEnabled }),
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
    <div>
      {/* Sits above the composer, outside its border, right-aligned — see ChatMain. */}
      {!hasOwnKey && (
        <div className="mb-1.5 flex items-center justify-end px-1">
          <ModelPicker
            model={model}
            thinkingEnabled={thinkingEnabled}
            onChange={(next) => { setModel(next.model); setThinkingEnabled(next.thinkingEnabled); }}
            disabled={busy}
          />
        </div>
      )}
      <div className="relative rounded-2xl border border-border bg-surface p-2.5">
        {mathCategory ? (
          <MathFieldSurface
            category={MATH_CATEGORIES.find((c) => c.id === mathCategory)!}
            onCancel={() => setMathCategory(null)}
            onDone={(latex) => {
              const { start, end } = mathInsertPoint.current;
              const { value: next, cursor } = wrapMathForInsertion(text, start, end, latex);
              setText(next);
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
              placeholder={placeholder ?? "How can I help you today?"}
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
        )}
      </div>
      {/* Sits below the composer, outside its border. */}
      <div className="mt-1.5 flex items-center gap-1 px-1">
        <MathInputBar
          activeCategory={mathCategory}
          onSelectCategory={(id) => {
            if (id) {
              mathInsertPoint.current = {
                start: textareaRef.current?.selectionStart ?? text.length,
                end: textareaRef.current?.selectionEnd ?? text.length,
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
  );
}
