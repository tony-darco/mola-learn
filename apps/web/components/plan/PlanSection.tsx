"use client";

import type { ReactNode } from "react";
import { awaitsAnswer, describeWhen, proposalStatusLine, type PlanRecord } from "./plan-logic";
import { card, primaryButton, secondaryButton } from "./styles";

/**
 * The propose → amend → accept gate, which is the shape of every plan on this
 * page rather than a step in a wizard. A plan is either a question the app has
 * asked and is still waiting on, or a commitment the student made — and the
 * section says which, in those terms, before it says anything about content.
 *
 * Amending is not a separate mode: the affordances inside `children` stay live
 * either side of Accept, because a plan the student cannot change after
 * agreeing to it is a schedule, not a plan.
 */
export function PlanSection({
  title, subtitle, plan, now, lead = false, emptyLine, proposeLabel,
  acceptLabel = "Accept this plan", onPropose, onAccept, busy = false, children,
}: {
  title: string;
  subtitle?: string | null;
  plan: PlanRecord | null;
  now: Date;
  /** The hoisted proposal at the top of the page — carries the accent frame. */
  lead?: boolean;
  emptyLine: string;
  proposeLabel: string;
  acceptLabel?: string;
  onPropose: () => Promise<void>;
  onAccept: () => Promise<void>;
  busy?: boolean;
  children: ReactNode;
}) {
  const open = awaitsAnswer(plan);

  return (
    <section
      className={lead ? `${card} border-accent/40` : card}
      data-testid="plan-section"
      data-horizon={plan?.horizon}
      data-awaiting={open ? "true" : "false"}
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-baseline gap-2">
          <h2 className="m-0 text-base font-semibold text-fg">{title}</h2>
          {subtitle && <span className="text-sm text-fg-muted">{subtitle}</span>}
        </div>
        {plan && (
          <span className="text-xs text-fg-muted" data-testid="plan-status">
            {open
              ? proposalStatusLine(plan, now)
              : `Accepted ${describeWhen(plan.approvedAt ?? plan.periodStart, now)}`}
          </span>
        )}
      </div>

      {!plan ? (
        <div className="flex flex-col items-start gap-2">
          <p className="m-0 text-sm text-fg-muted">{emptyLine}</p>
          <button type="button" className={primaryButton} onClick={() => void onPropose()} disabled={busy} data-testid="plan-propose">
            {proposeLabel}
          </button>
        </div>
      ) : (
        <>
          {children}

          {open ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <button type="button" className={primaryButton} onClick={() => void onAccept()} disabled={busy} data-testid="plan-accept">
                {acceptLabel}
              </button>
              <button type="button" className={secondaryButton} onClick={() => void onPropose()} disabled={busy} data-testid="plan-repropose">
                Ask for a different one
              </button>
              <span className="text-xs text-fg-muted">
                Change anything first — an adjustment is part of your answer, not a separate step.
              </span>
            </div>
          ) : (
            <div className="mt-3 border-t border-border pt-3">
              <button type="button" className={secondaryButton} onClick={() => void onPropose()} disabled={busy} data-testid="plan-repropose">
                {proposeLabel}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
