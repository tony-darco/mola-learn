import Foundation

/// Ported from `packages/shared/src/artifacts.ts` — contract 6, frozen on the
/// web side. Keep these two files in sync by hand; there is no shared schema
/// generation across the Next.js and Swift targets.

struct SourceRef: Codable, Hashable {
    let documentId: String
    let documentTitle: String
    let locator: String?
    let chunkOrdinals: [Int]
}

enum ArtifactKind: String, Codable {
    case flashcardDeck = "flashcard_deck"
    case quiz
    case mindMap = "mind_map"
}

struct Flashcard: Codable, Identifiable, Hashable {
    let id: String
    let front: String
    let back: String
    let chapter: String?
    let section: String?
    let week: Int?
}

enum QuizQuestion: Codable, Identifiable, Hashable {
    case multipleChoice(
        id: String, prompt: String, options: [String], correctIndex: Int, explanation: String?
    )
    case shortAnswer(id: String, prompt: String, expectedAnswer: String, explanation: String?)

    var id: String {
        switch self {
        case .multipleChoice(let id, _, _, _, _): return id
        case .shortAnswer(let id, _, _, _): return id
        }
    }
    var prompt: String {
        switch self {
        case .multipleChoice(_, let prompt, _, _, _): return prompt
        case .shortAnswer(_, let prompt, _, _): return prompt
        }
    }

    private enum CodingKeys: String, CodingKey {
        case type, id, prompt, options, correctIndex, explanation, expectedAnswer
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        let id = try c.decode(String.self, forKey: .id)
        let prompt = try c.decode(String.self, forKey: .prompt)
        let explanation = try c.decodeIfPresent(String.self, forKey: .explanation)
        switch type {
        case "multiple_choice":
            self = .multipleChoice(
                id: id, prompt: prompt,
                options: try c.decode([String].self, forKey: .options),
                correctIndex: try c.decode(Int.self, forKey: .correctIndex),
                explanation: explanation
            )
        case "short_answer":
            self = .shortAnswer(
                id: id, prompt: prompt,
                expectedAnswer: try c.decode(String.self, forKey: .expectedAnswer),
                explanation: explanation
            )
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: c, debugDescription: "unknown quiz question type: \(type)"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .multipleChoice(let id, let prompt, let options, let correctIndex, let explanation):
            try c.encode("multiple_choice", forKey: .type)
            try c.encode(id, forKey: .id)
            try c.encode(prompt, forKey: .prompt)
            try c.encode(options, forKey: .options)
            try c.encode(correctIndex, forKey: .correctIndex)
            try c.encodeIfPresent(explanation, forKey: .explanation)
        case .shortAnswer(let id, let prompt, let expectedAnswer, let explanation):
            try c.encode("short_answer", forKey: .type)
            try c.encode(id, forKey: .id)
            try c.encode(prompt, forKey: .prompt)
            try c.encode(expectedAnswer, forKey: .expectedAnswer)
            try c.encodeIfPresent(explanation, forKey: .explanation)
        }
    }
}

struct MindMapNode: Codable, Identifiable, Hashable {
    let id: String
    let label: String
    let parentId: String?
    let note: String?
    let sources: [SourceRef]
}

struct MindMapEdge: Codable, Hashable {
    let from: String
    let to: String
    let label: String?
}

/// The `payload` discriminated union (`kind`): one of the three artifact
/// shapes. Modeled as an enum with associated values rather than three
/// optional fields on one struct, so a `switch` over it is exhaustive.
enum ArtifactPayload {
    case flashcardDeck(cards: [Flashcard])
    case quiz(questions: [QuizQuestion], difficulty: String)
    case mindMap(rootId: String, nodes: [MindMapNode], edges: [MindMapEdge])
}

extension ArtifactPayload: Codable {
    private enum CodingKeys: String, CodingKey {
        case kind, cards, questions, difficulty, rootId, nodes, edges
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "flashcard_deck":
            self = .flashcardDeck(cards: try c.decode([Flashcard].self, forKey: .cards))
        case "quiz":
            self = .quiz(
                questions: try c.decode([QuizQuestion].self, forKey: .questions),
                difficulty: try c.decode(String.self, forKey: .difficulty)
            )
        case "mind_map":
            self = .mindMap(
                rootId: try c.decode(String.self, forKey: .rootId),
                nodes: try c.decode([MindMapNode].self, forKey: .nodes),
                edges: try c.decode([MindMapEdge].self, forKey: .edges)
            )
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: c, debugDescription: "unknown artifact payload kind"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .flashcardDeck(let cards):
            try c.encode("flashcard_deck", forKey: .kind)
            try c.encode(cards, forKey: .cards)
        case .quiz(let questions, let difficulty):
            try c.encode("quiz", forKey: .kind)
            try c.encode(questions, forKey: .questions)
            try c.encode(difficulty, forKey: .difficulty)
        case .mindMap(let rootId, let nodes, let edges):
            try c.encode("mind_map", forKey: .kind)
            try c.encode(rootId, forKey: .rootId)
            try c.encode(nodes, forKey: .nodes)
            try c.encode(edges, forKey: .edges)
        }
    }
}

/// The persisted row — what `GET /api/artifacts` and the chat SSE `artifact`
/// event both hand the client. Self-contained: no replay of the originating
/// chat needed to render it (same invariant the web app's gallery relies on).
struct ArtifactRecord: Codable, Identifiable, Hashable {
    let id: String
    let userId: String
    let courseId: String?
    let originChatId: String?
    let kind: ArtifactKind
    let title: String
    let topics: [String]
    let sources: [SourceRef]
    let payload: ArtifactPayload
    let version: Int
    let createdAt: String
    let updatedAt: String

    static func == (lhs: ArtifactRecord, rhs: ArtifactRecord) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct ArtifactListResponse: Decodable {
    let artifacts: [ArtifactRecord]
}

/// Client-side, deterministic — ports `lib/quizzes/grading.ts`'s `gradeQuiz`
/// exactly (only `multiple_choice` questions are scored; `short_answer` still
/// counts toward `total`). The server's `submitQuizAttemptAction` is a Next.js
/// Server Action, not a REST endpoint a native client can call, so this score
/// is shown locally but NOT persisted to `quiz_attempts` yet — see the iPad
/// README's "Not wired up" section.
func gradeQuiz(_ questions: [QuizQuestion], answers: [String: Int]) -> (score: Int, total: Int) {
    var score = 0
    for q in questions {
        if case .multipleChoice(let id, _, _, let correctIndex, _) = q, answers[id] == correctIndex {
            score += 1
        }
    }
    return (score, questions.count)
}
