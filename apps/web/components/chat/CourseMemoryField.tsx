"use client";

import { useRef } from "react";
import { updateCourseMemoryAction } from "@/lib/courses/actions";

/** Course memory — no Save button; Enter saves, Shift+Enter breaks a line. */
export function CourseMemoryField({ courseId, content }: { courseId: string; content: string }) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={updateCourseMemoryAction} className="flex flex-col gap-2">
      <input type="hidden" name="courseId" value={courseId} />
      <textarea
        name="content" defaultValue={content} rows={4}
        placeholder="Nothing recorded yet."
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.keyCode === 13) && !e.shiftKey) {
            e.preventDefault();
            formRef.current?.requestSubmit();
          }
        }}
        // Belt-and-suspenders: also save when focus leaves the field.
        onBlur={() => formRef.current?.requestSubmit()}
        className="resize-y rounded-lg border border-border bg-bg px-2.5 py-2 font-sans text-[13px] text-fg placeholder:text-fg-muted"
      />
    </form>
  );
}
