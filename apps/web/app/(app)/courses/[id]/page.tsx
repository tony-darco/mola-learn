import type { CSSProperties } from "react";
import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { courseMemory, db, documents, scheduleItems } from "@mola/db";
import { AuthzError, requireOwned, requireSession } from "@/lib/auth/ownership";
import {
  createCourseChatAction, listCourseChats, updateCourseInstructionsAction,
  updateCourseMemoryAction, updateCourseSummaryAction, uploadCourseDocumentAction,
} from "@/lib/courses/actions";
import { Chat } from "@/app/chat";

export const dynamic = "force-dynamic";

export default async function CourseDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ chat?: string }>;
}) {
  const { id: courseId } = await params;
  const { chat: chatIdParam } = await searchParams;
  const session = await requireSession();

  const course = await requireOwned("course", courseId, session).catch((err) => {
    if (err instanceof AuthzError) notFound();
    throw err;
  });

  const [docs, memory, schedule, courseChats] = await Promise.all([
    db.select().from(documents).where(eq(documents.courseId, courseId)).orderBy(desc(documents.createdAt)),
    db.select().from(courseMemory).where(eq(courseMemory.courseId, courseId)).limit(1),
    db.select().from(scheduleItems).where(eq(scheduleItems.courseId, courseId)).orderBy(desc(scheduleItems.dueAt)),
    listCourseChats(session.userId, courseId),
  ]);

  let selectedChat = courseChats[0] ?? null;
  if (chatIdParam) {
    const found = await requireOwned("chat", chatIdParam, session).catch((err) => {
      if (err instanceof AuthzError) notFound();
      throw err;
    });
    if (found.courseId !== courseId) notFound();
    selectedChat = found;
  }

  return (
    <div>
      <div style={{ marginBottom: 4 }}>
        <a href="/courses" style={{ fontSize: 13, color: "var(--accent)" }}>← Courses</a>
      </div>
      <h1 style={{ marginBottom: 4 }}>
        {course.number ? `${course.number} — ` : ""}{course.name}
      </h1>

      <SummaryCard courseId={course.id} summary={course.summary} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, marginTop: 24, alignItems: "start" }}>
        <div>
          <ChatColumn courseId={course.id} chats={courseChats} selectedChat={selectedChat} userEmail={session.email} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <InstructionsPanel courseId={course.id} professor={course.professor} instructions={course.instructions} />
          <MemoryPanel courseId={course.id} content={memory[0]?.content ?? ""} />
          <ContextPanel courseId={course.id} docs={docs} />
          <SchedulePanel items={schedule} />
        </div>
      </div>
    </div>
  );
}

// ── Main column ──────────────────────────────────────────────────────────────

