import type { CSSProperties } from "react";
import { requireSession } from "@/lib/auth/ownership";
import { getPublicApiKey } from "@/lib/auth/api-keys";
import { removeApiKeyAction, saveApiKeyAction } from "@/lib/settings/actions";

export const dynamic = "force-dynamic";

const PROVIDER_LABEL: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic" };

export default async function SettingsPage() {
  const session = await requireSession();
  const current = await getPublicApiKey(session.userId);

  return (
    <div style={{ maxWidth: 480 }}>
      <h1 style={{ marginBottom: 4 }}>Settings</h1>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>Model and provider.</p>

      <div style={card}>
        <div style={cardTitle}>Chat provider</div>
        {current ? (
          <>
            <p style={{ fontSize: 14 }}>
              {PROVIDER_LABEL[current.provider] ?? current.provider} — key ending in{" "}
              <code>{current.lastFour}</code>
            </p>
            <form action={removeApiKeyAction}>
              <button type="submit" style={dangerButton}>Remove key (revert to Ollama)</button>
            </form>
          </>
        ) : (
          <>
            <p style={{ fontSize: 14, color: "var(--muted)" }}>
              Using the platform default (Ollama, self-hosted). Add your own key to switch providers.
            </p>
            <form action={saveApiKeyAction} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
              <label style={label}>
                Provider
                <select name="provider" style={input}>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </label>
              <label style={label}>
                API key
                <input name="key" type="password" required autoComplete="off" style={input} />
              </label>
              <button type="submit" style={button}>Save</button>
            </form>
          </>
        )}
      </div>

      <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 16 }}>
        Keys are encrypted at rest and never shown again after saving — only the last
        four characters are kept for display (§9). BYOK covers chat completions only;
        embeddings always run on the platform&rsquo;s self-hosted model, never your key.
      </p>
    </div>
  );
}

const card: CSSProperties = {
  border: "1px solid var(--border)", borderRadius: 12, padding: 20, background: "var(--panel)", marginTop: 16,
};
const cardTitle: CSSProperties = { fontWeight: 600, marginBottom: 10, fontSize: 15 };
const label: CSSProperties = {
  display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "var(--muted)",
};
const input: CSSProperties = {
  padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)",
  background: "var(--bg)", color: "var(--text)", font: "inherit",
};
const button: CSSProperties = {
  padding: "10px 16px", borderRadius: 8, border: "1px solid var(--border)",
  background: "var(--accent)", color: "#fff", cursor: "pointer", font: "inherit", fontWeight: 600,
};
const dangerButton: CSSProperties = {
  padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)",
  background: "none", color: "var(--accent)", cursor: "pointer", font: "inherit", fontSize: 13,
};
