"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { z } from "zod";
import type { flashcardSchema } from "@mola/shared";
import { updateDeckCardsAction, type CardInput } from "@/lib/flashcards/actions";

type Card = z.infer<typeof flashcardSchema>;

/** A row being edited. `id` is absent for a card the student just added. */
type Row = { id?: string; front: string; back: string; chapter: string | null; section: string | null; week: number | null };

/**
 * A textarea that sizes itself to its content, so a long definition is never
 * clipped behind a scrollbar the student has to drag open by hand. Manual
 * resizing is switched off precisely because it's no longer needed.
 */
function AutoGrowTextarea({
  value, onChange, onBlur,
}: { value: string; onChange: (v: string) => void; onBlur: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Collapse first, or scrollHeight only ever reports the current height
    // and the box can grow but never shrink back down.
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      rows={1}
      className="resize-none overflow-hidden rounded-lg border border-border bg-bg px-2.5 py-2 text-sm text-fg focus:outline-none"
    />
  );
}

function toRows(cards: Card[]): Row[] {
  return cards.map((c) => ({ id: c.id, front: c.front, back: c.back, chapter: c.chapter, section: c.section, week: c.week }));
}

/**
 * Two-column term editor: edit in place, add, remove, and drag to reorder.
 *
 * There is no save button anywhere in this surface — a field commits on blur,
 * and structural changes (add/remove/reorder) commit immediately, matching how
 * the deck title behaves.
 */
export function FlashcardDeckEditor({
  deckId, cards, onSaved,
}: { deckId: string; cards: Card[]; onSaved: (cards: Card[]) => void }) {
  const [rows, setRows] = useState<Row[]>(() => toRows(cards));
  const [saving, setSaving] = useState(false);
  const dragIndex = useRef<number | null>(null);

  async function save(next: Row[]) {
    setRows(next);
    const payload: CardInput[] = next
      .filter((r) => r.front.trim() && r.back.trim())
      .map((r) => ({ id: r.id, front: r.front, back: r.back, chapter: r.chapter, section: r.section, week: r.week }));
    if (payload.length === 0) return; // don't let a half-typed new row wipe the deck

    setSaving(true);
    try {
      await updateDeckCardsAction(deckId, payload);
      onSaved(payload.map((c, i) => ({
        id: c.id ?? `pending-${i}`,
        front: c.front,
        back: c.back,
        chapter: c.chapter ?? null,
        section: c.section ?? null,
        week: c.week ?? null,
      })));
    } finally {
      setSaving(false);
    }
  }

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((rs) => [...rs, { front: "", back: "", chapter: null, section: null, week: null }]);
  }

  function removeRow(i: number) {
    void save(rows.filter((_, k) => k !== i));
  }

  function onDrop(target: number) {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === target) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(target, 0, moved!);
    void save(next);
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm text-fg-muted">
          {rows.length} {rows.length === 1 ? "term" : "terms"} · drag to reorder, changes save as you go
        </div>
        {saving && <div className="text-xs text-fg-muted">Saving…</div>}
      </div>

      <div className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <div
            key={row.id ?? `new-${i}`}
            draggable
            onDragStart={() => { dragIndex.current = i; }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(i)}
            className="flex items-start gap-2 rounded-xl border border-border bg-surface p-3"
          >
            <span className="mt-2 cursor-grab text-fg-muted active:cursor-grabbing" aria-hidden="true" title="Drag to reorder">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" />
                <circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" />
                <circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" />
              </svg>
            </span>

            <div className="grid flex-1 gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-fg-muted">Term</span>
                <AutoGrowTextarea
                  value={row.front}
                  onChange={(v) => updateRow(i, { front: v })}
                  onBlur={() => void save(rows)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-fg-muted">Definition</span>
                <AutoGrowTextarea
                  value={row.back}
                  onChange={(v) => updateRow(i, { back: v })}
                  onBlur={() => void save(rows)}
                />
              </label>
            </div>

            <button
              type="button"
              onClick={() => removeRow(i)}
              title="Remove term"
              aria-label="Remove term"
              className="mt-1 rounded-md p-1.5 text-fg-muted hover:bg-bg hover:text-fg"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRow}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-sm text-fg-muted hover:border-accent hover:text-fg"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Add term
      </button>
    </div>
  );
}
