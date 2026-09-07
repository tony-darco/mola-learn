import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { courseMemory, db, documents, scheduleItems, users } from "@mola/db";
import { AuthzError, requireOwned, requireSession } from "@/lib/auth/ownership";
import { getPublicApiKey } from "@/lib/auth/api-keys";
import { listCourseChats, uploadCourseDocumentAction } from "@/lib/courses/actions";
import { NewCourseChatComposer } from "@/components/chat/NewCourseChatComposer";
import { CourseSummaryField } from "@/components/chat/CourseSummaryField";
import { CourseInstructionsField } from "@/components/chat/CourseInstructionsField";
import { CourseMemoryField } from "@/components/chat/CourseMemoryField";
import { CourseBreadcrumb } from "@/components/chat/CourseBreadcrumb";

export const dynamic = "force-dynamic";

const card = "rounded-xl border border-border bg-surface p-4";
const cardTitle = "mb-2 text-base font-semibold text-fg";
const input = "rounded-lg border border-border bg-bg px-2.5 py-2 text-sm text-fg placeholder:text-fg-muted";
const smallButton =
  "self-start rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg";

export default async function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: courseId } = await params;
  const session = await requireSession();

  const course = await requireOwned("course", courseId, session).catch((err) => {
    if (err instanceof AuthzError) notFound();
    throw err;
  });

  const [docs, memory, schedule, courseChats, [user], ownKey] = await Promise.all([
    db.select().from(documents).where(eq(documents.courseId, courseId)).orderBy(desc(documents.createdAt)),
    db.select().from(courseMemory).where(eq(courseMemory.courseId, courseId)).limit(1),
    db.select().from(scheduleItems).where(eq(scheduleItems.courseId, courseId)).orderBy(desc(scheduleItems.dueAt)),
    listCourseChats(session.userId, courseId),
    db.select({
      defaultModel: users.defaultModel, defaultThinkingEnabled: users.defaultThinkingEnabled,
    }).from(users).where(eq(users.id, session.userId)).limit(1),
    getPublicApiKey(session.userId),
  ]);

  return (
    <main className="flex-1 min-w-0 overflow-y-auto py-8 pl-4 pr-6">
      <div className="mx-auto max-w-7xl">
        <CourseBreadcrumb courseId={course.id} courseName={course.name} />
        <h1 className="mb-3 text-3xl font-semibold text-fg">
          {course.number ? `${course.number} — ` : ""}{course.name}
        </h1>

        <CourseSummaryField courseId={course.id} summary={course.summary} />

        <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="flex flex-col gap-4">
            <NewCourseChatComposer
              // Forces a fresh mount (and thus a fresh useState seed from the
              // props below) on every course-to-course navigation — without
              // this, Next reconciles the same instance in place and a model
              // choice made on one course's page silently bleeds into the next.
              key={course.id}
              courseId={course.id}
              defaultModel={user?.defaultModel}
              defaultThinkingEnabled={user ? user.defaultThinkingEnabled === 1 : undefined}
              hasOwnKey={ownKey !== null}
            />
            <RecentChats chats={courseChats} />
          </div>
          <div className="flex flex-col gap-4">
            <InstructionsPanel courseId={course.id} professor={course.professor} instructions={course.instructions} />
            <MemoryPanel courseId={course.id} content={memory[0]?.content ?? ""} />
            <ContextPanel courseId={course.id} docs={docs} />
            <SchedulePanel items={schedule} />
          </div>
        </div>
      </div>
    </main>
  );
}

// ── Recent chats ─────────────────────────────────────────────────────────────

function RecentChats({ chats }: { chats: { id: string; title: string; updatedAt: Date }[] }) {
  return (
    <div>
      <div className="mb-2 px-1 text-sm font-medium uppercase tracking-wide text-fg-muted">Recent chats</div>
      {chats.length === 0 ? (
        <p className="px-1 text-sm text-fg-muted">No chats in this course yet — start one above.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {chats.map((c) => (
            <Link
              key={c.id}
              href={`/chats/${c.id}`}
              className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-fg no-underline hover:bg-surface"
            >
              <span className="truncate text-sm">{c.title}</span>
              <span className="shrink-0 text-sm text-fg-muted">{c.updatedAt.toLocaleDateString()}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Panel 1 — Instructions ───────────────────────────────────────────────────

function InstructionsPanel({
  courseId, professor, instructions,
}: { courseId: string; professor: string | null; instructions: string | null }) {
  return (
    <div className={card}>
      <div className={cardTitle}>Instructions</div>
      <CourseInstructionsField courseId={courseId} professor={professor} instructions={instructions} />
    </div>
  );
}

// ── Panel 2 — Memory ─────────────────────────────────────────────────────────

function MemoryPanel({ courseId, content }: { courseId: string; content: string }) {
  return (
    <div className={card}>
      <div className={cardTitle}>Memory</div>
      <p className="mt-0 text-sm text-fg-muted">Scoped to this course only.</p>
      <CourseMemoryField courseId={courseId} content={content} />
    </div>
  );
}

// ── Panel 3 — Context ────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  scanning: "text-fg-muted", extracting: "text-fg-muted", indexing: "text-fg-muted",
  ready: "text-accent", failed: "text-red-600 dark:text-red-400", quarantined: "text-red-600 dark:text-red-400",
};

function ContextPanel({
  courseId, docs,
}: { courseId: string; docs: { id: string; title: string; kind: string; status: string }[] }) {
  return (
    <div className={card}>
      <div className={cardTitle}>Context</div>
      {docs.length === 0 ? (
        <p className="text-sm text-fg-muted">No documents yet.</p>
      ) : (
        <ul className="mb-3 flex list-none flex-col gap-1.5 p-0">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 text-sm text-fg">
              <span className="truncate">{d.title}</span>
              <span className={`shrink-0 text-sm ${STATUS_COLOR[d.status] ?? "text-fg-muted"}`}>{d.status}</span>
            </li>
          ))}
        </ul>
      )}
      <form action={uploadCourseDocumentAction} className="flex flex-col gap-2">
        <input type="hidden" name="courseId" value={courseId} />
        <select name="kind" defaultValue="student_notes" className={input}>
          <option value="textbook">Textbook</option>
          <option value="lecture_transcript">Lecture transcript</option>
          <option value="student_notes">My notes</option>
          <option value="syllabus">Syllabus</option>
        </select>
        <input name="file" type="file" required className={input} />
        <button type="submit" className={smallButton}>Upload</button>
      </form>
    </div>
  );
}

// ── Panel 4 — Schedule ───────────────────────────────────────────────────────

function SchedulePanel({ items }: { items: { id: string; title: string; dueAt: Date | null }[] }) {
  return (
    <div className={card}>
      <div className={cardTitle}>Schedule</div>
      {items.length === 0 ? (
        <p className="text-sm text-fg-muted">Nothing yet — the calendar integration isn&rsquo;t wired up.</p>
      ) : (
        <ul className="flex list-none flex-col gap-1.5 p-0">
          {items.map((i) => (
            <li key={i.id} className="text-sm text-fg">
              {i.title}{i.dueAt ? ` — ${i.dueAt.toLocaleDateString()}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
