"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCalculator } from "./shell-context";

type PendingOp = "+" | "-" | "×" | "÷" | null;

const BUTTON_ROWS: readonly (readonly string[])[] = [
  ["C", "±", "%", "÷"],
  ["7", "8", "9", "×"],
  ["4", "5", "6", "-"],
  ["1", "2", "3", "+"],
  ["0", ".", "="],
];

function compute(a: number, b: number, op: PendingOp): number {
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "×": return a * b;
    case "÷": return b === 0 ? NaN : a / b;
    default: return b;
  }
}

/**
 * Floating, draggable basic-arithmetic calculator (§ calculator feature) —
 * the student-facing companion to the deterministic `calculator` agent
 * tool; this one is plain UI state, no model involved. Mounted once in
 * AppShell so it floats above whichever page is active, toggled from the
 * "Calculator" button next to Math inputs in either composer.
 */
export function CalculatorWidget() {
  const { open, toggle } = useCalculator();
  const [display, setDisplay] = useState("0");
  const [stored, setStored] = useState<number | null>(null);
  const [pendingOp, setPendingOp] = useState<PendingOp>(null);
  const [justComputed, setJustComputed] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragStart = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);
  const positioned = useRef(false);

  // Starts near the composer rather than at (0,0) — set once, on first open.
  useEffect(() => {
    if (open && !positioned.current) {
      positioned.current = true;
      setPos({ x: window.innerWidth - 320, y: window.innerHeight - 480 });
    }
  }, [open]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPos({
      x: Math.min(Math.max(dragStart.current.posX + dx, 0), window.innerWidth - 40),
      y: Math.min(Math.max(dragStart.current.posY + dy, 0), window.innerHeight - 40),
    });
  }, []);

  const onPointerUp = useCallback(() => {
    dragStart.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove]);

  useEffect(() => () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove, onPointerUp]);

  function startDrag(e: React.PointerEvent) {
    dragStart.current = { x: e.clientX, y: e.clientY, posX: pos.x, posY: pos.y };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function pressDigit(d: string) {
    if (justComputed) {
      setDisplay(d === "." ? "0." : d);
      setJustComputed(false);
      return;
    }
    if (d === "." && display.includes(".")) return;
    setDisplay((cur) => (cur === "0" && d !== "." ? d : cur + d));
  }

  function pressOp(op: Exclude<PendingOp, null>) {
    setStored((prev) => (pendingOp && !justComputed && prev !== null ? compute(prev, Number(display), pendingOp) : Number(display)));
    setPendingOp(op);
    setJustComputed(false);
    setDisplay("0");
  }

  function pressEquals() {
    if (pendingOp === null || stored === null) return;
    const result = compute(stored, Number(display), pendingOp);
    setDisplay(String(result));
    setStored(null);
    setPendingOp(null);
    setJustComputed(true);
  }

  function pressClear() {
    setDisplay("0");
    setStored(null);
    setPendingOp(null);
    setJustComputed(false);
  }

  function pressSign() {
    setDisplay((cur) => (cur.startsWith("-") ? cur.slice(1) : cur === "0" ? cur : `-${cur}`));
  }

  function pressPercent() {
    setDisplay((cur) => String(Number(cur) / 100));
  }

  function press(key: string) {
    if (key === "C") return pressClear();
    if (key === "±") return pressSign();
    if (key === "%") return pressPercent();
    if (key === "=") return pressEquals();
    if (key === "+" || key === "-" || key === "×" || key === "÷") return pressOp(key);
    return pressDigit(key);
  }

  if (!open) return null;

  return (
    <div
      className="fixed z-[60] w-72 select-none rounded-xl border border-border bg-surface shadow-2xl"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        onPointerDown={startDrag}
        className="flex cursor-grab items-center justify-between rounded-t-xl border-b border-border px-3 py-2 active:cursor-grabbing"
      >
        <span className="text-sm font-medium text-fg">Calculator</span>
        <button
          type="button"
          onClick={toggle}
          title="Close"
          aria-label="Close"
          className="flex h-6 w-6 items-center justify-center rounded-md text-fg-muted hover:bg-bg hover:text-fg"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="px-3 pb-3 pt-2">
        <div className="mb-2 truncate rounded-md bg-bg px-3 py-3 text-right text-2xl text-fg">{display}</div>
        <div className="flex flex-col gap-1.5">
          {BUTTON_ROWS.map((row, i) => (
            <div key={i} className="grid grid-cols-4 gap-1.5">
              {row.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => press(key)}
                  className={`rounded-md py-2 text-base ${
                    key === "="
                      ? "bg-accent text-accent-fg hover:opacity-90"
                      : key === "0"
                        ? "col-span-2 bg-bg text-fg hover:bg-border"
                        : ["÷", "×", "-", "+"].includes(key)
                          ? "bg-bg text-accent hover:bg-border"
                          : "bg-bg text-fg hover:bg-border"
                  }`}
                >
                  {key}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
