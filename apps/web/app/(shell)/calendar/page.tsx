import { requireSession } from "@/lib/auth/ownership";
import { listCoursesForFilters } from "@/lib/artifacts/filters";
import { CalendarSurface } from "@/components/calendar/CalendarSurface";

export const dynamic = "force-dynamic";

/**
 * The calendar surface (§5's "when"). Inside `(shell)` so it keeps the sidebar.
 *
 * Only the course filter is server-rendered — everything date-shaped is read
 * from the viewer's own clock and timezone on the client, and events are
 * fetched through the same `/api/calendar/events` window the rest of the app
 * uses rather than a second server-side read that could drift from it.
 */
export default async function CalendarPage() {
  const session = await requireSession();
  const courses = await listCoursesForFilters(session.userId);

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <CalendarSurface courses={courses} />
    </main>
  );
}
