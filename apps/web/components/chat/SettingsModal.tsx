"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useRefreshSidebar } from "./shell-context";

type PublicApiKey = { provider: string; lastFour: string };
type Term = { id: string; label: string };
type Course = { id: string; name: string; number: string | null; professor: string | null; termId: string | null };
type Profile = { name: string; university: string | null; year: string | null };

const PROVIDER_LABEL: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic" };
const YEAR_LABEL: Record<string, string> = {
  first: "First year", second: "Second year", third: "Third year",
  fourth: "Fourth year", fifth: "Fifth year",
};

const SECTIONS = [
  { key: "general", label: "General" },
  { key: "account", label: "Account" },
  { key: "courses", label: "Courses" },
  { key: "memory", label: "Memory" },
  { key: "apiKeys", label: "API Keys" },
] as const;

export type SettingsSection = (typeof SECTIONS)[number]["key"];

export function SettingsModal({
  open, onClose, initialSection = "general",
}: { open: boolean; onClose: () => void; initialSection?: SettingsSection }) {
  const router = useRouter();
  const refreshSidebar = useRefreshSidebar();
  const [section, setSection] = useState<SettingsSection>(initialSection);

  // ── API keys ────────────────────────────────────────────────────────────
  const [apiKey, setApiKey] = useState<PublicApiKey | null>(null);
  const [loadingKey, setLoadingKey] = useState(true);
  const [keyBusy, setKeyBusy] = useState(false);
  const [ownKey, setOwnKey] = useState(false);
  const [provider, setProvider] = useState<string>("openai");
  const [key, setKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);

  // ── Courses ──────────────────────────────────────────────────────────────
  const [courseTerms, setCourseTerms] = useState<Term[]>([]);
  const [courseList, setCourseList] = useState<Course[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [courseBusy, setCourseBusy] = useState(false);
  const [courseError, setCourseError] = useState<string | null>(null);
  const courseFormRef = useRef<HTMLFormElement>(null);

  // ── Account ──────────────────────────────────────────────────────────────
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileTerms, setProfileTerms] = useState<Term[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [newTermLabel, setNewTermLabel] = useState("");

  useEffect(() => {
    if (open) setSection(initialSection);
    // Only meant to seed the section when the modal opens, not to fight the
    // user's own clicks in the sidebar afterward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || section !== "apiKeys") return;
    setLoadingKey(true);
    setKeyError(null);
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { apiKey: PublicApiKey | null } | null) => {
        if (data) {
          setApiKey(data.apiKey);
          setOwnKey(data.apiKey !== null);
        }
      })
      .finally(() => setLoadingKey(false));
  }, [open, section]);

  useEffect(() => {
    if (!open || section !== "courses") return;
    setLoadingCourses(true);
    setCourseError(null);
    fetch("/api/courses")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { terms: Term[]; courses: Course[] } | null) => {
        if (data) {
          setCourseTerms(data.terms);
          setCourseList(data.courses);
        }
      })
      .finally(() => setLoadingCourses(false));
  }, [open, section]);

  useEffect(() => {
    if (!open || section !== "account") return;
    setLoadingProfile(true);
    setProfileError(null);
    fetch("/api/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { user: Profile; terms: Term[] } | null) => {
        if (data) {
          setProfile(data.user);
          setProfileTerms(data.terms);
        }
      })
      .finally(() => setLoadingProfile(false));
  }, [open, section]);

  if (!open) return null;

  async function handleSaveKey() {
    setKeyBusy(true);
    setKeyError(null);
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
      setKeyError(err instanceof Error ? err.message : "failed to save");
    } finally {
      setKeyBusy(false);
    }
  }

  async function handleUseLocalModel() {
    if (!apiKey) {
      setOwnKey(false);
      return;
    }
    setKeyBusy(true);
    setKeyError(null);
    try {
      const res = await fetch("/api/settings", { method: "DELETE" });
      if (!res.ok) throw new Error("failed to remove key");
      setApiKey(null);
      setOwnKey(false);
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : "failed to remove key");
    } finally {
      setKeyBusy(false);
    }
  }

  async function handleCreateCourse(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCourseBusy(true);
    setCourseError(null);
    try {
      const formData = new FormData(e.currentTarget);
      const res = await fetch("/api/courses", { method: "POST", body: formData });
      const data = (await res.json()) as { course?: Course; error?: string };
      if (!res.ok) throw new Error(data.error ?? "failed to create course");
      setCourseList((prev) => [...prev, data.course!]);
      courseFormRef.current?.reset();
      refreshSidebar();
    } catch (err) {
      setCourseError(err instanceof Error ? err.message : "failed to create course");
    } finally {
      setCourseBusy(false);
    }
  }

  function goToCourse(id: string) {
    onClose();
    router.push(`/courses/${id}`);
  }

  async function handleSaveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProfileBusy(true);
    setProfileError(null);
    try {
      const formData = new FormData(e.currentTarget);
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          university: formData.get("university"),
          year: formData.get("year"),
        }),
      });
      if (!res.ok) throw new Error("failed to save profile");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "failed to save profile");
    } finally {
      setProfileBusy(false);
    }
  }

  async function handleAddTerm() {
    if (!newTermLabel.trim()) return;
    setProfileBusy(true);
    setProfileError(null);
    try {
      const res = await fetch("/api/profile/terms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: newTermLabel.trim() }),
      });
      const data = (await res.json()) as { terms?: Term[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "failed to add term");
      setProfileTerms(data.terms ?? []);
      setNewTermLabel("");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "failed to add term");
    } finally {
      setProfileBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[min(640px,58vh)] w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="flex w-64 shrink-0 flex-col gap-1.5 border-r border-border bg-sidebar p-5">
          <div className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Settings</div>
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSection(s.key)}
              className={`rounded-md px-3.5 py-2.5 text-left text-xs ${
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
              <h2 className="mb-1 text-sm font-semibold text-fg">General</h2>
              <p className="text-xs text-fg-muted">Appearance and font settings — coming soon.</p>
            </div>
          )}

          {section === "account" && (
            <div className="max-w-lg">
              <h2 className="mb-1 text-sm font-semibold text-fg">Account</h2>
              <p className="mb-4 text-xs text-fg-muted">Your info, and the terms your courses belong to.</p>

              {loadingProfile || !profile ? (
                <p className="text-xs text-fg-muted">Loading…</p>
              ) : (
                <>
                  <form onSubmit={(e) => void handleSaveProfile(e)} className="mb-6 flex flex-col gap-3">
                    <label className="flex flex-col gap-1.5 text-[13px] text-fg-muted">
                      Name
                      <input name="name" defaultValue={profile.name ?? ""} required className="rounded-lg border border-border bg-bg px-2.5 py-2 text-xs text-fg" />
                    </label>
                    <label className="flex flex-col gap-1.5 text-[13px] text-fg-muted">
                      University
                      <input name="university" defaultValue={profile.university ?? ""} className="rounded-lg border border-border bg-bg px-2.5 py-2 text-xs text-fg" />
                    </label>
                    <label className="flex flex-col gap-1.5 text-[13px] text-fg-muted">
                      Year
                      <select name="year" defaultValue={profile.year ?? ""} className="rounded-lg border border-border bg-bg px-2.5 py-2 text-xs text-fg">
                        <option value="">—</option>
                        {Object.entries(YEAR_LABEL).map(([value, text]) => (
                          <option key={value} value={value}>{text}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="submit"
                      disabled={profileBusy}
                      className="self-start rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-accent-fg disabled:opacity-50"
                    >
                      Save
                    </button>
                  </form>

                  <div className="border-t border-border pt-4">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">Terms</div>
                    <div className="mb-3 flex gap-2">
                      <input
                        value={newTermLabel}
                        onChange={(e) => setNewTermLabel(e.target.value)}
                        placeholder="Fall 2026"
                        className="flex-1 rounded-lg border border-border bg-bg px-2.5 py-2 text-xs text-fg"
                      />
                      <button
                        type="button"
                        onClick={() => void handleAddTerm()}
                        disabled={profileBusy || !newTermLabel.trim()}
                        className="rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-accent-fg disabled:opacity-50"
                      >
                        Add term
                      </button>
                    </div>
                    {profileTerms.length === 0 ? (
                      <p className="text-xs text-fg-muted">No terms yet.</p>
                    ) : (
                      <ul className="flex flex-col gap-1 text-xs text-fg">
                        {profileTerms.map((t) => (
                          <li key={t.id}>{t.label}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {profileError && <p className="mt-3 text-[13px] text-red-600 dark:text-red-400">{profileError}</p>}
                </>
              )}
            </div>
          )}

          {section === "courses" && (
            <div className="max-w-lg">
              <h2 className="mb-1 text-sm font-semibold text-fg">Courses</h2>
              <p className="mb-4 text-xs text-fg-muted">Add a course, or jump to one you already have.</p>

              {loadingCourses ? (
                <p className="text-xs text-fg-muted">Loading…</p>
              ) : (
                <>
                  {courseTerms.length === 0 ? (
                    <p className="mb-4 text-xs text-fg-muted">
                      You need a term first — add one under{" "}
                      <button type="button" onClick={() => setSection("account")} className="text-accent underline">
                        Account
                      </button>
                      .
                    </p>
                  ) : (
                    <form ref={courseFormRef} onSubmit={(e) => void handleCreateCourse(e)} encType="multipart/form-data" className="mb-6 flex flex-col gap-3">
                      <label className="flex flex-col gap-1.5 text-[13px] text-fg-muted">
                        Course name
                        <input name="name" type="text" required placeholder="Operating Systems" className="rounded-lg border border-border bg-bg px-2.5 py-2 text-xs text-fg" />
                      </label>
                      <label className="flex flex-col gap-1.5 text-[13px] text-fg-muted">
                        Course number
                        <input name="number" type="text" placeholder="CMSC 421" className="rounded-lg border border-border bg-bg px-2.5 py-2 text-xs text-fg" />
                      </label>
                      <label className="flex flex-col gap-1.5 text-[13px] text-fg-muted">
                        Professor
                        <input name="professor" type="text" placeholder="Dr. Antero" className="rounded-lg border border-border bg-bg px-2.5 py-2 text-xs text-fg" />
                      </label>
                      <label className="flex flex-col gap-1.5 text-[13px] text-fg-muted">
                        Term
                        <select name="termId" required className="rounded-lg border border-border bg-bg px-2.5 py-2 text-xs text-fg">
                          {courseTerms.map((t) => (
                            <option key={t.id} value={t.id}>{t.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1.5 text-[13px] text-fg-muted">
                        Syllabus
                        <input name="syllabus" type="file" accept=".pdf,.doc,.docx,.txt" className="text-xs text-fg" />
                        <span className="text-xs text-fg-muted">Optional here, but without it there&rsquo;s nothing to generate a summary from.</span>
                      </label>
                      <button
                        type="submit"
                        disabled={courseBusy}
                        className="self-start rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-accent-fg disabled:opacity-50"
                      >
                        Create course
                      </button>
                      {courseError && <p className="text-[13px] text-red-600 dark:text-red-400">{courseError}</p>}
                    </form>
                  )}

                  <div className="border-t border-border pt-4">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">Your courses</div>
                    {courseList.length === 0 ? (
                      <p className="text-xs text-fg-muted">No courses yet.</p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {courseList.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => goToCourse(c.id)}
                            className="rounded-md px-2.5 py-1.5 text-left text-xs text-fg hover:bg-bg"
                          >
                            {c.number ? `${c.number} — ` : ""}{c.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {section === "memory" && (
            <div className="max-w-md">
              <h2 className="mb-1 text-sm font-semibold text-fg">Memory</h2>
              <p className="text-xs text-fg-muted">Nothing here yet.</p>
            </div>
          )}

          {section === "apiKeys" && (
            <div className="max-w-md">
              <h2 className="mb-1 text-sm font-semibold text-fg">API keys</h2>
              <p className="mb-4 text-xs text-fg-muted">Choose the model this chat runs on.</p>

              {loadingKey ? (
                <p className="text-xs text-fg-muted">Loading…</p>
              ) : (
                <div className="flex flex-col gap-3">
                  <label className="flex items-center gap-2 text-xs text-fg">
                    <input
                      type="radio"
                      name="modelSource"
                      checked={!ownKey}
                      onChange={() => void handleUseLocalModel()}
                      disabled={keyBusy}
                    />
                    Local model (default) — Ollama, self-hosted
                  </label>
                  <label className="flex items-center gap-2 text-xs text-fg">
                    <input
                      type="radio"
                      name="modelSource"
                      checked={ownKey}
                      onChange={() => setOwnKey(true)}
                      disabled={keyBusy}
                    />
                    My own API key
                  </label>

                  {ownKey && (
                    <div className="ml-6 flex flex-col gap-3 border-l border-border pl-4">
                      {apiKey ? (
                        <div>
                          <p className="mb-2 text-xs text-fg">
                            {PROVIDER_LABEL[apiKey.provider] ?? apiKey.provider} — key ending in{" "}
                            <code className="rounded bg-bg px-1 py-0.5 font-mono text-[13px]">{apiKey.lastFour}</code>
                          </p>
                          <button
                            type="button"
                            onClick={() => void handleUseLocalModel()}
                            disabled={keyBusy}
                            className="text-xs text-accent disabled:opacity-50"
                          >
                            Remove key
                          </button>
                        </div>
                      ) : (
                        <>
                          <label className="flex flex-col gap-1.5 text-[13px] text-fg-muted">
                            Provider
                            <select
                              value={provider}
                              onChange={(e) => setProvider(e.target.value)}
                              className="rounded-lg border border-border bg-bg px-2.5 py-2 text-xs text-fg"
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
                              className="rounded-lg border border-border bg-bg px-2.5 py-2 text-xs text-fg"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => void handleSaveKey()}
                            disabled={keyBusy || !key.trim()}
                            className="self-start rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-accent-fg disabled:opacity-50"
                          >
                            Save
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {keyError && <p className="mt-3 text-[13px] text-red-600 dark:text-red-400">{keyError}</p>}

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
