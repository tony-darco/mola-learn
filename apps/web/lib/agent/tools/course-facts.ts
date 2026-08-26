/**
 * The Phase 0 thin-slice tool.
 *
 * Deliberately trivial in what it does, but it exercises the whole contract-4
 * round trip: registration → JSON-Schema generation → provider tool call →
 * zod-validated execute → ownership-scoped DB read → observation back into the
 * loop. Agent C registers the three retrieval tools through this exact path.
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import { courses, db } from "@mola/db";
import type { Tool } from "../registry";

const inputSchema = z.object({
  field: z
    .enum(["summary", "professor", "number", "instructions"])
    .describe("Which field of the current course to read"),
});

export const courseFactsTool: Tool<z.infer<typeof inputSchema>> = {
  name: "read_course_fact",
  description: "Read one field of the student's current course record (summary, professor, number, instructions).",
  inputSchema,
  label: (input) => `Reading course ${input.field}`,

  async execute(input, ctx) {
    if (!ctx.courseId) return "No course is selected for this chat.";

    // Scoped by userId as well as id — a tool is a read, and reads get checked (§9).
    const [course] = await db
      .select().from(courses)
      .where(eq(courses.id, ctx.courseId))
      .limit(1);

    if (!course || course.userId !== ctx.session.userId) {
      return "Course not found.";
    }
    return course[input.field] ?? `(no ${input.field} recorded)`;
  },
};
