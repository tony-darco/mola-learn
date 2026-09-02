"use client";

import { useState } from "react";
import type { ActivityEntry } from "./types";

/**
 * Collapsed rows for tool calls and sub-agent runs — the way Claude Code shows
 * tool use. A sub-agent's internals are private by design (§4): this renders
 * only its label and running/done status, never its internal turns.
 */
export function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const [open, setOpen] = useState(false);

  if (entry.kind === "subagent") {
    return (
      <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-md border border-dashed border-border bg-surface px-2.5 py-1 text-[13px] text-fg-muted">
        <span className="text-[11px]">{entry.status === "running" ? "◐" : "◆"}</span>
        <span>{entry.label}</span>
        {entry.status === "running" && (
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
        )}
      </div>
    );
  }

  const canExpand = Boolean(entry.summary);
  return (
    <div className="mb-1.5 text-[13px] text-fg-muted">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-fg-muted disabled:cursor-default"
        onClick={() => canExpand && setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="text-[11px]">
          {entry.status === "running" ? "◐" : entry.status === "error" ? "✕" : "✓"}
        </span>
        <span>{entry.label}</span>
        {canExpand && <span className="text-[10px]">{open ? "▾" : "▸"}</span>}
      </button>
      {open && entry.summary && (
        <div className="ml-1 mt-1 max-w-[480px] rounded-md bg-bg px-2.5 py-2 text-[12.5px]">{entry.summary}</div>
      )}
    </div>
  );
}
