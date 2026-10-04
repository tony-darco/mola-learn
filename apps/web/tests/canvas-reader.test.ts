/**
 * The canvas reader (lib/canvas/textSyntax/read.ts), as a guard: every kind
 * of element reads as its exact line; on the composite board every pen mark
 * is found — and nothing else is taken for one — and every relation comes
 * out right, on the clean hand and on jittered ones; labels stay put as the
 * board changes; a read of a selected region agrees with the full read.
 * (Whether models can answer questions from the read lives in
 * evals/canvas-reader and is not a test.)
 */
import { describe, expect, it } from "vitest";
import type { CanvasElement } from "@mola/shared";
import { readCanvas, type LabelMap } from "../lib/canvas/textSyntax";
import { scriptedText, UNSURE_GUIDE } from "../lib/canvas/textSyntax/handwriting";
import { DEFAULT_MIN_CONFIDENCE, recognizeDoc } from "../lib/canvas/textSyntax/recognize";
import { drawn, line, makeBoard, SINGLES, written } from "../evals/canvas-reader/fixtures";
import { checkBoard } from "../evals/canvas-reader/score";
import { strokeElements } from "../evals/canvas-diagrams/checks";
import { planElements } from "../evals/canvas-syntax/fixtures";
import { planDiagramBoard } from "../e2e/support/diagramBoard";
import { jitterFor, planReaderBoard, writeMatrix } from "../e2e/support/readerBoard";
import { makeJitter, textStrokes } from "../e2e/support/strokeFont";

/**
 * For sweeps over many boards: what the reader finds doesn't depend on how
 * handwriting is rendered, and raw skips character recognition, which is
 * nearly all of a read's time.
 */
const RAW = { render: "raw" } as const;

/** The printed items: every section of the read that starts with a label. */
const itemsOf = (text: string) => text.split("\n\n").filter((s) => /^[A-Z]\d+ — /.test(s));
const item = (text: string, label: string) => itemsOf(text).find((s) => s.startsWith(`${label} — `));

describe("readCanvas: one of each kind of element", () => {
  const expected: Record<string, string[]> = {
    "text box": [`X1 — text box at top-left (100, 100): "Hello, board"`],
    "text box, two lines": ["X1 — text box at top-left (100, 100), 2 lines:\n| First line\n| Second line"],
    "sticky note": [`N1 — sticky note at top-left (100, 100): "Remember: pivot first"`],
    math: [`Q1 — math at top-left (100, 100), LaTeX: "\\frac{a}{b} = c"`],
    image: ["I1 — image at top-left (100, 100), size 320 x 240 (its contents are not described)."],
    frame: [`X1 — text box at top-left (100, 100): "inside"`, `F1 — frame "Scratch" containing X1. Top-left (50, 50), size 300 x 200.`],
    shape: [`X1 — text box at top-left (100, 100): "boxed"`, "S1 — rectangle around X1. Top-left (80, 80), size 200 x 64."],
    line: [
      `X1 — text box at top-left (100, 100): "left"`, `X2 — text box at top-left (400, 100): "right"`,
      "L1 — line between X1 and X2. Ends (165, 112) and (395, 112).",
    ],
    arrow: [`N1 — sticky note at top-left (400, 100): "target"`, "A1 — arrow from a free end to N1. Tail (100, 400), head (420, 210)."],
    "pen circle": ["T1 — line of text, 3 words. Top-left (102, 100).\nT1: R1 = R2", "C1 — circle drawn with the pen, around T1 word 3."],
    "pen arrow": [
      "T1 — line of text, 1 word. Top-left (102, 100).\nT1: R1", "T2 — line of text, 1 word. Top-left (102, 300).\nT2: R2",
      "A1 — arrow drawn with the pen, from T1 to T2. Tail (115, 140), head (115, 290).",
    ],
    "pen underline": ["T1 — line of text, 3 words. Top-left (102, 100).\nT1: R1 = R2", "U1 — underline drawn with the pen, under T1 word 1."],
    highlighter: ["T1 — line of text, 3 words. Top-left (102, 100).\nT1: R1 = R2", "H1 — highlighter stroke over T1 words 1–2."],
    "text box made by the AI": [`X1 — text box (made by the AI) at top-left (100, 100): "Try R2 - 2R1"`],
  };

  it("covers every fixture", () => expect(Object.keys(expected).sort()).toEqual(Object.keys(SINGLES).sort()));

  it.each(Object.keys(expected))("%s", (name) => {
    expect(itemsOf(readCanvas(SINGLES[name]!()).text)).toEqual(expected[name]);
  });

  it("says so when the canvas is empty", () => {
    expect(readCanvas([]).text).toBe("CANVAS CONTENTS, AS TEXT\nEverything on this whiteboard: first what is written or placed on it, then the marks and connections drawn over it, "
      + "each part in reading order (top to bottom within each column of the board, columns left to right).\n\nNothing is on this canvas.");
  });
});

