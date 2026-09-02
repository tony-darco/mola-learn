"use client";

import { Markdown } from "./Markdown";
import { ActivityRow } from "./ActivityRow";
import { ArtifactBlock } from "./artifacts/ArtifactBlock";
import type { Turn } from "./types";

export function TurnView({ turn }: { turn: Turn }) {
  const isUser = turn.role === "user";
  return (
    <div className={`mb-6 flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div className="mb-1 px-1 text-xs font-medium text-fg-muted">{isUser ? "You" : "Mola"}</div>

      <div className={isUser ? "max-w-[85%]" : "w-full"}>
        {turn.activity.map((a) => <ActivityRow key={a.id} entry={a} />)}

        {turn.text && (
          <div className={isUser ? "rounded-2xl border border-border bg-surface px-4 py-2.5" : ""}>
            <Markdown text={turn.text} />
          </div>
        )}
        {!turn.text && turn.streaming && <div className="animate-pulse text-fg-muted">…</div>}

        {turn.artifacts.map((a) => <ArtifactBlock key={a.id} artifact={a} />)}

        {turn.error && (
          <div className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-[13.5px] text-red-700 dark:text-red-400">
            ⚠ {turn.error}
          </div>
        )}
      </div>
    </div>
  );
}
