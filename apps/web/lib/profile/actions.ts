"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, terms, users } from "@mola/db";
import { requireSession } from "@/lib/auth/ownership";

const YEARS = ["first", "second", "third", "fourth", "fifth"] as const;
type Year = (typeof YEARS)[number];

export async function updateProfileAction(formData: FormData) {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  const university = String(formData.get("university") ?? "").trim() || null;
  const yearRaw = String(formData.get("year") ?? "");
  const year = (YEARS as readonly string[]).includes(yearRaw) ? (yearRaw as Year) : null;

  if (!name) throw new Error("name is required");

  await db.update(users).set({ name, university, year, updatedAt: new Date() }).where(eq(users.id, session.userId));
  redirect("/profile");
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
  redirect("/profile");
}
