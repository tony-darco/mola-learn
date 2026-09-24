/**
 * Fixture artifacts for the three kinds in contract 6 (packages/shared/src/artifacts.ts).
 *
 * Agents E (flashcards), G (quizzes) and H (mind maps) don't exist yet in Phase 1,
 * so there is no live tool that produces an `artifact` stream event. These fixtures
 * are built directly against the frozen zod schema (`artifactRecordSchema.parse`
 * below guarantees that) so the inline renderers can be built and verified in a
 * real browser ahead of those agents landing. Wired to a dev-only preview panel
 * (ArtifactPreviewPanel) — never sent to the server, never persisted, never
 * inserted into the conversation itself.
 */
import { artifactRecordSchema, type ArtifactRecord } from "@mola/shared";

const now = () => new Date();

const flashcardDeckFixture: ArtifactRecord = artifactRecordSchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  userId: "00000000-0000-4000-8000-000000000000",
  courseId: null,
  originChatId: null,
  kind: "flashcard_deck",
  title: "Process Scheduling — Key Terms",
  topics: ["scheduling", "CPU bursts"],
  sources: [],
  payload: {
    kind: "flashcard_deck",
    cards: [
      {
        id: "21111111-1111-4111-8111-111111111111",
        front: "What is a CPU burst?",
        back: "A period during which a process uses the CPU without I/O, ending when it blocks or is preempted.",
        chapter: "ch.5", section: "5.1", week: 6,
      },
      {
        id: "21111111-1111-4111-8111-111111111112",
        front: "Define turnaround time.",
        back: "The total time from a process's submission to its completion, including waiting and execution.",
        chapter: "ch.5", section: "5.2", week: 6,
      },
      {
        id: "21111111-1111-4111-8111-111111111113",
        front: "What does SJF stand for, and what does it minimize?",
        back: "Shortest Job First — it minimizes average waiting time among non-preemptive schedulers.",
        chapter: "ch.5", section: "5.3", week: 6,
      },
    ],
  },
  version: 1,
  createdAt: now(),
  updatedAt: now(),
});

const quizFixture: ArtifactRecord = artifactRecordSchema.parse({
  id: "11111111-1111-4111-8111-111111111122",
  userId: "00000000-0000-4000-8000-000000000000",
  courseId: null,
  originChatId: null,
  kind: "quiz",
  title: "Scheduling — Quick Check",
  topics: ["scheduling"],
  sources: [],
  payload: {
    kind: "quiz",
    difficulty: "standard",
    questions: [
      {
        type: "multiple_choice",
        id: "31111111-1111-4111-8111-111111111111",
        prompt: "Which scheduling algorithm can cause starvation?",
        options: ["Round Robin", "Shortest Job First", "FCFS", "None of these"],
        correctIndex: 1,
        explanation: "SJF can starve long jobs if short jobs keep arriving.",
      },
      {
        type: "short_answer",
        id: "31111111-1111-4111-8111-111111111112",
        prompt: "In one sentence, why does Round Robin need a time quantum?",
        expectedAnswer:
          "To bound how long any one process holds the CPU, so it approximates fair, responsive sharing.",
        explanation: null,
      },
    ],
  },
  version: 1,
  createdAt: now(),
  updatedAt: now(),
});

const mindMapFixture: ArtifactRecord = artifactRecordSchema.parse({
  id: "11111111-1111-4111-8111-111111111133",
  userId: "00000000-0000-4000-8000-000000000000",
  courseId: null,
  originChatId: null,
  kind: "mind_map",
  title: "CPU Scheduling Overview",
  topics: ["scheduling"],
  sources: [],
  payload: {
    kind: "mind_map",
    rootId: "root",
    nodes: [
      { id: "root", label: "CPU Scheduling", parentId: null, note: null },
      { id: "goals", label: "Goals", parentId: "root", note: "Throughput, turnaround, fairness" },
      { id: "algos", label: "Algorithms", parentId: "root", note: null },
      { id: "fcfs", label: "FCFS", parentId: "algos", note: "Simple, convoy effect" },
      { id: "sjf", label: "SJF", parentId: "algos", note: "Optimal avg wait, can starve" },
      { id: "rr", label: "Round Robin", parentId: "algos", note: "Time quantum, fair" },
    ],
    edges: [{ from: "sjf", to: "rr", label: "trade-off" }],
  },
  version: 1,
  createdAt: now(),
  updatedAt: now(),
});

const walkthroughFixture: ArtifactRecord = artifactRecordSchema.parse({
  id: "11111111-1111-4111-8111-111111111144",
  userId: "00000000-0000-4000-8000-000000000000",
  courseId: null,
  originChatId: null,
  kind: "walkthrough",
  title: "Circular Orbits",
  topics: ["orbital mechanics"],
  sources: [],
  payload: {
    kind: "walkthrough",
    subject: "Physics / Orbital Mechanics",
    title: "Circular Orbits",
    parameters: [
      { name: "orbitRadius", label: "Orbit radius", unit: null, default: 60, min: 20, max: 100, step: 5 },
      { name: "period", label: "Orbital period", unit: "s", default: 8, min: 2, max: 20, step: 1 },
    ],
    steps: [
      {
        title: "A planet in circular orbit",
        body: "A planet at distance $r$ from its star, completing one orbit every $T$ seconds, traces a circle. Drag the sliders to see the orbit and its trail respond.",
        quantities: [
          { label: "Angular velocity", latex: "\\omega = 2\\pi/T", expression: "2*pi/period", unit: "rad/s", format: "fixed:2" },
          { label: "Orbital speed", latex: "v = 2\\pi r/T", expression: "2*pi*orbitRadius/period", unit: "units/s", format: "fixed:2" },
        ],
        scene: {
          bodies: [
            { id: "star", label: "Star", radius: "6", x: "0", y: "0", trail: false },
            { id: "planet", label: "Planet", radius: "3", x: "orbitRadius*cos(2*pi*t/period)", y: "orbitRadius*sin(2*pi*t/period)", trail: true },
          ],
          vectors: [
            {
              fromBodyId: "planet",
              label: "velocity",
              dx: "-orbitRadius*(2*pi/period)*sin(2*pi*t/period)",
              dy: "orbitRadius*(2*pi/period)*cos(2*pi*t/period)",
            },
          ],
          scaleBar: { lengthWorldUnits: "orbitRadius", label: "orbit radius" },
          duration: "period",
        },
        chart: null,
        continuesFromPreviousStep: false,
      },
      {
        title: "Watching height oscillate",
        body: "Play the scene and watch the planet's height ($y$-position) trace out a sine wave over one full orbit.",
        quantities: [],
        scene: {
          bodies: [
            { id: "star", label: "Star", radius: "6", x: "0", y: "0", trail: false },
            { id: "planet", label: "Planet", radius: "3", x: "orbitRadius*cos(2*pi*t/period)", y: "orbitRadius*sin(2*pi*t/period)", trail: true },
          ],
          vectors: [],
          scaleBar: { lengthWorldUnits: "orbitRadius", label: "orbit radius" },
          duration: "period",
        },
        chart: {
          independentVar: "t",
          domain: ["0", "period"],
          curves: [{ label: "height (y)", expression: "orbitRadius*sin(2*pi*t/period)", colorRole: "primary" }],
          markerAt: null,
          mode: "timeseries",
        },
        continuesFromPreviousStep: true,
      },
    ],
  },
  version: 1,
  createdAt: now(),
  updatedAt: now(),
});

export const ARTIFACT_FIXTURES: ArtifactRecord[] = [
  flashcardDeckFixture,
  quizFixture,
  mindMapFixture,
  walkthroughFixture,
];
