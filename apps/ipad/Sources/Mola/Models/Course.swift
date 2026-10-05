import Foundation

/// A full `courses` row, as returned by `GET /api/courses`.
struct Course: Decodable, Identifiable, Hashable {
    let id: String
    let termId: String?
    let name: String
    let number: String?
    let professor: String?
    let summary: String?
    let instructions: String?
}

struct Term: Decodable, Identifiable, Hashable {
    let id: String
    let label: String
}

struct CoursesResponse: Decodable {
    let terms: [Term]
    let courses: [Course]
}
