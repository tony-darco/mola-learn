import Link from "next/link";
import type { walkthroughPayloadSchema } from "@mola/shared";
import type { z } from "zod";

type Payload = z.infer<typeof walkthroughPayloadSchema>;

/**
 * Inline preview only — no sliders, scene, or chart here. Mirrors the
 * mind-map split: a plain summary in the chat turn, the interactive
 * workspace lives on its own page (walkthroughs/[walkthroughId]).
 */
export function Walkthrough({ payload, title, id }: { payload: Payload; title: string; id: string }) {
  const first = payload.steps[0];

  return (
    <div>
      <div className="mb-2 text-sm text-fg-muted">{payload.subject}</div>
      <div className="mb-1 text-lg text-fg">{title}</div>
      {first && <div className="mb-3 text-sm text-fg-muted">Step 1: {first.title}</div>}
      <Link
        href={`/walkthroughs/${id}`}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg hover:border-accent"
      >
        Open walkthrough →
      </Link>
    </div>
  );
}