describe("readCanvas: the composite board", () => {
  it("reads every mark and connection on the clean board", () => {
    const { text } = readCanvas(makeBoard("clean").elements);
    expect(text.split("MARKS AND CONNECTIONS\n")[1]!.split("\n\n")).toEqual([
      "1 frame, 1 shape, 2 arrows, 1 pen circle, 1 pen underline and 1 highlighter stroke.",
      "U1 — underline drawn with the pen, under T1 word 6.",
      "C1 — circle drawn with the pen, around M2 row 2 col 3.",
      "A1 — arrow drawn with the pen, from M4 to M5. Tail (706, 770), head (781, 182).",
      "H1 — highlighter stroke over T5 words 2–4.",
      "S1 — ellipse around T7. Top-left (806, 626), size 322 x 64.",
      "A2 — arrow from M8 to N1. Tail (1216, 764), head (1312, 672).",
      `F1 — frame "Final answer" containing M8. Top-left (770, 686), size 455 x 160.`,
    ]);
    expect(item(text, "X2")).toBe(`X2 — text box (made by the AI) at top-left (1290, 760): "Nice work, every step checks out."`);
    expect(item(text, "Q1")).toBe(`Q1 — math at top-left (1290, 170), LaTeX: "\\det(A) = -1"`);
  });

  // Mark detection was tuned on these hands (and the clean one) only.
  const tuning: [string, number | undefined, "separate" | "joined"][] = (["separate", "joined"] as const).flatMap((head) =>
    [undefined, ...Array.from({ length: 20 }, (_, i) => i + 1)].map((seed): [string, number | undefined, "separate" | "joined"] =>
      [`${seed === undefined ? "clean" : `jitter seed ${seed}`}, arrowhead ${head}`, seed, head]));

  it.each(tuning)("%s: finds exactly the pen marks, and every relation is right", (_, seed, head) => {
    const board = makeBoard("board", { jitterSeed: seed, penArrowHead: head });
    const failed = checkBoard(board, readCanvas(board.elements, RAW).doc).filter((c) => !c.pass);
    expect(failed).toEqual([]);
  });

  it("reads the held-out jittered hands (seeds 100–149) as well as the ones it was tuned on", () => {
    // Mark detection and relations were tuned on seeds 1–20 only; seeds
    // 100–149 were first looked at once tuning was final. Measured then: all
    // 100 boards (50 hands × both arrowheads) had every check right — the
    // handwriting untouched, exactly the three pen marks found, every
    // relation as drawn — and none of the 50 boards of zeros below grew a
    // mark. So the floor is all of them: if a change breaks one, look at why
    // rather than lower the bar.
    let failed: string[] = [];
    for (const head of ["separate", "joined"] as const) {
      for (let seed = 100; seed <= 149; seed++) {
        const board = makeBoard("held out", { jitterSeed: seed, penArrowHead: head });
        failed = [...failed, ...checkBoard(board, readCanvas(board.elements, RAW).doc).filter((c) => !c.pass).map((c) => `${head} ${seed}: ${c.name} — ${c.got}`)];
      }
    }
    expect(failed).toEqual([]);
  }, 120_000);

  it("points at a single cell when an arrow ends on one", () => {
    const elements = [...makeBoard("clean").elements, line("probe", { x: 460, y: 1000 }, { x: 545, y: 764 }, "end")];
    const probe = readCanvas(elements).doc.items.find((i) => i.elementIds.includes("probe"));
    expect(probe?.ends).toEqual([null, "M4 row 2 col 3"]);
  });
});

