"use client";

import { useOpenSettings } from "./shell-context";

/** Course management now lives in the settings modal, not a /courses page. */
export function CourseBreadcrumb({ courseName }: { courseName: string }) {
  const openSettings = useOpenSettings();
  return (
    <div className="mb-3 text-sm">
      <button type="button" onClick={() => openSettings("courses")} className="text-accent">
        Courses
      </button>
      <span className="text-fg-muted"> / {courseName}</span>
    </div>
  );
}
