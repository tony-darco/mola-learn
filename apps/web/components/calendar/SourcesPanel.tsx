"use client";

/**
 * Feed management: the ICS feeds a student has subscribed, plus the Google
 * connection, with per-source sync state.
 *
 * Self-contained on purpose — it takes no props and fetches its own data, so
 * the `/calendar` page can mount it without knowing anything about calendar
 * sources.
 *
 * The state that earns most of this file is `expired`. A Google watch channel
 * lapses within days, and when it does nothing errors: notifications simply
 * stop, the calendar quietly goes stale, and the student finds out by missing a
 * deadline (§10). So an expired source does not get a muted grey label like the
 * others — it gets its own block saying updates have stopped and a reconnect
 * that goes straight back through consent, which is what actually fixes the
 * dead credential underneath.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { timeAgo } from "@/components/chat/time-ago";
import type { CalendarSourceView } from "@/lib/calendar/types";

type GoogleStatus = { configured: boolean; connectedAs: string | null; pushAvailable: boolean };

const AUTHORIZE_URL = "/api/calendar/google/authorize";

const field = "w-full rounded-lg border border-border bg-bg px-2.5 py-2 text-sm text-fg placeholder:text-fg-muted";
const smallButton = "rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted hover:bg-bg hover:text-fg disabled:opacity-50";

export function SourcesPanel() {
  const [sources, setSources] = useState<CalendarSourceView[] | null>(null);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [queuedIds, setQueuedIds] = useState<string[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/calendar/sources");
    if (!res.ok) return;
    const body = (await res.json()) as { sources: CalendarSourceView[] };
    setSources(body.sources);
  }, []);

  useEffect(() => {
    void refresh();
    void fetch("/api/calendar/google/status")
      .then((res) => (res.ok ? (res.json() as Promise<GoogleStatus>) : null))
      .then(setGoogle)
      .catch(() => setGoogle(null));
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [refresh]);

  async function addSource(e: FormEvent) {
    e.preventDefault();
    setAdding(true);
    setFormError(null);
    try {
      const res = await fetch("/api/calendar/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "ics", name: name.trim(), url: url.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(body.error ?? "could not add that feed");
        return;
      }
      setName("");
      setUrl("");
      await refresh();
    } finally {
      setAdding(false);
    }
  }

  async function syncSource(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/calendar/sources/${id}/sync`, { method: "POST" });
      if (!res.ok) return;
      // The sync is a queued job, not this request's work, so the row cannot
      // have changed yet. Saying "queued" and looking again shortly is the
      // honest version of a spinner that would otherwise imply it is done.
      setQueuedIds((ids) => [...ids, id]);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        setQueuedIds([]);
        void refresh();
      }, 3000);
    } finally {
      setBusyId(null);
    }
  }

  async function removeSource(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/calendar/sources/${id}`, { method: "DELETE" });
      if (res.ok) await refresh();
    } finally {
      setBusyId(null);
      setConfirmingId(null);
    }
  }

  return (
    <section data-testid="calendar-sources-panel" className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div>
        <h2 className="text-sm font-semibold text-fg">Calendar feeds</h2>
        <p className="mt-0.5 text-xs text-fg-muted">
          Course deadlines and class times, read from a calendar you already keep.
        </p>
      </div>

      {sources === null ? (
        <p className="text-xs text-fg-muted">Loading feeds…</p>
      ) : sources.length === 0 ? (
        <p className="text-xs text-fg-muted">No feeds yet. Add a Blackboard or course calendar URL below.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sources.map((source) => (
            <li
              key={source.id}
              data-testid="calendar-source-row"
              data-source-id={source.id}
              data-status={source.status}
              className="rounded-lg border border-border bg-bg p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-fg">{source.name}</p>
                  <p className="mt-0.5 truncate text-xs text-fg-muted">
                    {source.kind === "google" ? "Google Calendar" : source.url}
                  </p>
                  <p className="mt-1 text-xs text-fg-muted">
                    {queuedIds.includes(source.id) ? "Sync queued" : statusLine(source)}
                    {" · "}
                    {source.eventCount === 1 ? "1 event" : `${source.eventCount} events`}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="calendar-source-sync"
                    data-source-id={source.id}
                    disabled={busyId === source.id}
                    onClick={() => void syncSource(source.id)}
                    className={smallButton}
                  >
                    Sync now
                  </button>
                  {confirmingId === source.id ? (
                    <button
                      type="button"
                      data-testid="calendar-source-remove-confirm"
                      data-source-id={source.id}
                      disabled={busyId === source.id}
                      onClick={() => void removeSource(source.id)}
                      className="rounded-md bg-accent px-2.5 py-1 text-xs text-accent-fg hover:opacity-90 disabled:opacity-50"
                    >
                      Remove for good
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid="calendar-source-remove"
                      data-source-id={source.id}
                      onClick={() => setConfirmingId(source.id)}
                      className={smallButton}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {confirmingId === source.id && (
                <p className="mt-2 text-xs text-fg-muted">
                  Removing this feed also removes the events it created. Anything you added by hand stays.
                </p>
              )}

              {source.status === "expired" && (
                <div className="mt-2 rounded-md border border-accent/40 bg-accent/5 p-2.5">
                  <p className="text-xs text-fg">
                    Google has stopped sending updates for this calendar. Nothing here has changed
                    {source.lastSyncedAt ? ` since ${timeAgo(source.lastSyncedAt)}` : " yet"}, and it will
                    not until you reconnect.
                  </p>
                  <a
                    href={AUTHORIZE_URL}
                    data-testid="calendar-source-reconnect"
                    data-source-id={source.id}
                    className="mt-2 inline-block rounded-md bg-accent px-2.5 py-1 text-xs text-accent-fg no-underline hover:opacity-90"
                  >
                    Reconnect Google Calendar
                  </a>
                </div>
              )}

              {source.status === "error" && source.lastSyncError && (
                <p className="mt-2 rounded-md border border-accent/40 bg-accent/5 p-2.5 text-xs text-fg">
                  {source.lastSyncError}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={addSource} className="flex flex-col gap-2 border-t border-border pt-4">
        <label className="text-xs font-medium text-fg" htmlFor="calendar-source-name">
          Add a calendar feed
        </label>
        <input
          id="calendar-source-name"
          data-testid="calendar-source-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Blackboard — Fall 2026"
          className={field}
        />
        <input
          id="calendar-source-url"
          data-testid="calendar-source-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://blackboard.umbc.edu/webapps/calendar/…/feed.ics"
          className={field}
        />
        <div className="flex items-center gap-2">
          <button
            type="submit"
            data-testid="calendar-source-add"
            disabled={adding || !name.trim() || !url.trim()}
            className="rounded-md bg-accent px-3 py-1.5 text-xs text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {adding ? "Adding…" : "Add feed"}
          </button>
          <span className="text-xs text-fg-muted">webcal:// links work too.</span>
        </div>
        {formError && (
          <p data-testid="calendar-source-error" className="text-xs text-fg">
            {formError}
          </p>
        )}
      </form>

      <div className="border-t border-border pt-4">{googleSection(google)}</div>
    </section>
  );
}

function statusLine(source: CalendarSourceView): string {
  if (source.status === "expired") return "Reconnect needed";
  if (source.status === "error") return "Last sync failed";
  if (source.status === "disabled") return "Paused";
  return source.lastSyncedAt ? `Synced ${timeAgo(source.lastSyncedAt)}` : "Not synced yet";
}

function googleSection(google: GoogleStatus | null) {
  if (google === null) {
    return <p className="text-xs text-fg-muted">Checking Google Calendar…</p>;
  }

  // Deliberately text, not a disabled button: there is nothing to press, and a
  // greyed-out button invites the student to keep trying it.
  if (!google.configured) {
    return (
      <div data-testid="calendar-google-unconfigured">
        <p className="text-xs text-fg">Google Calendar is not set up on this deployment.</p>
        <p className="mt-1 text-xs text-fg-muted">
          It needs an OAuth client. The steps are in GOOGLE-CALENDAR-SETUP.md at the repository root —
          set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then restart the app.
        </p>
      </div>
    );
  }

  return (
    <div>
      {google.connectedAs ? (
        <p className="text-xs text-fg-muted">
          Connected as <span className="text-fg">{google.connectedAs}</span>.
        </p>
      ) : (
        <p className="text-xs text-fg-muted">Pull class times and deadlines straight from Google Calendar.</p>
      )}
      {!google.pushAvailable && (
        <p className="mt-1 text-xs text-fg-muted">
          This deployment has no public https address, so Google cannot push changes. Calendars still sync
          on a schedule, just not the moment something moves.
        </p>
      )}
      <a
        href={AUTHORIZE_URL}
        data-testid="calendar-google-connect"
        className="mt-2 inline-block rounded-md border border-border px-2.5 py-1 text-xs text-fg no-underline hover:bg-bg"
      >
        {google.connectedAs ? "Reconnect Google Calendar" : "Connect Google Calendar"}
      </a>
    </div>
  );
}
