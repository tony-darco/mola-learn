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
    <div className="compacted-banner">
      <div className="compacted-banner-row">
        <span>
          {hiddenCount} earlier message{hiddenCount === 1 ? "" : "s"} summarized
        </span>
        <button type="button" onClick={() => setShowSummary((s) => !s)}>
          {showSummary ? "Hide summary" : "Show summary"}
        </button>
        <button type="button" onClick={onToggle}>
          {expanded ? "Collapse raw messages" : "Show raw messages"}
        </button>
      </div>
      {showSummary && <div className="compacted-summary">{boundary.summary}</div>}
    </div>
  );
}
