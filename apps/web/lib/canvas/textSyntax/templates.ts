/**
 * Reference shapes for the character recognizer (recognize.ts): a few
 * hand-drawn variants of every character it knows, the way different people
 * write them — a "1" bare or with a flag and base, an open and a closed "4",
 * a "7" with and without a crossbar, one- and two-stroke "R"s.
 *
 * Each variant is a list of strokes; each stroke is a polyline in pen order,
 * on a grid 10 wide and 16 tall (x across, y down). Only the shape matters —
 * the recognizer rescales everything — so the grid is just for drawing.
 */
type Stroke = [number, number][];
type Variant = Stroke[];

export const TEMPLATES: Record<string, Variant[]> = {
  "0": [
    // An oval started at the top, drawn anticlockwise.
    [[[5, 0], [2.5, 1], [1, 4], [0.5, 8], [1, 12], [2.5, 15], [5, 16], [7.5, 15], [9, 12], [9.5, 8], [9, 4], [7.5, 1], [5, 0]]],
    // Narrow and leaning, the end overshooting the start.
    [[[6, 0.5], [3.5, 1.5], [2, 5], [1.5, 9], [2, 13], [4, 16], [6, 15.5], [7.5, 12.5], [8.5, 8], [8.5, 3.5], [7, 0.5], [5, 0], [3.5, 1]]],
    // Boxy.
    [[[2, 1], [1, 4], [1, 12], [2, 15], [8, 15], [9, 12], [9, 4], [8, 1], [2, 1]]],
  ],
  "1": [
    [[[5, 0], [5, 16]]],
    // With a flag.
    [[[2, 4], [5.5, 0], [5.5, 16]]],
    // With a flag and a base.
    [[[2.5, 3.5], [5.5, 0], [5.5, 16]], [[2, 16], [9, 16]]],
  ],
  "2": [
    // Round top, straight diagonal, flat base.
    [[[1, 4], [2, 1.5], [4.5, 0], [7, 0.5], [8.5, 2.5], [8.5, 5], [7, 8], [4, 11.5], [1, 16], [9.5, 16]]],
    // A small loop where the diagonal meets the base.
    [[[1, 3.5], [3, 0.5], [6, 0], [8.5, 2], [8.5, 5.5], [6, 9], [2, 14], [1.5, 16], [3, 15], [5, 15.5], [9, 16]]],
    // Angular, almost a Z.
    [[[1, 1], [8, 0], [8.5, 3], [1, 16], [9, 15.5]]],
  ],
  "3": [
    // Two round bumps.
    [[[1, 2], [3.5, 0], [6.5, 0], [8.5, 2], [8, 5.5], [5, 7.5], [3.5, 8], [6.5, 8.5], [9, 11], [8.5, 14], [6, 16], [3, 16], [0.5, 14]]],
    // Flat top.
    [[[1, 0], [9, 0], [4.5, 6.5], [7, 7], [9, 9.5], [9, 13], [7, 15.5], [4, 16], [1, 14.5]]],
  ],
  "4": [
    // Open: an L, then the upright.
    [[[2, 0], [1, 9.5], [9.5, 9.5]], [[7, 4], [7, 16]]],
    // Closed: a slanted triangle, then the upright through it.
    [[[6.5, 0.5], [0.5, 10.5], [9.5, 10.5]], [[7, 0], [7, 16]]],
  ],
  "5": [
    // Body first, then the top bar as a separate stroke.
    [[[2, 0], [1.5, 7], [4, 6], [7, 6.5], [9, 9], [9, 12.5], [7, 15.5], [4, 16], [1, 14.5]], [[2, 0], [8.5, 0]]],
    // One stroke, bar first, with a wide belly.
    [[[9, 0.5], [2.5, 0.5], [1.5, 7.5], [5, 6.5], [8, 8], [9, 11.5], [8, 14.5], [5, 16], [2, 15.5], [0.5, 14]]],
  ],
  "6": [
    // A long curl down into a small loop.
    [[[7.5, 0], [4.5, 1.5], [2, 5], [1, 9], [1.5, 13], [3.5, 15.5], [6, 16], [8.5, 14], [9, 11], [7.5, 8.5], [5, 8], [2.5, 9], [1.2, 11]]],
    // A straighter stem.
    [[[6, 0], [2.5, 7], [1.5, 11], [2, 14.5], [5, 16], [8, 15], [9, 12], [7.5, 9.5], [4.5, 9.5], [2, 11.5]]],
  ],
  "7": [
    [[[0.5, 0.5], [9.5, 0.5], [6.5, 6], [4, 16]]],
    // With a crossbar.
    [[[0.5, 0], [9, 0], [3.5, 16]], [[3, 8], [8.5, 8]]],
    // A curved stem.
    [[[1, 1], [9.5, 0.5], [7, 4.5], [5, 9], [4.5, 16]]],
  ],
  "8": [
    // One stroke: an S down, then back up through the middle.
    [[[8, 2.5], [6.5, 0.3], [4, 0], [1.8, 1.5], [2, 4.5], [5, 7.5], [8.5, 10.5], [8.5, 14.5], [5.5, 16], [2, 15], [1, 12], [2.5, 9.5], [5, 7.5], [7.5, 5], [8, 2.5]]],
    // Two stacked loops, the top one smaller.
    [[[5, 0], [2, 1.5], [2, 5.5], [5, 7], [8, 5.5], [8, 1.5], [5, 0]], [[5, 7], [1, 9], [0.5, 13], [3, 16], [7, 16], [9.5, 13], [9, 9], [5, 7]]],
  ],
  "9": [
    // A loop and a straight stem.
    [[[8.5, 3], [6.5, 0.3], [3.5, 0], [1, 2], [1, 5], [3, 7], [6, 7], [8.5, 4.5], [8.5, 3], [8.5, 16]]],
    // A loop and a curved tail.
    [[[8, 2], [5.5, 0], [2.5, 0.5], [1, 3.5], [2, 6.5], [5, 7], [8, 5], [8.5, 2], [8.5, 8], [7.5, 12.5], [5, 15.5], [2, 16]]],
  ],
  "-": [
    [[[0, 0], [10, 0]]],
    [[[0, 0.6], [10, -0.3]]],
  ],
  "+": [
    [[[5, 1], [5, 9]], [[1, 5], [9, 5]]],
    [[[0.5, 4.5], [9.5, 5]], [[5.5, 0], [4.5, 10]]],
  ],
  "=": [
    [[[0, 0], [10, 0]], [[0, 4], [10, 4]]],
    [[[0.5, 0], [9, 0.3]], [[0, 4.5], [10, 4.2]]],
  ],
  R: [
    // One stroke: up the stem, round the bowl, back to the stem, out along the leg.
    [[[1, 16], [1, 0], [5.5, 0], [8, 1.5], [8.5, 4], [7.5, 6.5], [4.5, 7.5], [1, 7.5], [4.5, 7.5], [9, 16]]],
    // The stem, then bowl and leg together.
    [[[1, 0], [1, 16]], [[1, 0], [6, 0], [8.5, 2], [8.5, 5], [6, 7.5], [1.5, 8], [4, 8.5], [9, 16]]],
    // Stem and bowl, then a curved leg.
    [[[1.5, 16], [1, 0], [6, 0.5], [8.5, 3], [7.5, 6.5], [1.5, 8]], [[4, 8], [6.5, 11], [9, 16]]],
  ],
  "↓": [
    // The shaft, then an open head.
    [[[5, 0], [5, 16]], [[1.5, 12], [5, 16], [8.5, 12]]],
    // A closed, triangular head.
    [[[5, 0], [5, 13]], [[1, 12], [9, 12], [5, 16.5], [1, 12]]],
    // One stroke, going back over the tip.
    [[[5, 0], [5, 16], [1, 12], [5, 16], [9, 12]]],
  ],
};
