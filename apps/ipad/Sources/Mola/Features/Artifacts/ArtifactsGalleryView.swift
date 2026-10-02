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

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
            } else if let error {
                ContentUnavailableView("Couldn't load", systemImage: "exclamationmark.triangle", description: Text(error))
            } else if artifacts.isEmpty {
                ContentUnavailableView(
                    emptyTitle, systemImage: emptyIcon,
                    description: Text("Ask for one in a chat — e.g. \"quiz me on chapter 4\".")
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
        .task { await load() }
        .refreshable { await load() }
    }

    private var title: String {
        switch kindFilter {
        case .none: return "Artifacts"
        case .flashcardDeck: return "Flashcards"
        case .quiz: return "Quizzes"
        case .mindMap: return "Mind maps"
        }
    }
    private var emptyTitle: String { "No \(title.lowercased()) yet" }
    private var emptyIcon: String {
        switch kindFilter {
        case .none: return "square.grid.2x2"
        case .flashcardDeck: return "rectangle.on.rectangle"
        case .quiz: return "checklist"
        case .mindMap: return "point.3.connected.trianglepath.dotted"
        }
    }

    private func subtitle(for artifact: ArtifactRecord) -> String {
        switch artifact.payload {
        case .flashcardDeck(let cards): return "\(cards.count) cards"
        case .quiz(let questions, let difficulty): return "\(questions.count) questions · \(difficulty)"
        case .mindMap(_, let nodes, _): return "\(nodes.count) concepts"
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
}
