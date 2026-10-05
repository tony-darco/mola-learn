import Foundation

/// Ported from `packages/shared/src/planning.ts` (contract D).

struct PlannedItem: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let kind: String // one of PLANNED_ITEM_KINDS: study, homework, review, reading, practice_quiz, flashcards, break
    let courseId: String?
    let estimatedMinutes: Int?
    let startAt: String?
    let relatedScheduleItemId: String?
    let rationale: String?
}

struct PlanFocus: Codable, Hashable {
    let courseId: String?
    let text: String
}

struct PlanGoal: Codable, Hashable {
    let courseId: String?
    let text: String
}

struct PlanMilestone: Codable, Identifiable, Hashable {
    let title: String
    let courseId: String?
    let targetDate: String
    let kind: String // exam | project | unit | checkpoint

    var id: String { title + targetDate }
}

struct WeekDay: Codable, Hashable {
    let date: String
    let items: [PlannedItem]
}

/// The `payload` discriminated union (`horizon`). Declared `Hashable`
/// directly (synthesized — every associated value across all three cases is
/// itself `Hashable`) rather than only in the `Codable` extension below,
/// since `PlanRecord` needs it for its own synthesized `Hashable`.
enum PlanPayload: Hashable {
    case day(date: String, summary: String?, items: [PlannedItem])
    case week(weekStart: String, summary: String, focus: [PlanFocus], days: [WeekDay], risks: [String])
    case semester(summary: String, goals: [PlanGoal], milestones: [PlanMilestone])
}

extension PlanPayload: Codable {
    private enum CodingKeys: String, CodingKey {
        case horizon, date, summary, items, weekStart, focus, days, risks, goals, milestones
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .horizon) {
        case "day":
            self = .day(
                date: try c.decode(String.self, forKey: .date),
                summary: try c.decodeIfPresent(String.self, forKey: .summary),
                items: try c.decode([PlannedItem].self, forKey: .items)
            )
        case "week":
            self = .week(
                weekStart: try c.decode(String.self, forKey: .weekStart),
                summary: try c.decode(String.self, forKey: .summary),
                focus: try c.decodeIfPresent([PlanFocus].self, forKey: .focus) ?? [],
                days: try c.decode([WeekDay].self, forKey: .days),
                risks: try c.decodeIfPresent([String].self, forKey: .risks) ?? []
            )
        case "semester":
            self = .semester(
                summary: try c.decode(String.self, forKey: .summary),
                goals: try c.decodeIfPresent([PlanGoal].self, forKey: .goals) ?? [],
                milestones: try c.decodeIfPresent([PlanMilestone].self, forKey: .milestones) ?? []
            )
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .horizon, in: c, debugDescription: "unknown plan horizon"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .day(let date, let summary, let items):
            try c.encode("day", forKey: .horizon)
            try c.encode(date, forKey: .date)
            try c.encodeIfPresent(summary, forKey: .summary)
            try c.encode(items, forKey: .items)
        case .week(let weekStart, let summary, let focus, let days, let risks):
            try c.encode("week", forKey: .horizon)
            try c.encode(weekStart, forKey: .weekStart)
            try c.encode(summary, forKey: .summary)
            try c.encode(focus, forKey: .focus)
            try c.encode(days, forKey: .days)
            try c.encode(risks, forKey: .risks)
        case .semester(let summary, let goals, let milestones):
            try c.encode("semester", forKey: .horizon)
            try c.encode(summary, forKey: .summary)
            try c.encode(goals, forKey: .goals)
            try c.encode(milestones, forKey: .milestones)
        }
    }
}

/// `GET /api/plan?horizon=...` response's `plan` field — `lib/planning/lifecycle.ts`'s `PlanRecord`.
struct PlanRecord: Codable, Identifiable, Hashable {
    let id: String
    let horizon: String
    let periodStart: String
    let periodEnd: String?
    let status: String // proposed | approved | amended | superseded
    let payload: PlanPayload
    let approvedAt: String?
    let parentPlanId: String?
}

struct PlanResponse: Decodable {
    let plan: PlanRecord?
}

/// `lib/planning`'s `TaskView` — what `GET /api/tasks` returns.
struct TaskView: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let notes: String?
    let status: String // todo | done | skipped
    let source: String // plan | student | agent
    let courseId: String?
    let courseName: String?
    let scheduledFor: String?
    let estimatedMinutes: Int?
    let completedAt: String?
    let scheduleItemId: String?
}

struct TasksResponse: Decodable {
    let tasks: [TaskView]
}
