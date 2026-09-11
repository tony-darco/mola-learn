import { FeaturePage } from "@/components/marketing/FeaturePage";

export default function MindmapsFeaturePage() {
  return (
    <FeaturePage
      title="Mindmaps"
      subtitle="See how the ideas in a course connect."
      screenshot={{ src: "/marketing/mindmaps.png", width: 1152, height: 960, alt: "A mindmap in Mola showing how vector space concepts connect" }}
      sections={[
        {
          heading: "Visual, not just text",
          body: "Ask Mola to map out a topic and it builds a mindmap you can explore alongside the chat that generated it.",
        },
        {
          heading: "Grounded in your material",
          body: "Mindmaps are built from what's actually in your course, not a generic outline.",
        },
      ]}
    />
  );
}
