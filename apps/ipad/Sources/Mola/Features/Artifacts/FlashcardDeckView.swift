import SwiftUI

/// Mirrors `FlashcardStudyView.tsx`'s flashcards mode: one card, flip to
/// reveal, step through the deck. Grading (`RecordLearnGradeAction` /
/// `record_flashcard_review`) is a Next.js Server Action / agent-only tool —
/// not reachable from this client yet — so this is browse/study only; it
/// does not advance the real FSRS schedule. See the iPad README.
struct FlashcardDeckView: View {
    let title: String
    let cards: [Flashcard]

    @State private var index = 0
    @State private var flipped = false

    var body: some View {
        VStack(spacing: MolaSpacing.lg) {
            if cards.isEmpty {
                ContentUnavailableView("Empty deck", systemImage: "rectangle.on.rectangle")
            } else {
                Text("\(index + 1) / \(cards.count)")
                    .font(.caption)
                    .foregroundStyle(MolaColor.muted)

                CardFace(card: cards[index], flipped: flipped)
                    .onTapGesture { withAnimation(.easeInOut(duration: 0.25)) { flipped.toggle() } }
                    .frame(maxWidth: 560, minHeight: 280)

                HStack(spacing: MolaSpacing.lg) {
                    Button {
                        withAnimation { step(by: -1) }
                    } label: { Image(systemName: "chevron.left.circle.fill").font(.system(size: 32)) }
                    .disabled(index == 0)

                    Button("Flip") { withAnimation(.easeInOut(duration: 0.25)) { flipped.toggle() } }
                        .buttonStyle(.bordered)

                    Button {
                        withAnimation { step(by: 1) }
                    } label: { Image(systemName: "chevron.right.circle.fill").font(.system(size: 32)) }
                    .disabled(index == cards.count - 1)
                }
                .tint(MolaColor.accent)
            }
        }
        .padding(MolaSpacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(MolaColor.background)
    }

    private func step(by delta: Int) {
        index = max(0, min(cards.count - 1, index + delta))
        flipped = false
    }
}

private struct CardFace: View {
    let card: Flashcard
    let flipped: Bool

    var body: some View {
        VStack(spacing: MolaSpacing.sm) {
            if let chapter = card.chapter {
                Text(chapterLabel(chapter, section: card.section))
                    .font(.caption)
                    .foregroundStyle(MolaColor.muted)
            }
            Text(flipped ? card.back : card.front)
                .font(MolaFont.title(22))
                .multilineTextAlignment(.center)
                .foregroundStyle(MolaColor.text)
            if !flipped {
                Text("Tap to reveal").font(.caption).foregroundStyle(MolaColor.muted)
            }
        }
        .padding(MolaSpacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .molaCard()
    }

    /// Matches `FlashcardStudyView.tsx` exactly: `[Ch. x, section].filter(Boolean).join(" · ")`.
    private func chapterLabel(_ chapter: String, section: String?) -> String {
        [("Ch. " + chapter), section].compactMap { $0 }.joined(separator: " · ")
    }
}
