import { FeaturePage } from "@/components/marketing/FeaturePage";

export default function QuizzesFeaturePage() {
  return (
    <FeaturePage
      title="Quizzes"
      subtitle="Turn your course material into practice questions in seconds."
      sections={[
        {
          heading: "Generated from what you're studying",
          body: "Ask for a quiz in chat and Mola builds one from your syllabus, notes, or anything else you've uploaded to that course — not a generic question bank.",
        },
        {
          heading: "You set the pace",
          body: "Choose how many questions you want each time. Mola remembers your default so you don't have to ask again.",
        },
      ]}
    />
  );
}
