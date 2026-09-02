"use client";

import { updateCourseMemoryAction } from "@/lib/courses/actions";

/**
 * Course memory — no Save button; Enter saves, Shift+Enter breaks a line,
 * losing focus saves too. Calls the server action directly rather than
 * through a <form action>, which would trigger an implicit page refresh on
 * every save (see CourseSummaryField for why).
 */
export function CourseMemoryField({ courseId, content }: { courseId: string; content: string }) {
  async function save(value: string) {
    const fd = new FormData();
    fd.set("courseId", courseId);
    fd.set("content", value);
    await updateCourseMemoryAction(fd);
  }

  return (
    <textarea
      name="content"
      defaultValue={content}
      rows={4}
      placeholder="Nothing recorded yet."
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.keyCode === 13) && !e.shiftKey) {
          e.preventDefault();
          void save(e.currentTarget.value);
        }
      }}
      onBlur={(e) => void save(e.currentTarget.value)}
      className="resize-y rounded-lg border border-border bg-bg px-2.5 py-2 font-sans text-sm text-fg placeholder:text-fg-muted"
    />
  );
}
