"use client";

import { HINT_RUNGS, type HintRung } from "@mola/shared";

/**
 * The hint ladder affordance. Hints are PULLED BY THE STUDENT — this button is
 * the only thing in the product that calls escalate() (§3, CONTRACTS.md). It
 * never fires on a timer or a message count.
 *
 * Layer 4 forbids the model from naming the rung to the student ("pointing" /
 * "teaching" / "bottom_out" never appear in a reply). The UI keeps that same
 * discipline: rung progress is shown as neutral dots, not the internal rung
 * name, so the affordance doesn't leak the ladder structure it's built on top of.
 */
export function HintControl({
  rung,
  canEscalate,
  disabled,
  onPull,
}: {
  rung: HintRung | null;
  canEscalate: boolean;
  disabled: boolean;
  onPull: () => void;
}) {
  const rungIndex = rung ? HINT_RUNGS.indexOf(rung) : -1;
  const bottomedOut = rung !== null && !canEscalate;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="whitespace-nowrap rounded-lg border border-border bg-surface px-3.5 py-2 text-sm text-fg disabled:cursor-default disabled:opacity-50"
        onClick={onPull}
        disabled={disabled || bottomedOut}
        title={bottomedOut ? "No more hints for this question" : "Get a hint"}
      >
        {rung ? "Another hint" : "Hint"}
      </button>
      {rung && (
        <span className="inline-flex gap-1" aria-label={`Hint ${rungIndex + 1} of ${HINT_RUNGS.length}`}>
          {HINT_RUNGS.map((_, i) => (
            <span
              key={i}
              className={`inline-block h-1.5 w-1.5 rounded-full ${i <= rungIndex ? "bg-accent" : "bg-border"}`}
            />
          ))}
        </span>
      )}
      {bottomedOut && (
        <span className="text-[11.5px] text-fg-muted">That&apos;s as far as hints go — try it yourself.</span>
      )}
    </div>
  );
}
