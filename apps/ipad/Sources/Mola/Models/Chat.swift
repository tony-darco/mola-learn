import Foundation

/// A row from `GET /api/chat` — matches that route's hand-picked column set
/// exactly (`apps/web/app/api/chat/route.ts`), not the full `chats` table.
struct ChatSummary: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let courseId: String?
    let updatedAt: String
    /// `chats.is_pinned` is a Postgres `integer` (0/1), not a boolean column
    /// (`packages/db/src/schema.ts`) — decoded as a number and exposed as
    /// `Bool` via `isPinned`.
    let isPinnedRaw: Int

    var isPinned: Bool { isPinnedRaw != 0 }

    enum CodingKeys: String, CodingKey {
        case id, title, courseId, updatedAt
        case isPinnedRaw = "isPinned"
    }
}

struct ChatListResponse: Decodable {
    let chats: [ChatSummary]
    let courses: [CourseOption]
}

struct CourseOption: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let number: String?
}

/// One persisted turn. `toolCalls` is the activity log `route.ts` persists
/// alongside the assistant message (tool/sub-agent rows, for re-rendering a
/// reload without replaying the stream) — kept as raw JSON here since its
/// shape is a web-rendering concern the client doesn't need to interpret.
struct ChatMessage: Decodable, Identifiable, Hashable {
    let id: String
    let chatId: String
    let role: String // "user" | "assistant"
    let content: String
    let status: String? // "streaming" | "done" | "error", present on assistant turns
    let createdAt: String

    static func == (lhs: ChatMessage, rhs: ChatMessage) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// `GET /api/chat/:chatId`'s actual response shape — richer than the list
/// row: joined course, the chat's own artifacts, and the active compaction
/// boundary (older turns collapsed into a summary; see §4 in the web repo).
struct ChatDetailResponse: Decodable {
    let chat: ChatSummary
    let course: CourseOption?
    let messages: [ChatMessage]
    let artifacts: [ArtifactRecord]
    let hasOwnKey: Bool
}

// MARK: - SSE stream events (contract 6, packages/shared/src/stream.ts)

/// The server→client event taxonomy, decoded from each SSE `data:` line.
/// A manually-written `Decodable` because `type` is a discriminator over a
/// union, not a Swift enum Codable can infer automatically.
enum StreamEvent {
    case messageStart(messageId: String)
    case textDelta(text: String)
    case toolCallStart(toolCallId: String, name: String, label: String)
    case toolCallEnd(toolCallId: String, status: String, summary: String)
    case subagentStart(subagentId: String, label: String)
    case subagentEnd(subagentId: String)
    case artifact(ArtifactRecord)
    case hintState(rung: String, canEscalate: Bool)
    case compacted(throughMessageId: String)
    case messageEnd(messageId: String, stopReason: String)
    case error(message: String)
    case unknown
}

extension StreamEvent {
    /// Decodes one SSE payload (the JSON after `data: `). Unknown/future
    /// event types decode to `.unknown` rather than throwing, so a client
    /// built against an older contract degrades instead of breaking the
    /// whole stream.
    static func decode(from data: Data) -> StreamEvent {
        guard
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = obj["type"] as? String
        else { return .unknown }

        switch type {
        case "message_start":
            guard let id = obj["messageId"] as? String else { return .unknown }
            return .messageStart(messageId: id)
        case "text_delta":
            return .textDelta(text: obj["text"] as? String ?? "")
        case "tool_call_start":
            return .toolCallStart(
                toolCallId: obj["toolCallId"] as? String ?? "",
                name: obj["name"] as? String ?? "",
                label: obj["label"] as? String ?? ""
            )
        case "tool_call_end":
            return .toolCallEnd(
                toolCallId: obj["toolCallId"] as? String ?? "",
                status: obj["status"] as? String ?? "error",
                summary: obj["summary"] as? String ?? ""
            )
        case "subagent_start":
            return .subagentStart(
                subagentId: obj["subagentId"] as? String ?? "",
                label: obj["label"] as? String ?? ""
            )
        case "subagent_end":
            return .subagentEnd(subagentId: obj["subagentId"] as? String ?? "")
        case "artifact":
            guard
                let artifactObj = obj["artifact"],
                let artifactData = try? JSONSerialization.data(withJSONObject: artifactObj),
                let record = try? JSONDecoder.mola.decode(ArtifactRecord.self, from: artifactData)
            else { return .unknown }
            return .artifact(record)
        case "hint_state":
            return .hintState(
                rung: obj["rung"] as? String ?? "pointing",
                canEscalate: obj["canEscalate"] as? Bool ?? false
            )
        case "compacted":
            return .compacted(throughMessageId: obj["throughMessageId"] as? String ?? "")
        case "message_end":
            return .messageEnd(
                messageId: obj["messageId"] as? String ?? "",
                stopReason: obj["stopReason"] as? String ?? "end_turn"
            )
        case "error":
            return .error(message: obj["message"] as? String ?? "unknown error")
        default:
            return .unknown
        }
    }
}

extension JSONDecoder {
    static let mola: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()
}
