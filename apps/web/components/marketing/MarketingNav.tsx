"use client";

import { useState } from "react";
import Link from "next/link";

const FEATURES = [
  { href: "/features/quizzes", label: "Quizzes", description: "Auto-generated practice sets from your course material" },
  { href: "/features/flashcards", label: "Flashcards", description: "Spaced-repetition decks built from what you're studying" },
  { href: "/features/mindmaps", label: "Mindmaps", description: "Visual maps of how concepts connect" },
  { href: "/features/agents", label: "Agents", description: "The tutoring loop that powers every chat" },
];

export function MarketingNav({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [featuresOpen, setFeaturesOpen] = useState(false);

  return (
    <header className="border-b border-border bg-bg">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="text-2xl font-semibold text-fg no-underline">Mola</Link>

        <nav className="flex items-center gap-8">
          <div
            className="relative"
            onMouseEnter={() => setFeaturesOpen(true)}
            onMouseLeave={() => setFeaturesOpen(false)}
          >
            <button type="button" className="text-base text-fg-muted hover:text-fg" aria-expanded={featuresOpen}>
              Features
            </button>
            {featuresOpen && (
              <div className="absolute left-1/2 top-full z-20 w-80 -translate-x-1/2 pt-2">
                <div className="rounded-lg border border-border bg-surface p-2 shadow-lg">
                  {FEATURES.map((f) => (
                    <Link
                      key={f.href}
                      href={f.href}
                      className="block rounded-md px-3 py-2.5 no-underline hover:bg-bg"
                    >
                      <span className="block text-base font-medium text-fg">{f.label}</span>
                      <span className="block text-sm text-fg-muted">{f.description}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
          <Link href="/resources" className="text-base text-fg-muted no-underline hover:text-fg">Resources</Link>
          <Link href="/pricing" className="text-base text-fg-muted no-underline hover:text-fg">Pricing</Link>
        </nav>

        {isAuthenticated ? (
          <Link
            href="/chat"
            className="rounded-md bg-accent px-4 py-2 text-base font-medium text-accent-fg no-underline"
          >
            Open Mola
          </Link>
        ) : (
          <div className="flex items-center gap-4">
            <Link href="/sign-in" className="text-base text-fg no-underline hover:text-fg-muted">Sign in</Link>
            <Link
              href="/sign-up"
              className="rounded-md bg-accent px-4 py-2 text-base font-medium text-accent-fg no-underline"
            >
              Sign up
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
