import { eq } from "drizzle-orm";
import { courses, db } from "@mola/db";
import { requireSession } from "@/lib/auth/ownership";
import { PlanTab } from "@/components/plan/PlanTab";
import { parseScenario } from "@/components/plan/fixtures";

export const dynamic = "force-dynamic";

/**
 * The Plan tab. Plans and tasks are fetched client-side against contract D
 * rather than read here: the same three horizons have to re-render after every
 * accept and amendment, and a server read would mean a full round trip through
 * this page for each one. The course list is the exception — it is the only
 * thing on the page that does not change while the student is looking at it.
 */
export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ fixtures?: string }>;
}) {
  const session = await requireSession();
  const [{ fixtures }, userCourses] = await Promise.all([
    searchParams,
    db.select({ id: courses.id, name: courses.name, number: courses.number })
      .from(courses).where(eq(courses.userId, session.userId)),
  ]);

  // `?fixtures=` is a development affordance for looking at the proposal and
  // review states before the planning routes exist; it can never be reached
  // from a deployed build.
  const scenario = process.env.NODE_ENV === "production" ? null : parseScenario(fixtures);

  return <PlanTab courses={userCourses} fixtures={scenario} />;
}
