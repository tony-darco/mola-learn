"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { completeSignupAction } from "@/lib/auth/actions";
import { PENDING_DRAFT_KEY } from "@/components/marketing/LandingComposer";

// Mirrors SUPPORTED_PROVIDERS in lib/auth/api-keys.ts — kept as a separate,
// client-safe list since that module pulls in server-only DB/encryption code.
const BYOK_PROVIDERS = [
  { id: "openai", label: "OpenAI", helpUrl: "https://platform.openai.com/api-keys" },
  { id: "anthropic", label: "Anthropic", helpUrl: "https://console.anthropic.com/settings/keys" },
] as const;
type Provider = (typeof BYOK_PROVIDERS)[number]["id"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type CourseRow = { name: string; number: string; professor: string; semester: string };
const EMPTY_COURSE: CourseRow = { name: "", number: "", professor: "", semester: "" };

const label = "flex flex-col gap-1.5 text-sm text-fg-muted";
const input = "rounded-md border border-border bg-bg px-3 py-2 text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none";
const primaryButton = "mt-2 w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg disabled:cursor-default disabled:opacity-50";
const errorText = "text-sm text-accent";

/**
 * Whole signup flow lives in one client component so the password never has
 * to cross a page navigation or URL — steps just swap what's rendered inside
 * one card. The account itself isn't created until Tab 1 finishes (see
 * completeSignupAction); Tabs 2/3 are then ordinary authenticated writes
 * through the same endpoints the Settings modal already uses.
 */
export function SignUpWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [name, setName] = useState("");
  const [expectedGradDate, setExpectedGradDate] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [university, setUniversity] = useState("");

  const [courses, setCourses] = useState<CourseRow[]>([{ ...EMPTY_COURSE }]);

  const [useOwnKey, setUseOwnKey] = useState(false);
  const [provider, setProvider] = useState<Provider>("openai");
  const [apiKey, setApiKey] = useState("");

  function submitEmailStep() {
    if (!EMAIL_RE.test(email.trim())) { setError("Enter a valid email address."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setError(null);
    setStep(1);
  }

  async function submitProfileStep() {
    if (!name.trim()) { setError("Name is required."); return; }
    setError(null);
    setBusy(true);
    const result = await completeSignupAction({
      name: name.trim(),
      email: email.trim(),
      password,
      expectedGradDate: expectedGradDate || undefined,
      phoneNumber: phoneNumber.trim() || undefined,
      university: university.trim() || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setStep(0); // most likely cause: email already in use
      return;
    }
    setStep(2);
  }

  async function submitCoursesStep() {
    setBusy(true);
    setError(null);
    try {
      const termIdByLabel = new Map<string, string>();
      for (const row of courses) {
        const courseName = row.name.trim();
        if (!courseName) continue;

        const semesterLabel = row.semester.trim() || "Unspecified";
        let termId = termIdByLabel.get(semesterLabel);
        if (!termId) {
          const res = await fetch("/api/profile/terms", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ label: semesterLabel }),
          });
          if (!res.ok) throw new Error("Could not save your semester.");
          const { terms: myTerms } = (await res.json()) as { terms: { id: string }[] };
          termId = myTerms[0]?.id;
          if (!termId) throw new Error("Could not save your semester.");
          termIdByLabel.set(semesterLabel, termId);
        }

        const fd = new FormData();
        fd.set("name", courseName);
        fd.set("number", row.number.trim());
        fd.set("professor", row.professor.trim());
        fd.set("termId", termId);
        const res = await fetch("/api/courses", { method: "POST", body: fd });
        if (!res.ok) throw new Error("Could not save one of your courses.");
      }
      setBusy(false);
      setStep(3);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Something went wrong saving your courses.");
    }
  }

  async function submitPreferencesStep() {
    if (useOwnKey && apiKey.trim()) {
      setBusy(true);
      setError(null);
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, key: apiKey.trim() }),
      });
      setBusy(false);
      if (!res.ok) { setError("Could not save your API key."); return; }
    }
    setStep(4);
  }

  async function enterMola() {
    setBusy(true);
    const draft = sessionStorage.getItem(PENDING_DRAFT_KEY);
    if (draft) {
      sessionStorage.removeItem(PENDING_DRAFT_KEY);
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (res.ok) {
        const { id } = (await res.json()) as { id: string };
        router.push(`/chats/${id}?draft=${encodeURIComponent(draft)}`);
        return;
      }
    }
    router.push("/chat");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <div className="rounded-2xl border border-border bg-surface p-8">
        {step === 0 && (
          <EmailStep
            email={email} setEmail={setEmail} password={password} setPassword={setPassword}
            error={error} onContinue={submitEmailStep}
          />
        )}
        {step === 1 && (
          <ProfileStep
            name={name} setName={setName}
            expectedGradDate={expectedGradDate} setExpectedGradDate={setExpectedGradDate}
            phoneNumber={phoneNumber} setPhoneNumber={setPhoneNumber}
            university={university} setUniversity={setUniversity}
            error={error} busy={busy} onContinue={submitProfileStep}
          />
        )}
        {step === 2 && (
          <CoursesStep courses={courses} setCourses={setCourses} error={error} busy={busy} onContinue={submitCoursesStep} />
        )}
        {step === 3 && (
          <PreferencesStep
            useOwnKey={useOwnKey} setUseOwnKey={setUseOwnKey}
            provider={provider} setProvider={setProvider}
            apiKey={apiKey} setApiKey={setApiKey}
            error={error} busy={busy} onContinue={submitPreferencesStep}
          />
        )}
        {step === 4 && <WelcomeStep name={name} busy={busy} onEnter={enterMola} />}
      </div>
      {step < 4 && (
        <div className="mt-4 flex justify-center gap-1.5">
          {[0, 1, 2, 3].map((s) => (
            <span key={s} className={`h-1.5 w-6 rounded-full ${s <= step ? "bg-accent" : "bg-border"}`} />
          ))}
        </div>
      )}
    </main>
  );
}