function ChatColumn({
  courseId, chats, selectedChat, userEmail,
}: {
  courseId: string;
  chats: { id: string; title: string }[];
  selectedChat: { id: string; title: string } | null;
  userEmail: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        {chats.map((c) => (
          <a
            key={c.id}
            href={`/courses/${courseId}?chat=${c.id}`}
            style={{
              padding: "6px 12px", borderRadius: 20, fontSize: 13, textDecoration: "none",
              border: "1px solid var(--border)",
              background: c.id === selectedChat?.id ? "var(--accent)" : "var(--panel)",
              color: c.id === selectedChat?.id ? "#fff" : "var(--text)",
            }}
          >
            {c.title}
          </a>
        ))}
        <form action={createCourseChatAction}>
          <input type="hidden" name="courseId" value={courseId} />
          <button type="submit" style={{
            padding: "6px 12px", borderRadius: 20, fontSize: 13, cursor: "pointer",
            border: "1px dashed var(--border)", background: "none", color: "var(--muted)",
          }}>
            + New chat
          </button>
        </form>
      </div>

      {selectedChat ? (
        <div style={{ height: "70vh", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <Chat chatId={selectedChat.id} chatTitle={selectedChat.title} courseName={null} userName={userEmail} hideSidebar />
        </div>
      ) : (
        <p style={{ color: "var(--muted)" }}>No chats in this course yet — start one above.</p>
      )}
    </div>
  );
}

// ── Summary — §8: single source of truth, editable by the student ──────────

function SummaryCard({ courseId, summary }: { courseId: string; summary: string | null }) {
  return (
    <div style={card}>
      <div style={cardTitle}>Summary</div>
      {summary === null && (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          Generating… the syllabus hasn&rsquo;t been processed into a summary yet.
        </p>
      )}
      <form action={updateCourseSummaryAction}>
        <input type="hidden" name="courseId" value={courseId} />
        <textarea
          name="summary" defaultValue={summary ?? ""} rows={3}
          placeholder="Generating…"
          style={{ ...input, width: "100%", resize: "vertical", fontFamily: "inherit" }}
        />
        <button type="submit" style={{ ...smallButton, marginTop: 8 }}>Save summary</button>
      </form>
    </div>
  );
}

// ── Panel 1 — Instructions ───────────────────────────────────────────────────

function InstructionsPanel({
  courseId, professor, instructions,
}: { courseId: string; professor: string | null; instructions: string | null }) {
  return (
    <div style={card}>
      <div style={cardTitle}>Instructions</div>
      <form action={updateCourseInstructionsAction} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input type="hidden" name="courseId" value={courseId} />
        <input name="professor" defaultValue={professor ?? ""} placeholder="Professor" style={input} />
        <textarea
          name="instructions" defaultValue={instructions ?? ""} rows={4}
          placeholder="Tone, notation, what this professor tests on…"
          style={{ ...input, resize: "vertical", fontFamily: "inherit" }}
        />
        <button type="submit" style={smallButton}>Save</button>
      </form>
    </div>
  );
}

// ── Panel 2 — Memory ─────────────────────────────────────────────────────────

function MemoryPanel({ courseId, content }: { courseId: string; content: string }) {
  return (
    <div style={card}>
      <div style={cardTitle}>Memory</div>
      <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 0 }}>
        Scoped to this course only.
      </p>
      <form action={updateCourseMemoryAction} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input type="hidden" name="courseId" value={courseId} />
        <textarea
          name="content" defaultValue={content} rows={4}
          placeholder="Nothing recorded yet."
          style={{ ...input, resize: "vertical", fontFamily: "inherit" }}
        />
        <button type="submit" style={smallButton}>Save</button>
      </form>
    </div>
  );
}

// ── Panel 3 — Context ────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  scanning: "var(--muted)", extracting: "var(--muted)", indexing: "var(--muted)",
  ready: "var(--accent)", failed: "#c0392b", quarantined: "#c0392b",
};

function ContextPanel({
  courseId, docs,
}: { courseId: string; docs: { id: string; title: string; kind: string; status: string }[] }) {
  return (
    <div style={card}>
      <div style={cardTitle}>Context</div>
      {docs.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--muted)" }}>No documents yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          {docs.map((d) => (
            <li key={d.id} style={{ fontSize: 13, display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{d.title}</span>
              <span style={{ color: STATUS_COLOR[d.status] ?? "var(--muted)", fontSize: 12 }}>{d.status}</span>
            </li>
          ))}
        </ul>
      )}
      <form action={uploadCourseDocumentAction} encType="multipart/form-data" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input type="hidden" name="courseId" value={courseId} />
        <select name="kind" defaultValue="student_notes" style={input}>
          <option value="textbook">Textbook</option>
          <option value="lecture_transcript">Lecture transcript</option>
          <option value="student_notes">My notes</option>
          <option value="syllabus">Syllabus</option>
        </select>
        <input name="file" type="file" required style={input} />
        <button type="submit" style={smallButton}>Upload</button>
      </form>
    </div>
  );
}

// ── Panel 4 — Schedule ───────────────────────────────────────────────────────

function SchedulePanel({ items }: { items: { id: string; title: string; dueAt: Date | null }[] }) {
  return (
    <div style={card}>
      <div style={cardTitle}>Schedule</div>
      {items.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--muted)" }}>
          Nothing yet — the calendar integration isn&rsquo;t wired up.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((i) => (
            <li key={i.id} style={{ fontSize: 13 }}>
              {i.title}{i.dueAt ? ` — ${i.dueAt.toLocaleDateString()}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Shared styles ────────────────────────────────────────────────────────────

const card: CSSProperties = {
  border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "var(--panel)",
};
const cardTitle: CSSProperties = { fontWeight: 600, marginBottom: 8, fontSize: 14 };
const input: CSSProperties = {
  padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)",
  background: "var(--bg)", color: "var(--text)", font: "inherit", fontSize: 13,
};
const smallButton: CSSProperties = {
  padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)",
  background: "var(--accent)", color: "#fff", cursor: "pointer", font: "inherit",
  fontSize: 13, fontWeight: 600, alignSelf: "flex-start",
};
