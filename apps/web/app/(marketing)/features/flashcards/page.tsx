import { FeaturePage } from "@/components/marketing/FeaturePage";

export default function FlashcardsFeaturePage() {
  return (
    <FeaturePage
      title="Flashcards"
      subtitle="Spaced-repetition decks built from your own material."
      screenshot={{ src: "/marketing/flashcards.png", width: 1152, height: 820, alt: "A flashcard deck in Mola, generated from a Linear Algebra course" }}
      sections={[
        {
          heading: "Built on demand",
          body: "Ask Mola to turn a topic, a set of notes, or a chapter into a flashcard deck, scoped to the course it came from.",
        },
        {
          heading: "Stays organized",
          body: "Decks live alongside your other study material for that course, not in a separate app.",
        },
      ]}
    />
  );
}