function EmailStep({
  email, setEmail, password, setPassword, error, onContinue,
}: {
  email: string; setEmail: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  error: string | null; onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-fg">Create your account</h1>
      <label className={label}>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} autoComplete="email" />
      </label>
      <label className={label}>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} autoComplete="new-password" minLength={8} />
      </label>
      {error && <p className={errorText}>{error}</p>}
      <button type="button" className={primaryButton} onClick={onContinue}>Continue</button>
      <p className="text-center text-xs text-fg-muted">
        Already have an account? <a href="/sign-in" className="text-accent">Sign in</a>
      </p>
    </div>
  );
}

function ProfileStep({
  name, setName, expectedGradDate, setExpectedGradDate, phoneNumber, setPhoneNumber, university, setUniversity, error, busy, onContinue,
}: {
  name: string; setName: (v: string) => void;
  expectedGradDate: string; setExpectedGradDate: (v: string) => void;
  phoneNumber: string; setPhoneNumber: (v: string) => void;
  university: string; setUniversity: (v: string) => void;
  error: string | null; busy: boolean; onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-fg">Tell us about you</h1>
      <label className={label}>
        Name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={input} autoComplete="name" />
      </label>
      <label className={label}>
        Expected graduation date
        <input type="month" value={expectedGradDate} onChange={(e) => setExpectedGradDate(e.target.value)} className={input} />
      </label>
      <label className={label}>
        Phone number
        <input type="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className={input} autoComplete="tel" />
      </label>
      <label className={label}>
        University
        <input type="text" value={university} onChange={(e) => setUniversity(e.target.value)} className={input} autoComplete="organization" />
      </label>
      {error && <p className={errorText}>{error}</p>}
      <button type="button" className={primaryButton} onClick={onContinue} disabled={busy}>
        {busy ? "Creating account…" : "Continue"}
      </button>
    </div>
  );
}

