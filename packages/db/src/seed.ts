/**
 * Seeds the fixtures the Phase 0 thin slice and the §9 authorization test need:
 * two users (so cross-user denial is testable), a term, and a course with a
 * syllabus-derived summary.
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { chats, courses, terms, users } from "./schema";

/**
 * Seeded users need a real password now that Auth.js is wired — without one
 * `pnpm db:seed` produces accounts nobody can sign in as, which is what
 * happened between Agent D landing credentials auth and this fix.
 *
 * Dev-only convenience. Override with SEED_PASSWORD.
 */
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "mola-dev-password";

async function upsertUser(email: string, name: string) {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);
  const existing = await db.select().from(users).where(eq(users.email, email));

  if (existing[0]) {
    // Backfill: users seeded before credentials auth existed have a null hash
    // and cannot sign in. Re-seeding should repair them, not skip them.
    if (!existing[0].passwordHash) {
      await db.update(users).set({ passwordHash }).where(eq(users.id, existing[0].id));
      return { ...existing[0], passwordHash };
    }
    return existing[0];
  }

  const [row] = await db.insert(users)
    .values({ email, name, university: "UMBC", year: "third", passwordHash })
    .returning();
  return row!;
}

const alice = await upsertUser("alice@umbc.edu", "Alice");
const bob = await upsertUser("bob@umbc.edu", "Bob");

const existingTerm = await db.select().from(terms).where(eq(terms.userId, alice.id));
const term = existingTerm[0] ?? (await db.insert(terms)
  .values({ userId: alice.id, label: "Spring 2026" }).returning())[0]!;

const existingCourse = await db.select().from(courses).where(eq(courses.userId, alice.id));
const course = existingCourse[0] ?? (await db.insert(courses).values({
  userId: alice.id,
  termId: term.id,
  name: "Principles of Operating Systems",
  number: "CMSC 421",
  professor: "Dr. Antero",
  summary:
    "Covers process abstraction, scheduling, virtual memory, concurrency and " +
    "file systems. Assessment is weighted toward derivations and project work " +
    "rather than definitional recall.",
  instructions: "Prefers precise notation. Tests derivations, not definitions.",
}).returning())[0]!;

const existingChat = await db.select().from(chats).where(eq(chats.userId, alice.id));
const chat = existingChat[0] ?? (await db.insert(chats)
  .values({ userId: alice.id, courseId: course.id, title: "Scheduling questions" })
  .returning())[0]!;

console.log(JSON.stringify({
  alice: alice.id, bob: bob.id, term: term.id, course: course.id, chat: chat.id,
}, null, 2));
console.log(`\nseeded users sign in with password: ${SEED_PASSWORD}`);
process.exit(0);
