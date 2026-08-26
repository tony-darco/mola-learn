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
      <div className="activity-row activity-row-subagent">
        <span className="activity-icon">{entry.status === "running" ? "◐" : "◆"}</span>
        <span>{entry.label}</span>
        {entry.status === "running" && <span className="activity-spinner" aria-hidden />}
      </div>
    );
  }

  const canExpand = Boolean(entry.summary);
  return (
    <div className="activity-row activity-row-tool">
      <button
        type="button"
        className="activity-row-header"
        onClick={() => canExpand && setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="activity-icon">
          {entry.status === "running" ? "◐" : entry.status === "error" ? "✕" : "✓"}
        </span>
        <span>{entry.label}</span>
        {canExpand && <span className="activity-caret">{open ? "▾" : "▸"}</span>}
      </button>
      {open && entry.summary && <div className="activity-detail">{entry.summary}</div>}
    </div>
  );
}
