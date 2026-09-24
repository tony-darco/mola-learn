import Link from "next/link";
import type { canvasPayloadSchema } from "@mola/shared";
import type { z } from "zod";

type Payload = z.infer<typeof canvasPayloadSchema>;

/**
 * Nothing produces a canvas artifact via chat yet — this case exists only to
 * keep ArtifactBlock's exhaustive switch compiling. A canvas is created and
 * opened directly by the user (see the "+ New Canvas" entry point on the
 * Artifacts gallery), never rendered inline as a chat turn in practice.
 */
export function Canvas({ payload, title, id }: { payload: Payload; title: string; id: string }) {
  return (
    <div>
      <div className="mb-1 text-lg text-fg">{title}</div>
      <div className="mb-3 text-sm text-fg-muted">
        {payload.elements.length} element{payload.elements.length === 1 ? "" : "s"}
      </div>
      <Link
        href={`/canvas/${id}`}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg hover:border-accent"
      >
        Open in Canvas ↗
      </Link>
    </div>
  );
}
