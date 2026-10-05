import SwiftUI

/// Backs the Artifacts/Quizzes/Flashcards/Mindmaps sidebar entries — one
/// view, filtered by kind, against the new `GET /api/artifacts` endpoint
/// (`apps/web/app/api/artifacts/route.ts`) that wraps the same
/// `listAllArtifacts` read the web galleries already use server-side.
struct ArtifactsGalleryView: View {
    @EnvironmentObject private var client: MolaClient
    let kindFilter: ArtifactKind?

    @State private var artifacts: [ArtifactRecord] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var isCreatingCanvas = false
    @State private var newCanvasId: String?

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
            } else if let error {
                ContentUnavailableView("Couldn't load", systemImage: "exclamationmark.triangle", description: Text(error))
            } else if artifacts.isEmpty {
                ContentUnavailableView(
                    emptyTitle, systemImage: emptyIcon,
                    description: Text(emptyDescription)
                )
            } else {
                List(artifacts) { artifact in
                    NavigationLink {
                        ArtifactDetailView(artifact: artifact)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(artifact.title).font(MolaFont.body(.semibold))
                            Text(subtitle(for: artifact)).font(.caption).foregroundStyle(MolaColor.muted)
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .background(MolaColor.background)
        .navigationTitle(title)
        .toolbar {
            // Only the dedicated Canvases page gets a "+" — the unified
            // Artifacts gallery shows every kind, and a canvas is the only
            // one this client can create, so a + there would be confusing.
            if kindFilter == .canvas {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await createCanvas() }
                    } label: { Image(systemName: "plus") }
                    .disabled(isCreatingCanvas)
                }
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .navigationDestination(item: $newCanvasId) { canvasId in
            NewlyCreatedCanvasView(canvasId: canvasId)
        }
    }

    private var title: String {
        switch kindFilter {
        case .none: return "Artifacts"
        case .flashcardDeck: return "Flashcards"
        case .quiz: return "Quizzes"
        case .mindMap: return "Mind maps"
        case .canvas: return "Canvases"
        }
    }
    private var emptyTitle: String { "No \(title.lowercased()) yet" }
    private var emptyDescription: String {
        kindFilter == .canvas
            ? "Tap + to start a blank board."
            : "Ask for one in a chat — e.g. \"quiz me on chapter 4\"."
    }
    private var emptyIcon: String {
        switch kindFilter {
        case .none: return "square.grid.2x2"
        case .flashcardDeck: return "rectangle.on.rectangle"
        case .quiz: return "checklist"
        case .mindMap: return "point.3.connected.trianglepath.dotted"
        case .canvas: return "scribble.variable"
        }
    }

    private func subtitle(for artifact: ArtifactRecord) -> String {
        switch artifact.payload {
        case .flashcardDeck(let cards): return "\(cards.count) cards"
        case .quiz(let questions, let difficulty): return "\(questions.count) questions · \(difficulty)"
        case .mindMap(_, let nodes, _): return "\(nodes.count) concepts"
        case .canvas(let elements, _, _): return "\(elements.count) elements"
        }
    }

    private func load() async {
        isLoading = true
        error = nil
        do {
            var query: [String: String] = [:]
            if let kindFilter { query["kind"] = kindFilter.rawValue }
            let response: ArtifactListResponse = try await client.get("api/artifacts", query: query)
            self.artifacts = response.artifacts
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    /// `POST /api/canvas` (new — see apps/web/app/api/canvas/route.ts), the
    /// REST equivalent of the web's `createCanvasAction` (a Server Action
    /// that redirects, which this client can't follow the same way).
    private func createCanvas() async {
        isCreatingCanvas = true
        defer { isCreatingCanvas = false }
        do {
            struct Created: Decodable { let id: String }
            let created: Created = try await client.send("api/canvas", method: "POST", body: ["title": "Untitled canvas"])
            newCanvasId = created.id
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// A thin redirect target: `createCanvas()` only gets an id back, not a full
/// `ArtifactRecord`, so this re-fetches the gallery and opens the real detail
/// view once the new (empty) canvas is in it — avoids constructing a fake
/// `ArtifactRecord` client-side just to satisfy `ArtifactDetailView`'s init.
private struct NewlyCreatedCanvasView: View {
    @EnvironmentObject private var client: MolaClient
    let canvasId: String
    @State private var artifact: ArtifactRecord?
    @State private var error: String?

    var body: some View {
        Group {
            if let artifact {
                ArtifactDetailView(artifact: artifact)
            } else if let error {
                ContentUnavailableView("Couldn't open canvas", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                ProgressView()
            }
        }
        .task {
            do {
                let response: ArtifactListResponse = try await client.get("api/artifacts", query: ["kind": "canvas"])
                artifact = response.artifacts.first { $0.id == canvasId }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
