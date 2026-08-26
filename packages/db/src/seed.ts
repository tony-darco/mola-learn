/**
 * Seeds the fixtures the Phase 0 thin slice and the §9 authorization test need:
 * two users (so cross-user denial is testable), a term, and a course with a
 * syllabus-derived summary.
 */
import { eq } from "drizzle-orm";
import { db } from "./client";
import { chats, courses, terms, users } from "./schema";

async function upsertUser(email: string, name: string) {
  const existing = await db.select().from(users).where(eq(users.email, email));
  if (existing[0]) return existing[0];
  const [row] = await db.insert(users)
    .values({ email, name, university: "UMBC", year: "third" })
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
process.exit(0);
