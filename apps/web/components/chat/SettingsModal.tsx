"use client";

import { useEffect, useState } from "react";

type PublicApiKey = { provider: string; lastFour: string };

const PROVIDER_LABEL: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic" };

/** Section list on the left — just one today; more land here as they're built. */
const SECTIONS = [{ key: "general", label: "General" }] as const;

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [section, setSection] = useState<(typeof SECTIONS)[number]["key"]>("general");
  const [apiKey, setApiKey] = useState<PublicApiKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<string>("openai");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { apiKey: PublicApiKey | null } | null) => {
        if (data) setApiKey(data.apiKey);
      })
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, key }),
      });
      const data = (await res.json()) as { apiKey?: PublicApiKey; error?: string };
      if (!res.ok) throw new Error(data.error ?? "failed to save");
      setApiKey(data.apiKey ?? null);
      setKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", { method: "DELETE" });
      if (!res.ok) throw new Error("failed to remove key");
      setApiKey(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to remove key");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[70vh] w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="flex w-48 shrink-0 flex-col border-r border-border bg-sidebar p-3">
          <div className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Settings</div>
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSection(s.key)}
              className={`rounded-md px-2.5 py-1.5 text-left text-sm ${
                section === s.key ? "bg-bg font-medium text-fg" : "text-fg-muted hover:bg-bg hover:text-fg"
              }`}
            >
              {s.label}
            </button>
          ))}
        </aside>

        <div className="relative flex-1 overflow-y-auto p-6">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-md px-1.5 py-0.5 text-fg-muted hover:bg-bg hover:text-fg"
            aria-label="Close settings"
          >
            ✕
          </button>

          {section === "general" && (
            <div className="max-w-md">
              <h2 className="mb-1 text-lg font-semibold text-fg">Model and provider</h2>
              <p className="mb-4 text-sm text-fg-muted">Chat provider</p>

              {loading ? (
                <p className="text-sm text-fg-muted">Loading…</p>
              ) : apiKey ? (
                <div>
                  <p className="mb-3 text-sm text-fg">
                    {PROVIDER_LABEL[apiKey.provider] ?? apiKey.provider} — key ending in{" "}
                    <code className="rounded bg-bg px-1 py-0.5 font-mono text-[13px]">{apiKey.lastFour}</code>
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleRemove()}
                    disabled={busy}
                    className="text-sm text-accent disabled:opacity-50"
                  >
                    Remove key (revert to Ollama)
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-fg-muted">
                    Using the platform default (Ollama, self-hosted). Add your own key to switch providers.
                  </p>
                  <label className="flex flex-col gap-1.5 text-[13px] text-fg-muted">
                    Provider
                    <select
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                      className="rounded-lg border border-border bg-bg px-2.5 py-2 text-sm text-fg"
                    >
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5 text-[13px] text-fg-muted">
                    API key
                    <input
                      type="password"
                      autoComplete="off"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      className="rounded-lg border border-border bg-bg px-2.5 py-2 text-sm text-fg"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={busy || !key.trim()}
                    className="self-start rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-accent-fg disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              )}

              {error && <p className="mt-3 text-[13px] text-red-600 dark:text-red-400">{error}</p>}

              <p className="mt-6 text-xs text-fg-muted">
                Keys are encrypted at rest and never shown again after saving — only the last four
                characters are kept for display. BYOK covers chat completions only; embeddings always
                run on the platform&rsquo;s self-hosted model, never your key.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