describe("readCanvas: matrices multiplied on one row", () => {
  /** The reader board's matrix multiplication, [1 2; 3 4] × [5 6; 7 8] = [19 22; 43 50] with its entries tightly spaced, on a canvas of its own. */
  const multiplication = (style: "neat" | "shaky", seed?: number) => {
    const plan = planReaderBoard(seed === undefined ? {} : { seed });
    const { rect } = plan.sections.find((s) => s.id === `matrix-multiplication-${style}`)!;
    return planElements(plan).filter((e) => e.x >= rect.minX && e.x + e.width <= rect.maxX && e.y >= rect.minY && e.y + e.height <= rect.maxY);
  };
  /** Each matrix's rows, as how many characters each entry has: "1,1;1,1". */
  const entries = (elements: CanvasElement[]) => readCanvas(elements, RAW).doc.handwriting.blocks.flatMap((b) => (b.kind === "matrix"
    ? [b.rows.map((r) => r.cells.map((c) => c?.glyphs.length ?? 0).join(",")).join(";")]
    : []));

  it("reads each entry of tightly spaced matrices, and the operators between them as one expression", () => {
    const { text } = readCanvas(multiplication("neat"));
    // In reading order: the operators span M2, so they come under it.
    expect(itemsOf(text).map((s) => s.split("\n").slice(1).join("\n"))).toEqual([
      "[  1  2 ]\n[  3  4 ]",
      "[  5  6 ]\n[  7  8 ]",
      "T1: M1 × M2 = M3",
      "[ 19 22 ]\n[ 43 50 ]",
    ]);
    expect(item(text, "T1")).toMatch(/^T1 — operators written between matrices, joining M1, M2 and M3 into one expression\./);
  });

  it("places the operators between the matrices in a raw read too", () => {
    expect(item(readCanvas(multiplication("neat"), RAW).text, "T1")!.split("\n")[1]).toBe("T1: M1 (word 1) M2 (word 2) M3");
  });

  it("reads the same in other neat hands (seeds 1–20): every entry, \"19\" as one, and × never as x", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const elements = multiplication("neat", seed);
      expect(entries(elements), `seed ${seed}`).toEqual(["1,1;1,1", "1,1;1,1", "2,2;2,2"]);
      expect(item(readCanvas(elements).text, "T1")!.split("\n")[1], `seed ${seed}`).toBe("T1: M1 × M2 = M3");
    }
  });

  it("keeps two-digit entries whole in a column of them, in neat hands (seeds 1–20)", () => {
    for (const m of [[[19], [43]], [[11], [11]], [[10], [11]]]) {
      for (let seed = 1; seed <= 20; seed++) {
        const { strokes } = writeMatrix(m, 300, 100, 24, jitterFor("neat", seed));
        expect(entries(planElements({ strokes })), `${JSON.stringify(m)}, seed ${seed}`).toEqual(["2;2"]);
      }
    }
  });

  it("finds the brackets of the shaky hand", () => {
    expect(entries(multiplication("shaky"))).toEqual(["1,1;1,1", "1,1;1,1", "2,2;2,2"]);
  });
});

