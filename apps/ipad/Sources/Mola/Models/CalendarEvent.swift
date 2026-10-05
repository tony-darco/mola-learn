import Foundation

/// `packages/shared/src/planning.ts`'s `CalendarEvent` — a `schedule_items`
/// row flattened for rendering, as `GET /api/calendar/events` returns it.
struct CalendarEvent: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let kind: String // deadline | recurring_task | study_session | class | exam | assignment | event
    let source: String // ics | google | student | chat | plan
    let courseId: String?
    let courseName: String?
    let start: String // ISO 8601
    let end: String?
    let allDay: Bool
    let location: String?
    let description: String?
    let completedAt: String?
}

struct CalendarEventsResponse: Decodable {
    let events: [CalendarEvent]
}
