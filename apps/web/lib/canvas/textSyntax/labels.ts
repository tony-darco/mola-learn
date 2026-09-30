/**
 * Labels that stay put for a whole conversation: once the model has been
 * told "M3", M3 must keep naming the same matrix however the board changes
 * around it, and must never come back naming something else.
 *
 * The reader is pure: it takes the previous LabelMap and returns the updated
 * one, and the caller keeps it between reads.
 *
 * - A placed element (text box, note, shape, tool arrow, highlighter stroke,
 *   …) is keyed by its element id.
 * - Things read from pen strokes (handwritten blocks, pen marks) have no id
 *   of their own, so each is matched to a previous label of the same kind by
 *   the strokes they share: it takes the label whose strokes make up most of
 *   it, or most of which it still holds. Writing another digit into a matrix
 *   keeps its label; so does erasing one.
 * - Anything new takes the next number never used for its prefix.
 */
export type LabelMap = {
  /** Placed elements: element id → label. */
  elements: Record<string, string>;
  /** Things read from pen strokes: label → the stroke (element) ids it was made of. */
  strokes: Record<string, string[]>;
  /** Per prefix, the highest number handed out so far. Labels are never reused, so this only grows. */
  counters: Record<string, number>;
};

export const EMPTY_LABELS: LabelMap = { elements: {}, strokes: {}, counters: {} };

/** One thing to label: a placed element by its id, or something read from pen strokes by their ids. */
export type Labelable = { prefix: string } & ({ elementId: string } | { strokeIds: string[] });

const prefixOf = (label: string) => label.replace(/\d+$/, "");
const numberOf = (label: string) => Number(label.slice(prefixOf(label).length));

/** Labels for `items`, which come in reading order — new ones are numbered in that order. */
export function assignLabels(items: Labelable[], previous: LabelMap = EMPTY_LABELS): { labels: string[]; map: LabelMap } {
  const labels: (string | undefined)[] = items.map((item) => {
    if (!("elementId" in item)) return undefined;
    const label = previous.elements[item.elementId];
    return label && prefixOf(label) === item.prefix ? label : undefined;
  });

  // Every (item, previous label) pair sharing a majority of either one's strokes, biggest overlap first.
  const pairs: { i: number; label: string; overlap: number }[] = [];
  items.forEach((item, i) => {
    if (!("strokeIds" in item)) return;
    for (const [label, ids] of Object.entries(previous.strokes)) {
      if (prefixOf(label) !== item.prefix) continue;
      const held = new Set(ids);
      const overlap = item.strokeIds.filter((id) => held.has(id)).length;
      if (2 * overlap > item.strokeIds.length || 2 * overlap > ids.length) pairs.push({ i, label, overlap });
    }
  });
  pairs.sort((a, b) => b.overlap - a.overlap || a.i - b.i || numberOf(a.label) - numberOf(b.label));
  const taken = new Set<string>();
  for (const { i, label } of pairs) {
    if (labels[i] !== undefined || taken.has(label)) continue;
    labels[i] = label;
    taken.add(label);
  }

  const counters = { ...previous.counters };
  const final = items.map((item, i) => labels[i] ?? `${item.prefix}${(counters[item.prefix] = (counters[item.prefix] ?? 0) + 1)}`);
  const map: LabelMap = { elements: {}, strokes: {}, counters };
  items.forEach((item, i) => {
    if ("elementId" in item) map.elements[item.elementId] = final[i]!;
    else map.strokes[final[i]!] = [...item.strokeIds].sort();
  });
  return { labels: final, map };
}
