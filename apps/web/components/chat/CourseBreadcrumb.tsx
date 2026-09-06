"use client";

import Link from "next/link";
import { useOpenSettings } from "./shell-context";

/**
 * Course management now lives in the settings modal, not a /courses page —
 * "Courses" opens that modal on every page, including artifact pages.
 * On an artifact detail page, `artifactTitle` extends this to a third
 * segment ("Courses / Course Name / Artifact Title"), with the course name
 * as a real link back to the course page. An artifact with no course (or
 * whose course was since deleted) simply omits the middle segment.
 */
export function CourseBreadcrumb({
  courseId, courseName, artifactTitle,
}: { courseId: string | null; courseName: string | null; artifactTitle?: string }) {
  const openSettings = useOpenSettings();
  return (
    <div className="mb-3 text-sm">
      <button type="button" onClick={() => openSettings("courses")} className="text-accent">
        Courses
      </button>
      {courseName && (
        artifactTitle && courseId ? (
          <>
            <span className="text-fg-muted"> / </span>
            <Link href={`/courses/${courseId}`} className="text-accent">{courseName}</Link>
          </>
        ) : (
          <span className="text-fg-muted"> / {courseName}</span>
        )
      )}
      {artifactTitle && <span className="text-fg-muted"> / {artifactTitle}</span>}
    </div>
  );
}