describe("readCanvas: a written 0 is never a pen circle", () => {
  // A big one on its own, and ones among other characters: a closed loop, but around nothing.
  const zeros = (seed?: number): CanvasElement[] => {
    const jitter = seed === undefined ? undefined : makeJitter(seed);
    return [
      ...written("a", "R1 = 10", 100, 100, 30, jitter),
      ...textStrokes("0", 100, 400, 70, jitter).map((s, i) => drawn(`big${i}`, s)),
      ...written("c", "100", 100, 250, 30, jitter),
    ];
  };
  it("reads them as zeros (clean hand)", () => {
    expect(itemsOf(readCanvas(zeros()).text).map((s) => s.split("\n")[1])).toEqual(["T1: R1 = 10", "T2: 100", "T3: 0"]);
  });

  // (How the jittered digits split into words is the handwriting segmenter's business, not this test's.)
  // Seeds 1–20 were tuning hands; 100–149 are held out (see the composite board's held-out test).
  it.each([undefined, ...Array.from({ length: 20 }, (_, i) => i + 1), ...Array.from({ length: 50 }, (_, i) => i + 100)])("seed %s: no pen marks, every stroke stays in the writing", (seed) => {
    const elements = zeros(seed);
    const { doc, text } = readCanvas(elements);
    expect(doc.items.map((i) => i.kind)).toEqual(["writing", "writing", "writing"]);
    expect(doc.items.flatMap((i) => i.elementIds).sort()).toEqual(elements.map((e) => e.id).sort());
    if (seed === undefined || seed <= 20) expect(item(text, "T3")!.split("\n")[1]).toBe("T3: 0");
  });
});

describe("readCanvas: stable labels", () => {
  const board = () => makeBoard("clean").elements;
  const first = readCanvas(board());
  const labelled = (doc: ReturnType<typeof readCanvas>["doc"]) =>
    Object.fromEntries(doc.items.map((i) => [i.label, [...i.elementIds].sort().join(",")]));
  const before = labelled(first.doc);

  it("keeps a block's label when strokes are added to it", () => {
    // A "7" written right after M3's top-left "1", making it "17".
    const seven = textStrokes("7", 393, 509, 30).map((s, i) => drawn(`seven${i}`, s));
    const { doc, text, labels } = readCanvas([...board(), ...seven], { labels: first.labels });
    expect(item(text, "M3")!.split("\n")[1]).toBe("[ 17  1  1 |  6 ]");
    const after = labelled(doc);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    for (const label of Object.keys(before)) if (label !== "M3") expect(after[label]).toBe(before[label]);
    expect(labels.counters).toEqual(first.labels.counters);
  });

  it("retires a deleted block's label, and never hands it out again", () => {
    const m3 = new Set(first.labels.strokes.M3);
    const without = board().filter((e) => !m3.has(e.id));
    const gone = readCanvas(without, { labels: first.labels });
    expect(gone.doc.items.map((i) => i.label)).not.toContain("M3");
    const after = labelled(gone.doc);
    for (const label of Object.keys(after)) expect(after[label]).toBe(before[label]);

    // The same matrix written again, far away, with new strokes: a new matrix, so a new label.
    const again = board().filter((e) => m3.has(e.id)).map((e) => ({ ...e, id: `${e.id}-again`, x: e.x + 1500 }));
    const back = readCanvas([...without, ...again], { labels: gone.labels });
    expect(back.doc.items.filter((i) => i.kind === "matrix").map((i) => i.label)).toContain("M9");
    expect(back.doc.items.map((i) => i.label)).not.toContain("M3");
  });

  it("doesn't renumber anything when a block is written above the others", () => {
    const above = written("new", "R1", 300, 40, 30);
    const { doc, text } = readCanvas([...board(), ...above], { labels: first.labels });
    const after = labelled(doc);
    for (const label of Object.keys(before)) expect(after[label]).toBe(before[label]);
    expect(item(text, "T8")).toBe("T8 — line of text, 1 word. Top-left (302, 40).\nT8: R1");
    // In reading order it comes first, but it keeps the next number, not T1.
    expect(itemsOf(text)[0]!.startsWith("T8 — ")).toBe(true);
  });

  it("keeps labels when things move, and says what they touch now", () => {
    const m8 = new Set(first.labels.strokes.M8);
    const moved = board().map((e) => {
      if (e.id === "note") return { ...e, x: e.x + 600 };
      if (e.id === "pen-circle") return { ...e, x: e.x + 4, y: e.y + 2 };
      if (m8.has(e.id) || e.id === "frame") return { ...e, y: e.y + 300 };
      return e;
    });
    const { doc, text } = readCanvas(moved, { labels: first.labels });
    expect(labelled(doc)).toEqual(before);
    expect(item(text, "A2")).toBe("A2 — arrow from a free end to a free end. Tail (1216, 764), head (1312, 672).");
    expect(item(text, "F1")).toMatch(/^F1 — frame "Final answer" containing M8\./);
    expect(item(text, "C1")).toBe("C1 — circle drawn with the pen, around M2 row 2 col 3.");
  });

  it("is plain JSON: a label map that went through storage works the same", () => {
    const stored = JSON.parse(JSON.stringify(first.labels)) as LabelMap;
    expect(readCanvas(board(), { labels: stored })).toEqual(readCanvas(board(), { labels: first.labels }));
    expect(readCanvas(board(), { labels: stored }).text).toBe(first.text);
  });
});

