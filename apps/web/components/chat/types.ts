import type { ArtifactRecord } from "@mola/shared";

/** One collapsed row in a turn's activity log — a tool call or a sub-agent run. */
export type ActivityEntry =
  | { kind: "tool"; id: string; name: string; label: string; status: "running" | "ok" | "error"; summary?: string }
  | { kind: "subagent"; id: string; label: string; status: "running" | "done" };

export type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  activity: ActivityEntry[];
  artifacts: ArtifactRecord[];
  /** Rung served on this turn, if the student pulled a hint for it. */
  hintRung: "pointing" | "teaching" | "bottom_out" | null;
  error: string | null;
  /** False once the assistant has finished responding to this turn. */
  streaming: boolean;
};

export type ChatSummary = {
  id: string;
  title: string;
  courseId: string | null;
  updatedAt: string;
  isPinned: number;
};

export type CourseSummary = {
  id: string;
  name: string;
  number: string | null;
};

export type CompactionBoundary = {
  upToMessageId: string;
  summary: string;
  createdAt: string;
};