function CoursesStep({
  courses, setCourses, error, busy, onContinue,
}: {
  courses: CourseRow[]; setCourses: (rows: CourseRow[]) => void;
  error: string | null; busy: boolean; onContinue: () => void;
}) {
  function updateRow(i: number, patch: Partial<CourseRow>) {
    setCourses(courses.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-fg">Your courses</h1>
      <p className="text-sm text-fg-muted">Optional — you can add these later from Settings.</p>
      {courses.map((row, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <input placeholder="Course name" value={row.name} onChange={(e) => updateRow(i, { name: e.target.value })} className={input} />
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="Number" value={row.number} onChange={(e) => updateRow(i, { number: e.target.value })} className={input} />
            <input placeholder="Semester" value={row.semester} onChange={(e) => updateRow(i, { semester: e.target.value })} className={input} />
          </div>
          <input placeholder="Professor" value={row.professor} onChange={(e) => updateRow(i, { professor: e.target.value })} className={input} />
          {courses.length > 1 && (
            <button
              type="button"
              className="self-start text-xs text-fg-muted hover:text-fg"
              onClick={() => setCourses(courses.filter((_, idx) => idx !== i))}
            >
              Remove
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="self-start text-sm text-accent"
        onClick={() => setCourses([...courses, { ...EMPTY_COURSE }])}
      >
        + Add another course
      </button>
      {error && <p className={errorText}>{error}</p>}
      <button type="button" className={primaryButton} onClick={onContinue} disabled={busy}>
        {busy ? "Saving…" : "Continue"}
      </button>
    </div>
  );
}

function PreferencesStep({
  useOwnKey, setUseOwnKey, provider, setProvider, apiKey, setApiKey, error, busy, onContinue,
}: {
  useOwnKey: boolean; setUseOwnKey: (v: boolean) => void;
  provider: Provider; setProvider: (v: Provider) => void;
  apiKey: string; setApiKey: (v: string) => void;
  error: string | null; busy: boolean; onContinue: () => void;
}) {
  const activeProvider = BYOK_PROVIDERS.find((p) => p.id === provider)!;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-fg">AI preferences</h1>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setUseOwnKey(false)}
          className={`rounded-lg border p-3 text-left ${!useOwnKey ? "border-accent" : "border-border"}`}
        >
          <span className="block text-sm font-medium text-fg">Use Mola's hosted AI</span>
          <span className="block text-xs text-fg-muted">No setup required — this is the default.</span>
        </button>
        <button
          type="button"
          onClick={() => setUseOwnKey(true)}
          className={`rounded-lg border p-3 text-left ${useOwnKey ? "border-accent" : "border-border"}`}
        >
          <span className="block text-sm font-medium text-fg">Bring your own key (BYOK)</span>
          <span className="block text-xs text-fg-muted">Use your own OpenAI or Anthropic account.</span>
        </button>
      </div>

      {useOwnKey && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <label className={label}>
            Provider
            <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} className={input}>
              {BYOK_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <p className="text-xs text-fg-muted">
            Get a key from{" "}
            <a href={activeProvider.helpUrl} target="_blank" rel="noreferrer" className="text-accent">
              {activeProvider.label}
            </a>.
          </p>
          <label className={label}>
            API key
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={input} autoComplete="off" />
          </label>
        </div>
      )}

      {error && <p className={errorText}>{error}</p>}
      <button type="button" className={primaryButton} onClick={onContinue} disabled={busy}>
        {busy ? "Saving…" : "Continue"}
      </button>
    </div>
  );
}

function WelcomeStep({ name, busy, onEnter }: { name: string; busy: boolean; onEnter: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h1 className="text-xl font-semibold text-fg">Welcome to Mola{name ? `, ${name.split(" ")[0]}` : ""}</h1>
      <p className="text-sm text-fg-muted">Your account is ready.</p>
      <button type="button" className={primaryButton} onClick={onEnter} disabled={busy}>
        {busy ? "One moment…" : "Enter Mola"}
      </button>
    </div>
  );
}
