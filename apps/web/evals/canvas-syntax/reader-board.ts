/**
 * Stage A on the saved reader board (e2e/support/readerBoard.ts, written by
 * canvas-reader-board.spec.ts): for each section, a read of just its
 * rectangle, and what the recognizer made of the writing in it against what
 * was written there. Handwritten sections are compared line by line, as text
 * with scripts marked ("Q_d = 100 - 2P"), ignoring spaces; Math-tool sections
 * by their LaTeX. No model involved.
 *
 *   pnpm --filter @mola/web exec tsx evals/canvas-syntax/reader-board.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanvasElement } from "@mola/shared";
import { readCanvas } from "@/lib/canvas/textSyntax";
import { scriptedText } from "@/lib/canvas/textSyntax/handwriting";
import { DEFAULT_MIN_CONFIDENCE, recognizeDoc } from "@/lib/canvas/textSyntax/recognize";
import { centerY, union, type Box, type Glyph } from "@/lib/canvas/textSyntax/segment";
import { planReaderBoard, READER_BOARD_TITLE, type BoardSection } from "@/e2e/support/readerBoard";
import { loadSavedCanvas } from "../savedCanvas";
import { textSimilarity } from "./score";

export type SectionRead = {
  id: string; subject: string; style: string;
  expected: string[]; read: string[];
  /** Lines read exactly as written (spaces and minus style aside), and the mean similarity of each expected line to the read one. */
  exact: number; similarity: number;
  /** Handwriting only: characters read, and how many of them were flagged as unsure. */
  glyphs: number; flagged: number;
};

/** Ignoring spaces and how the minus sign was spelled; MathLive's braces and spaces too, for LaTeX. */
const normal = (s: string) => s.replace(/[−‐-―]/g, "-").replace(/\s+/g, "");
const squash = (latex: string) => latex.replace(/[{}\s]/g, "");

/** One section's writing, line by line: words and whole matrices, grouped by height on the board and read left to right. */
function readSection(elements: CanvasElement[], section: BoardSection, latexOf: Map<string, string[]>): SectionRead {
  const { doc } = readCanvas(elements, { region: section.rect });
  const reads = recognizeDoc(doc.handwriting);
  const shown = new Set(doc.items.map((i) => i.label));
  const base = { id: section.id, subject: section.subject, style: section.style, expected: section.expected };

  if (section.style === "math") {
    const byId = new Map(elements.map((e) => [e.id, e]));
    const read = doc.items.filter((i) => i.kind === "math")
      .sort((a, b) => a.box.minY - b.box.minY)
      .map((i) => { const e = byId.get(i.elementIds[0]!); return e?.type === "math" ? e.props.latex : ""; });
    const expected = latexOf.get(section.id) ?? [];
    const exact = expected.filter((l, i) => read[i] !== undefined && squash(read[i]!) === squash(l)).length;
    const similarity = expected.reduce((s, l, i) => s + textSimilarity(squash(read[i] ?? ""), squash(l)), 0) / (expected.length || 1);
    return { ...base, expected, read, exact, similarity, glyphs: 0, flagged: 0 };
  }

  const tokens: { text: string; box: Box }[] = [];
  let glyphs = 0;
  let flagged = 0;
  const word = (gs: Glyph[]) => scriptedText(gs.map((g) => {
    const r = reads.get(g)!;
    glyphs++;
    if (r.confidence < DEFAULT_MIN_CONFIDENCE) flagged++;
    return r;
  }));
  for (const block of doc.handwriting.blocks) {
    if (!shown.has(block.id)) continue;
    if (block.kind === "text") for (const w of block.words) tokens.push({ text: word(w.glyphs), box: w.box });
    else tokens.push({ text: `[${block.rows.map((r) => r.cells.map((c) => (c ? word(c.glyphs) : "_")).join(" ")).join("; ")}]`, box: block.box });
  }
  // Lines: a token joins the line whose height range its middle falls in.
  const lines: { box: Box; tokens: typeof tokens }[] = [];
  for (const t of [...tokens].sort((a, b) => centerY(a.box) - centerY(b.box))) {
    const line = lines.find((l) => centerY(t.box) >= l.box.minY && centerY(t.box) <= l.box.maxY);
    if (line) {
      line.tokens.push(t);
      line.box = union([line.box, t.box]);
    } else lines.push({ box: t.box, tokens: [t] });
  }
  const read = lines.map((l) => l.tokens.sort((a, b) => a.box.minX - b.box.minX).map((t) => t.text).join(" "));
  const exact = section.expected.filter((l, i) => read[i] !== undefined && normal(read[i]!) === normal(l)).length;
  const similarity = section.expected.reduce((s, l, i) => s + textSimilarity(normal(read[i] ?? ""), normal(l)), 0) / (section.expected.length || 1);
  return { ...base, read, exact, similarity, glyphs, flagged };
}

/** Every section of the saved reader board, read on its own. Null if the board hasn't been written. */
export async function readReaderBoard(): Promise<{ canvasId: string; sections: SectionRead[] } | null> {
  const saved = await loadSavedCanvas(READER_BOARD_TITLE);
  if (!saved) return null;
  const plan = planReaderBoard();
  const latexOf = new Map<string, string[]>();
  for (const m of plan.math) latexOf.set(m.section, [...(latexOf.get(m.section) ?? []), m.latex]);
  return { canvasId: saved.id, sections: plan.sections.map((s) => readSection(saved.elements, s, latexOf)) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await readReaderBoard();
  if (!result) {
    console.error(`no saved canvas "${READER_BOARD_TITLE}" — write it with canvas-reader-board.spec.ts`);
    process.exit(1);
  }
  const dir = join(fileURLToPath(new URL(".", import.meta.url)), "output", new Date().toISOString().slice(0, 19).replace(/:/g, "-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "reader-board.json"), `${JSON.stringify(result, null, 2)}\n`);
  for (const s of result.sections) {
    console.log(`${s.id}: ${s.exact}/${s.expected.length} lines exact, similarity ${(s.similarity * 100).toFixed(0)}%${s.glyphs ? `, ${s.flagged}/${s.glyphs} flagged` : ""}`);
    s.expected.forEach((e, i) => { if (normal(s.read[i] ?? "") !== normal(e)) console.log(`    expected ${e}\n    read     ${s.read[i] ?? "(nothing)"}`); });
  }
  console.log(`→ ${join(dir, "reader-board.json")}`);
}
