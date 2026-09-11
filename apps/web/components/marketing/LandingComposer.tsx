"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NewCourseChatComposer } from "@/components/chat/NewCourseChatComposer";

/** sessionStorage key the sign-up wizard's welcome step reads on completion. */
export const PENDING_DRAFT_KEY = "mola:pendingDraft";

/** Example prompts for the "What would you like to study?" pills — illustrative only. */
const SUGGESTIONS = [
  { label: "Quizzes", prompt: "Make a 10-question quiz on photosynthesis." },
  { label: "Flashcards", prompt: "Turn my chapter 3 notes into a flashcard deck." },
  { label: "Mindmaps", prompt: "Map out how supply and demand connect to market equilibrium." },
  { label: "Agents", prompt: "Walk me through solving this integral, step by step." },
] as const;

/**
 * The hero composer on the public landing page. Logged in, it's the exact
 * same "start a chat" flow as the authenticated app's home screen. Logged
 * out, typing and submitting doesn't touch the LLM at all — it stashes the
 * draft and sends the visitor to sign up; the wizard's welcome step picks
 * the draft back up and sends it for real once an account exists.
 *
 * The suggestion pills below the composer just insert an example prompt —
 * same idea either way, only the target composer's state differs.
 */
export function LandingComposer({
  isAuthenticated, defaultModel, defaultThinkingEnabled, hasOwnKey,
}: {
  isAuthenticated: boolean;
  defaultModel?: string;
  defaultThinkingEnabled?: boolean;
  hasOwnKey?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [anonText, setAnonText] = useState("");
  const [prefillText, setPrefillText] = useState("");
  const [prefillToken, setPrefillToken] = useState(0);

  function pick(suggestion: (typeof SUGGESTIONS)[number]) {
    setSelected(suggestion.label);
    if (isAuthenticated) {
      setPrefillText(suggestion.prompt);
      setPrefillToken((t) => t + 1);
    } else {
      setAnonText(suggestion.prompt);
    }
  }

  function goToSignUp() {
    const draft = anonText.trim();
    if (draft) sessionStorage.setItem(PENDING_DRAFT_KEY, draft);
    router.push("/sign-up");
  }

  return (
    <div>
      {isAuthenticated ? (
        <NewCourseChatComposer
          placeholder="What can I help you study?"
          defaultModel={defaultModel}
          defaultThinkingEnabled={defaultThinkingEnabled}
          hasOwnKey={hasOwnKey}
          prefillText={prefillText}
          prefillToken={prefillToken}
        />
      ) : (
        <div className="rounded-2xl border border-border bg-surface p-3.5">
          <div className="flex items-end gap-2">
            <textarea
              value={anonText}
              onChange={(e) => setAnonText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  goToSignUp();
                }
              }}
              placeholder="What can I help you study?"
              rows={1}
              className="max-h-40 flex-1 resize-none bg-transparent px-2 py-2 text-lg text-fg placeholder:text-fg-muted focus:outline-none"
            />
            <button
              type="button"
              className="shrink-0 rounded-md bg-transparent px-2 py-1.5 text-2xl leading-none text-fg hover:bg-bg"
              onClick={goToSignUp}
              title="Sign up to start chatting"
              aria-label="Sign up to start chatting"
            >
              ⏎
            </button>
          </div>
        </div>
      )}

      <div className="mt-4">
        <p className="mb-2 text-sm font-medium text-fg-muted">What would you like to study?</p>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => pick(s)}
              className={`rounded-full border px-4 py-2 text-sm ${
                selected === s.label ? "border-accent text-accent" : "border-border text-fg-muted hover:border-fg hover:text-fg"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
