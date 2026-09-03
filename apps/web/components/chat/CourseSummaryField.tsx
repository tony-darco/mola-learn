"use client";

import { updateCourseSummaryAction } from "@/lib/courses/actions";

/**
 * The course description, up top — no Save button; Enter saves, Shift+Enter
 * breaks a line, and losing focus saves too. Calls the server action
 * directly as a function rather than binding it to a <form action>: a bound
 * form action triggers an implicit page refresh on every submit (even
 * without a redirect() in the action), which is exactly the visible reload
 * this field is meant to avoid.
 */
export function CourseSummaryField({ courseId, summary }: { courseId: string; summary: string | null }) {
  async function save(value: string) {
    const fd = new FormData();
    fd.set("courseId", courseId);
    fd.set("summary", value);
    await updateCourseSummaryAction(fd);
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      {summary === null && (
        <p className="text-sm text-fg-muted">
          Generating… the syllabus hasn&rsquo;t been processed into a summary yet.
        </p>
      )}
      <textarea
        name="summary"
        defaultValue={summary ?? ""}
        rows={2}
        placeholder="What this course is about…"
        onKeyDown={(e) => {
          // `e.keyCode` is deprecated but kept as a fallback: some IMEs and
          // virtual keyboards report `key: "Unidentified"` for Enter/Return.
          if ((e.key === "Enter" || e.keyCode === 13) && !e.shiftKey) {
            e.preventDefault();
            void save(e.currentTarget.value);
          }
        }}
        onBlur={(e) => void save(e.currentTarget.value)}
        className="w-full resize-none rounded-md border-none bg-transparent px-0 py-0 text-base text-fg-muted focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </div>
  );
}
