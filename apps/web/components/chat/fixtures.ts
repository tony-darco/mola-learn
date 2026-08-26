/**
 * Fixture artifacts for the three kinds in contract 6 (packages/shared/src/artifacts.ts).
 *
 * Agents E (flashcards), G (quizzes) and H (mind maps) don't exist yet in Phase 1,
 * so there is no live tool that produces an `artifact` stream event. These fixtures
 * are built directly against the frozen zod schema (`artifactRecordSchema.parse`
 * below guarantees that) so the inline renderers can be built and verified in a
 * real browser ahead of those agents landing. Wired to a dev-only "preview
 * renderers" affordance in the composer — never sent to the server, never
 * persisted.
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

export const ARTIFACT_FIXTURES: ArtifactRecord[] = [
  flashcardDeckFixture,
  quizFixture,
  mindMapFixture,
];
