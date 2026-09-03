"use client";

import { useState } from "react";
import type { CompactionBoundary } from "./types";

/**
 * The compact-boundary affordance (§4). Nothing is ever deleted — the raw
 * turns folded into `boundary.summary` are still in `hiddenCount` and get
 * rendered in place when expanded. This banner is purely a client-side
 * fold/unfold over turns already fetched; expanding never issues a request.
 */
export function CompactedBanner({
  boundary,
  hiddenCount,
  expanded,
  onToggle,
}: {
  boundary: CompactionBoundary;
  hiddenCount: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [showSummary, setShowSummary] = useState(false);

  return (
    <div data-testid="compacted-banner" className="mb-4 rounded-lg border border-border bg-surface px-3.5 py-2.5">
      <div className="flex items-center gap-3 text-sm text-fg-muted">
        <span>
          {hiddenCount} earlier message{hiddenCount === 1 ? "" : "s"} summarized
        </span>
        <button type="button" className="text-sm text-accent" onClick={() => setShowSummary((s) => !s)}>
          {showSummary ? "Hide summary" : "Show summary"}
        </button>
        <button type="button" className="text-sm text-accent" onClick={onToggle}>
          {expanded ? "Collapse raw messages" : "Show raw messages"}
        </button>
      </div>
      {showSummary && (
        <div className="mt-2 whitespace-pre-wrap border-t border-border pt-2 text-sm text-fg">
          {boundary.summary}
        </div>
      )}
    </div>
  );
}
