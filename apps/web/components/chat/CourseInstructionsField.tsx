"use client";

import { useRef, type FocusEvent, type KeyboardEvent } from "react";
import { updateCourseInstructionsAction } from "@/lib/courses/actions";

const input = "rounded-lg border border-border bg-bg px-2.5 py-2 text-sm text-fg placeholder:text-fg-muted";

/**
 * Professor + instructions — no Save button; Enter saves, Shift+Enter breaks
 * a line, losing focus saves too. Calls the server action directly rather
 * than through a <form action>, which would trigger an implicit page
 * refresh on every save (see CourseSummaryField for why).
 */
export function CourseInstructionsField({
  courseId, professor, instructions,
}: { courseId: string; professor: string | null; instructions: string | null }) {
  const professorRef = useRef<HTMLInputElement>(null);
  const instructionsRef = useRef<HTMLTextAreaElement>(null);

  async function save() {
    const fd = new FormData();
    fd.set("courseId", courseId);
    fd.set("professor", professorRef.current?.value ?? "");
    fd.set("instructions", instructionsRef.current?.value ?? "");
    await updateCourseInstructionsAction(fd);
  }

  function onEnter(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    // `e.keyCode` is deprecated but kept as a fallback: some IMEs and
    // virtual keyboards report `key: "Unidentified"` for Enter/Return.
    if ((e.key === "Enter" || e.keyCode === 13) && !e.shiftKey) {
      e.preventDefault();
      void save();
    }
  }

  function onBlur(e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
    // Don't save-then-immediately-save-again when focus just moves between
    // the two fields in this same form.
    if (e.relatedTarget === professorRef.current || e.relatedTarget === instructionsRef.current) return;
    void save();
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={professorRef}
        name="professor" defaultValue={professor ?? ""} placeholder="Professor"
        onKeyDown={onEnter} onBlur={onBlur} className={input}
      />
      <textarea
        ref={instructionsRef}
        name="instructions" defaultValue={instructions ?? ""} rows={4}
        placeholder="Tone, notation, what this professor tests on…"
        onKeyDown={onEnter} onBlur={onBlur}
        className={`${input} resize-y font-sans`}
      />
    </div>
  );
}
