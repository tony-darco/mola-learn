"use client";

import { useRef, type KeyboardEvent } from "react";
import { updateCourseInstructionsAction } from "@/lib/courses/actions";

const input = "rounded-lg border border-border bg-bg px-2.5 py-2 text-[13px] text-fg placeholder:text-fg-muted";

/** Professor + instructions — no Save button; Enter saves, Shift+Enter breaks a line. */
export function CourseInstructionsField({
  courseId, professor, instructions,
}: { courseId: string; professor: string | null; instructions: string | null }) {
  const formRef = useRef<HTMLFormElement>(null);

  function onEnter(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    // `e.keyCode` is deprecated but kept as a fallback: some IMEs and
    // virtual keyboards report `key: "Unidentified"` for Enter/Return.
    if ((e.key === "Enter" || e.keyCode === 13) && !e.shiftKey) {
      e.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  // Belt-and-suspenders: also save when focus leaves a field.
  function onBlur() {
    formRef.current?.requestSubmit();
  }

  return (
    <form ref={formRef} action={updateCourseInstructionsAction} className="flex flex-col gap-2">
      <input type="hidden" name="courseId" value={courseId} />
      <input
        name="professor" defaultValue={professor ?? ""} placeholder="Professor"
        onKeyDown={onEnter} onBlur={onBlur} className={input}
      />
      <textarea
        name="instructions" defaultValue={instructions ?? ""} rows={4}
        placeholder="Tone, notation, what this professor tests on…"
        onKeyDown={onEnter} onBlur={onBlur}
        className={`${input} resize-y font-sans`}
      />
    </form>
  );
}