describe("readCanvas: a selected region", () => {
  const elements = makeBoard("clean").elements;
  const full = readCanvas(elements);

  it("labels everything exactly as a full read does", () => {
    for (const region of [{ minX: 270, minY: 245, maxX: 710, maxY: 445 }, { minX: 1230, minY: 540, maxX: 1500, maxY: 800 }, { minX: 0, minY: 0, maxX: 1, maxY: 1 }]) {
      const scoped = readCanvas(elements, { region });
      expect(scoped.labels).toEqual(full.labels);
      for (const i of scoped.doc.items) expect(full.doc.items.find((f) => f.label === i.label)?.elementIds).toEqual(i.elementIds);
    }
    // Scoped reads pass labels along like full ones.
    expect(readCanvas(elements, { labels: full.labels, region: { minX: 0, minY: 0, maxX: 1, maxY: 1 } }).labels).toEqual(full.labels);
  });

  it("leaves out what only touches the rectangle's edge", () => {
    // The note is 180 wide; 30 of it is inside.
    const { doc } = readCanvas(elements, { region: { minX: 1180, minY: 540, maxX: 1320, maxY: 800 } });
    expect(doc.items.map((i) => i.label)).not.toContain("N1");
  });

  it("lists only the selected cells of a matrix it cuts through", () => {
    const { text, doc } = readCanvas(elements, { region: { minX: 290, minY: 100, maxX: 500, maxY: 200 } });
    expect(doc.items.map((i) => [i.label, i.partly ?? false])).toEqual([["M1", true]]);
    expect(item(text, "M1")!.split("\n").slice(1)).toEqual(["M1 row 1 col 1: 1", "M1 row 1 col 2: 1", "M1 row 2 col 1: 2", "M1 row 2 col 2: 3"]);
    expect(item(text, "M1")).toContain("Partly inside the selection");
  });

  it("names what an arrow leaving the rectangle points at, marked as outside", () => {
    const { text } = readCanvas(elements, { region: { minX: 1230, minY: 540, maxX: 1500, maxY: 800 } });
    expect(item(text, "A2")).toBe("A2 — arrow from M8 (outside the selection) to N1. Tail (1216, 764), head (1312, 672).");
    expect(text).toMatch(/^CANVAS SELECTION, AS TEXT\nOnly what is inside a selected rectangle of this whiteboard, from \(1230, 540\) to \(1500, 800\)/);
  });

  it("says nothing is selected when nothing is", () => {
    const { text, doc } = readCanvas(elements, { region: { minX: 0, minY: 0, maxX: 100, maxY: 100 } });
    expect(doc.items).toEqual([]);
    expect(text.endsWith("\n\nNothing is inside the selection.")).toBe(true);
  });
});

describe("readCanvas: determinism", () => {
  it.each(["normalized", "raw"] as const)("gives the identical read for the same board (%s)", (render) => {
    const a = readCanvas(makeBoard("a", { jitterSeed: 3 }).elements, { render });
    const b = readCanvas(makeBoard("b", { jitterSeed: 3 }).elements, { render });
    expect(a.text).toBe(b.text);
    expect(a.labels).toEqual(b.labels);
  });
});

