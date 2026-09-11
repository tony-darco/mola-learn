import type { ReactNode } from "react";

/** Shared wrapper for the simple marketing sub-pages (features/resources/pricing). */
export function MarketingPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mx-auto max-w-2xl px-6 py-32 text-center">
      <h1 className="mb-6 text-5xl font-semibold text-fg">{title}</h1>
      <div className="text-lg leading-relaxed text-fg-muted">{children}</div>
    </section>
  );
}
