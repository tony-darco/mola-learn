import { FeaturePage } from "@/components/marketing/FeaturePage";

export default function AgentsFeaturePage() {
  return (
    <FeaturePage
      title="Agents"
      subtitle="The tutoring loop behind every chat."
      screenshot={{ src: "/marketing/agents.png", width: 1152, height: 1060, alt: "A real Mola chat walking a student through matrix multiplication with guiding questions" }}
      sections={[
        {
          heading: "Reasons before it answers",
          body: "Every chat is powered by an agentic loop that reads your course material and reasons about what you're stuck on before responding.",
        },
        {
          heading: "Teaches with hints, not answers",
          body: "Rather than handing you a solution outright, Mola walks you toward one — a Socratic approach, not a lookup.",
        },
      ]}
      note="There's no separate Agents page yet — this is the system behind chat today."
    />
  );
}
