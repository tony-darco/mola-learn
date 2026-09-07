"use client";

// TODO(J1 merge): `components/calendar/SourcesPanel.tsx` is Agent J1's file and
// does not exist in this worktree yet, so the import below is commented rather
// than broken — an import of a missing module fails `pnpm typecheck`, and a
// stub file here would collide with J1's real one at merge. On merge, delete
// the placeholder in the body and restore these two lines:
//
//   import { SourcesPanel } from "./SourcesPanel";
//   ... <SourcesPanel /> in place of <MissingSourcesPanel />
//
// Contract D fixes the shape J1 renders from:
//   CalendarSourceView = { id, kind, name, url, status, lastSyncedAt,
//                          lastSyncError, channelExpiresAt, eventCount }

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
        <MissingSourcesPanel />
      </div>
    </div>
  );
}

/** Placeholder for J1's SourcesPanel — see the TODO at the top of this file. */
function MissingSourcesPanel() {
  return (
    <div className="rounded-xl border border-border bg-bg p-4">
      <p className="m-0 text-sm text-fg">Calendar feed management is not wired up in this build.</p>
      <p className="mt-2 text-sm text-fg-muted">
        Connecting a Blackboard ICS feed or a Google Calendar lands with the calendar
        ingestion workstream. Until then the calendar renders whatever is already in
        your schedule.
      </p>
    </div>
  );
}
