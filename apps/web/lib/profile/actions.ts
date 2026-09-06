"use server";

import { eq } from "drizzle-orm";
import { db, terms, users } from "@mola/db";
import { requireSession } from "@/lib/auth/ownership";

const YEARS = ["first", "second", "third", "fourth", "fifth"] as const;
type Year = (typeof YEARS)[number];

// Called directly (not via <form action>) from the settings modal's Profile
// section, which stays open across the save — a redirect here would trigger
// an implicit page refresh and close it.
export async function updateProfileAction(formData: FormData) {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  const university = String(formData.get("university") ?? "").trim() || null;
  const yearRaw = String(formData.get("year") ?? "");
  const year = (YEARS as readonly string[]).includes(yearRaw) ? (yearRaw as Year) : null;

  if (!name) throw new Error("name is required");

  await db.update(users).set({ name, university, year, updatedAt: new Date() }).where(eq(users.id, session.userId));
}

/** create_quiz's fallback question count when a student's prompt doesn't say (§6). */
export async function updateQuizDefaultsAction(formData: FormData) {
  const session = await requireSession();
  const raw = Number(formData.get("defaultQuizQuestionCount"));
  const count = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), 30) : 10;

  await db.update(users)
    .set({ defaultQuizQuestionCount: count, updatedAt: new Date() })
    .where(eq(users.id, session.userId));
}

/**
 * Terms are additive, never overwritten (§8) — this route only inserts. There
 * is deliberately no update/delete action here: adding Fall 2026 must not be
 * able to disturb Spring 2025.
 */
export async function addTermAction(formData: FormData) {
  const session = await requireSession();
  const label = String(formData.get("label") ?? "").trim();
  if (!label) throw new Error("a term label is required");

  await db.insert(terms).values({ userId: session.userId, label });
}
