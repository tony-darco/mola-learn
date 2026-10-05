import Foundation

/// Drives one open canvas: the board state, saving it, and its own chat.
///
/// Scope note (see `apps/ipad/README.md`): this reproduces the web canvas's
/// *data model* exactly (same `CanvasElement` shapes, same save endpoint) but
/// not its full editing surface — no shapes/lines/notes/math/image creation
/// tools, no marquee selection, no undo stack, no hachure fills. Pen, eraser,
/// pan/zoom and a basic text box are enough to actually use the board for
/// what the chat panel is for: asking Mola about what's on it.
@MainActor
final class CanvasViewModel: ObservableObject {
    @Published var elements: [CanvasElement]
    @Published var viewport: CanvasViewport
    @Published var background: CanvasBackground
    @Published var saveError: String?
    @Published var isSaving = false

    // Chat panel state.
    @Published var chatMessages: [CanvasChatMessage] = []
    @Published var chatDraft = ""
    @Published var isChatSending = false
    @Published var chatStreamingText = ""
    @Published var chatError: String?

    let canvasId: String
    let title: String
    private let client: MolaClient
    private var version: Int
    private var order: CanvasOrder
    private var chatId: String?
    /// Coalesces rapid local edits (several strokes in a row) into one save,
    /// the same reason the web client has `lib/canvas/saveQueue.ts` — just a
    /// much smaller version of it (no offline queue, no retry backoff).
    private var saveTask: Task<Void, Never>?

    init(
        canvasId: String, title: String, initialElements: [CanvasElement],
        initialViewport: CanvasViewport, initialBackground: CanvasBackground,
        initialVersion: Int, client: MolaClient
    ) {
        self.canvasId = canvasId
        self.title = title
        self.elements = initialElements
        self.viewport = initialViewport
        self.background = initialBackground
        self.version = initialVersion
        self.order = CanvasOrder(existing: initialElements)
        self.client = client
    }

    // MARK: - Editing

    /// `build` receives the next ordering key (`CanvasOrder`, NOT a unique
    /// id — the caller still has to mint its own `id`, e.g. `UUID().uuidString`).
    func addElement(_ build: (_ index: String) -> CanvasElement) {
        elements.append(build(order.next()))
        scheduleSave()
    }

    func removeElement(id: String) {
        elements.removeAll { $0.id == id }
        scheduleSave()
    }

    /// Called after a pan or pinch-zoom settles — those don't go through
    /// `addElement`/`removeElement` but still change saved state.
    func viewportChanged() {
        scheduleSave()
    }

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 600_000_000)
            guard !Task.isCancelled else { return }
            await self?.save()
        }
    }

    /// `PATCH /api/canvas/:canvasId` (new — see apps/web/app/api/canvas/[canvasId]/route.ts),
    /// which calls the web's own `saveCanvasAction` server-side, CAS check included.
    func save() async {
        isSaving = true
        saveError = nil
        do {
            struct SaveResult: Decodable { let ok: Bool; let version: Int?; let currentVersion: Int? }
            let elementsJSON = try elements.map { try JSONEncoder.molaEncode($0) }
            let result: SaveResult = try await client.send(
                "api/canvas/\(canvasId)", method: "PATCH",
                body: [
                    "elements": elementsJSON,
                    "viewport": ["x": viewport.x, "y": viewport.y, "zoom": viewport.zoom],
                    "background": ["pattern": background.pattern, "color": background.color],
                    "expectedVersion": version,
                ]
            )
            if result.ok, let newVersion = result.version {
                version = newVersion
            } else if let currentVersion = result.currentVersion {
                // Someone else (the web client, say) saved first. Rather than
                // attempt a merge, adopt their version number and let the
                // NEXT local edit's save retry against it — the simplest
                // correct response to losing the CAS race, at the cost of a
                // possible extra round trip.
                version = currentVersion
                saveError = "This canvas changed elsewhere — your next edit will retry the save."
            }
        } catch {
            saveError = error.localizedDescription
        }
        isSaving = false
    }

    // MARK: - Chat

    /// `GET /api/canvas/:canvasId/chat`.
    func loadChat() async {
        do {
            let response: CanvasChatHistoryResponse = try await client.get("api/canvas/\(canvasId)/chat")
            chatId = response.chatId
            chatMessages = response.messages
        } catch {
            chatError = error.localizedDescription
        }
    }

    /// `POST /api/canvas/:canvasId/chat` — always sends the whole board as
    /// context (no selection rectangle; see the scope note above).
    func sendChat() async {
        let text = chatDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isChatSending else { return }
        chatDraft = ""
        isChatSending = true
        chatStreamingText = ""
        chatError = nil

        chatMessages.append(CanvasChatMessage(
            id: UUID().uuidString, role: "user", content: text,
            status: "done", errorMessage: nil, canvasContext: nil
        ))

        do {
            let stream = client.canvasChatStream("api/canvas/\(canvasId)/chat", body: ["message": text])
            for try await event in stream {
                switch event {
                case .textDelta(let delta):
                    chatStreamingText += delta
                case .error(let message):
                    chatError = message
                case .context, .messageEnd, .unknown:
                    break
                }
            }
        } catch {
            chatError = error.localizedDescription
        }

        isChatSending = false
        await loadChat() // reconcile with the persisted turn
    }
}

extension JSONEncoder {
    /// Encodes one `Encodable` value to a `[String: Any]`-compatible JSON
    /// object, for embedding in the hand-built request bodies `MolaClient`'s
    /// `send`/`sendVoid` take (`JSONSerialization`-based, not `Encodable`
    /// end to end — see its own file for why).
    static func molaEncode<T: Encodable>(_ value: T) throws -> Any {
        let data = try JSONEncoder().encode(value)
        return try JSONSerialization.jsonObject(with: data)
    }
}
