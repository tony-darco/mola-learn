import Foundation

/// One in-flight or finished assistant turn, built up from `StreamEvent`s —
/// the client-side mirror of what `messages.toolCalls` persists server-side,
/// kept just for the duration of a live stream (a reload re-fetches the
/// persisted row instead of replaying this).
struct ActivityEntry: Identifiable, Hashable {
    enum Kind: Hashable { case tool(status: String), subagent }
    let id: String
    let kind: Kind
    let label: String
}

@MainActor
final class ChatViewModel: ObservableObject {
    @Published var messages: [ChatMessage] = []
    @Published var artifacts: [ArtifactRecord] = []
    @Published var course: CourseOption?
    @Published var draft = ""
    @Published var isSending = false
    @Published var streamingText = ""
    @Published var activity: [ActivityEntry] = []
    @Published var error: String?

    let chatId: String
    private let client: MolaClient

    init(chatId: String, client: MolaClient) {
        self.chatId = chatId
        self.client = client
    }

    func load() async {
        do {
            let detail: ChatDetailResponse = try await client.get("api/chat/\(chatId)")
            self.messages = detail.messages
            self.artifacts = detail.artifacts
            self.course = detail.course
        } catch {
            self.error = error.localizedDescription
        }
    }

    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSending else { return }
        draft = ""
        isSending = true
        streamingText = ""
        activity = []
        error = nil

        // Optimistic local echo — the server's own copy of this turn arrives
        // in the next `load()`, same as the web client's optimistic append in
        // `ChatMain.tsx`.
        messages.append(ChatMessage(
            id: UUID().uuidString, chatId: chatId, role: "user",
            content: text, status: nil, createdAt: ISO8601DateFormatter().string(from: Date())
        ))

        do {
            let stream = client.streamPost("api/chat/\(chatId)", body: ["message": text])
            for try await event in stream {
                handle(event)
            }
        } catch {
            self.error = error.localizedDescription
        }

        isSending = false
        await load() // reconcile with the server's persisted turn
    }

    private func handle(_ event: StreamEvent) {
        switch event {
        case .textDelta(let text):
            streamingText += text
        case .toolCallStart(let id, _, let label):
            activity.append(ActivityEntry(id: id, kind: .tool(status: "running"), label: label))
        case .toolCallEnd(let id, let status, let summary):
            if let idx = activity.firstIndex(where: { $0.id == id }) {
                activity[idx] = ActivityEntry(id: id, kind: .tool(status: status), label: summary)
            }
        case .subagentStart(let id, let label):
            activity.append(ActivityEntry(id: id, kind: .subagent, label: label))
        case .artifact(let record):
            artifacts.append(record)
        case .error(let message):
            self.error = message
        case .messageStart, .subagentEnd, .hintState, .compacted, .messageEnd, .unknown:
            break
        }
    }
}
