"use client";

import { useRef } from "react";
import { updateCourseSummaryAction } from "@/lib/courses/actions";

/** The course description, up top — no Save button; Enter saves, Shift+Enter breaks a line. */
export function CourseSummaryField({ courseId, summary }: { courseId: string; summary: string | null }) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={updateCourseSummaryAction} className="flex flex-col items-start gap-1.5">
      <input type="hidden" name="courseId" value={courseId} />
      {summary === null && (
        <p className="text-[13px] text-fg-muted">
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
            formRef.current?.requestSubmit();
          }
        }}
        // Belt-and-suspenders: also save when focus leaves the field (click
        // away, tab to the next field), not only on Enter.
        onBlur={() => formRef.current?.requestSubmit()}
        className="w-full resize-none rounded-md border-none bg-transparent px-0 py-0 text-[15px] text-fg-muted focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </form>
  );
}
