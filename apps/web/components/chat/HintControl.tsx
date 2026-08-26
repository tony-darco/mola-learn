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
    <div className="hint-control">
      <button
        type="button"
        className="hint-button"
        onClick={onPull}
        disabled={disabled || bottomedOut}
        title={bottomedOut ? "No more hints for this question" : "Get a hint"}
      >
        {rung ? "Another hint" : "Hint"}
      </button>
      {rung && (
        <span className="hint-dots" aria-label={`Hint ${rungIndex + 1} of ${HINT_RUNGS.length}`}>
          {HINT_RUNGS.map((_, i) => (
            <span key={i} className={`hint-dot${i <= rungIndex ? " hint-dot-filled" : ""}`} />
          ))}
        </span>
      )}
      {bottomedOut && <span className="hint-bottomed-out">That&apos;s as far as hints go — try it yourself.</span>}
    </div>
  );
}