describe("readCanvas: characters the recognizer is unsure of", () => {
  /** One section of the reader board as saved, on a canvas of its own. */
  const section = (id: string) => {
    const plan = planReaderBoard();
    const { rect } = plan.sections.find((s) => s.id === id)!;
    return planElements(plan).filter((e) => e.x >= rect.minX && e.x + e.width <= rect.maxX && e.y >= rect.minY && e.y + e.height <= rect.maxY);
  };
  const unsure = /«[^«»|\s]+(?:\|[^«»|\s]+)+»/g;

  it("prints them in place as what they may be, most likely first, and says how in the guide", () => {
    const { text, doc } = readCanvas(section("economics-shaky"));
    expect(text).toContain(UNSURE_GUIDE);
    expect(text).not.toMatch(/\?g\d/);
    // No bitmaps: a normalized read prints characters only.
    expect(text).not.toMatch(/^[.#]+$/m);
    const lines = itemsOf(text).map((s) => s.split("\n")[1]!);
    expect(lines.join("\n").match(unsure)?.length).toBeGreaterThan(5);
    // Each unsure character leads with the recognizer's own reading.
    const reads = recognizeDoc(doc.handwriting);
    const t1 = doc.handwriting.blocks.find((b) => b.id === "T1")!;
    const firsts = t1.kind === "text" ? t1.words.flatMap((w) => w.glyphs).map((g) => reads.get(g)!).filter((r) => r.confidence < DEFAULT_MIN_CONFIDENCE).map((r) => r.char) : [];
    expect([...lines[0]!.matchAll(unsure)].map((m) => m[0].slice(1).split("|")[0])).toEqual(firsts);
  });

  it("reads a number's last 0 as a 0, not as an unsure oval (\"100\", not \"10«0|O»\")", () => {
    expect(item(readCanvas(section("economics-shaky")).text, "T1")!.split("\n")[1]).toMatch(/ = 100 - /);
  });

  it("says once when a line is mostly guesswork, and never of a neat hand", () => {
    const shaky = itemsOf(readCanvas(section("chemistry-shaky")).text);
    expect(shaky.filter((s) => s.includes("hard to read: the recognizer is unsure of most of its characters"))).toHaveLength(1);
    for (const id of ["economics-neat", "chemistry-neat", "physics-neat"]) expect(readCanvas(section(id)).text).not.toContain("hard to read");
  });

  it("prints a drawing's unsure labels the same way, with the guide to it even when no handwriting is shown", () => {
    const plan = planDiagramBoard();
    const { rect } = plan.sections.find((s) => s.id === "supply-demand-shaky")!;
    const { text, doc } = readCanvas(strokeElements(plan.strokes), { region: rect });
    expect(doc.items.map((i) => i.kind)).toEqual(["drawing"]);
    expect(text).toContain(UNSURE_GUIDE);
    expect(text).toMatch(/Labels: .*"«[^»]+»"/);
    expect(text).not.toMatch(/read with doubt/);
  });

  it("keeps a script of one unsure character unbraced, and braces a run", () => {
    expect(scriptedText([{ char: "C" }, { char: "«2|z»", script: "sub" }])).toBe("C_«2|z»");
    expect(scriptedText([{ char: "x" }, { char: "1", script: "sup" }, { char: "«0|O»", script: "sup" }])).toBe("x^{1«0|O»}");
  });
});

describe("readCanvas: shaky strokes that once crashed the sketch layer", () => {
  // corners() can merge two close turns into their midpoint, which isn't a
  // vertex of the path; looking it up with indexOf() returned -1 and threw.
  it.each([
    [17, "physics-shaky"],
    [13, "matrix-multiplication-shaky"],
  ])("seed %i, %s reads without throwing", (seed, id) => {
    const plan = planReaderBoard({ seed });
    const { rect } = plan.sections.find((s) => s.id === id)!;
    const elements = planElements(plan).filter((e) => e.x >= rect.minX && e.x + e.width <= rect.maxX && e.y >= rect.minY && e.y + e.height <= rect.maxY);
    expect(() => readCanvas(elements)).not.toThrow();
  });
});
