"use client";

import { SourcesPanel } from "./SourcesPanel";

/**
 * The "Feeds" affordance. A drawer rather than its own page: adding an ICS URL
 * is something you do once and then check on when a date looks stale, which is
 * always while looking at the calendar.
 */
export function FeedsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-30 flex justify-end" data-testid="feeds-drawer">
      <button
        type="button"
        aria-label="Close feeds"
        onClick={onClose}
        className="flex-1 cursor-default bg-fg/20"
      />
      <div className="flex h-full w-96 max-w-full flex-col gap-4 overflow-y-auto border-l border-border bg-surface p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-fg">Feeds</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close feeds"
            className="rounded-md px-1.5 py-0.5 text-fg-muted hover:bg-bg hover:text-fg"
          >
            ×
          </button>
        </div>
        <SourcesPanel />
      </div>
    </div>
  );
}
