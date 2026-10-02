import SwiftUI

/// The compact inline card a new artifact renders as the moment it streams
/// into a chat turn — mirrors `ArtifactBlock.tsx`'s role, title + a one-line
/// summary per kind, tappable through to the full study view.
struct ArtifactBlockView: View {
    let artifact: ArtifactRecord
    @State private var presenting = false

    var body: some View {
        Button { presenting = true } label: {
            HStack(spacing: MolaSpacing.sm) {
                Image(systemName: icon).font(.title3).foregroundStyle(MolaColor.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(artifact.title).font(MolaFont.body(.semibold)).foregroundStyle(MolaColor.text)
                    Text(summary).font(.caption).foregroundStyle(MolaColor.muted)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(MolaColor.muted)
            }
            .padding(MolaSpacing.sm)
        }
        .buttonStyle(.plain)
        .molaCard()
        .sheet(isPresented: $presenting) { ArtifactDetailView(artifact: artifact) }
    }

    private var icon: String {
        switch artifact.kind {
        case .flashcardDeck: return "rectangle.on.rectangle"
        case .quiz: return "checklist"
        case .mindMap: return "point.3.connected.trianglepath.dotted"
        }
    }

    private var summary: String {
        switch artifact.payload {
        case .flashcardDeck(let cards): return "\(cards.count) cards"
        case .quiz(let questions, let difficulty): return "\(questions.count) questions · \(difficulty)"
        case .mindMap(_, let nodes, _): return "\(nodes.count) concepts"
        }
    }
}

/// Routes to the right study surface for the artifact's kind — the detail
/// screen behind both the gallery and an inline chat card.
struct ArtifactDetailView: View {
    let artifact: ArtifactRecord

    var body: some View {
        NavigationStack {
            Group {
                switch artifact.payload {
                case .flashcardDeck(let cards):
                    FlashcardDeckView(title: artifact.title, cards: cards)
                case .quiz(let questions, _):
                    QuizView(title: artifact.title, questions: questions)
                case .mindMap(let rootId, let nodes, let edges):
                    MindMapView(title: artifact.title, rootId: rootId, nodes: nodes, edges: edges)
                }
            }
            .navigationTitle(artifact.title)
            .navigationBarTitleDisplayMode(.inline)
        }
        .background(MolaColor.background)
    }
}
