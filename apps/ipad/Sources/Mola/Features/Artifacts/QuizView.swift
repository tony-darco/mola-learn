import SwiftUI

/// Mirrors `QuizStudyView.tsx`: one scrollable form, multiple-choice answers
/// as radio-style rows, graded on submit. Grading uses the same deterministic
/// rule as `lib/quizzes/grading.ts`'s `gradeQuiz` (ported in `Artifact.swift`)
/// but only locally — `submitQuizAttemptAction` is a Server Action, so the
/// score shown here is never written back to `quiz_attempts`. See the iPad
/// README's scope note.
struct QuizView: View {
    let title: String
    let questions: [QuizQuestion]

    @State private var answers: [String: Int] = [:]
    @State private var shortAnswers: [String: String] = [:]
    @State private var submitted = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: MolaSpacing.lg) {
                if submitted {
                    ResultBanner(result: gradeQuiz(questions, answers: answers))
                }
                ForEach(Array(questions.enumerated()), id: \.element.id) { index, question in
                    QuestionCard(
                        index: index + 1, question: question,
                        selected: answers[question.id],
                        shortAnswerText: Binding(
                            get: { shortAnswers[question.id] ?? "" },
                            set: { shortAnswers[question.id] = $0 }
                        ),
                        submitted: submitted,
                        onSelect: { answers[question.id] = $0 }
                    )
                }
                Button(submitted ? "Retake" : "Submit quiz") {
                    if submitted {
                        submitted = false
                        answers = [:]
                        shortAnswers = [:]
                    } else {
                        submitted = true
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(MolaColor.accent)
                .frame(maxWidth: .infinity)
                .disabled(!submitted && answers.count < multipleChoiceCount)
            }
            .padding(MolaSpacing.lg)
        }
        .background(MolaColor.background)
    }

    private var multipleChoiceCount: Int {
        questions.reduce(0) { count, question in
            if case .multipleChoice = question { return count + 1 }
            return count
        }
    }
}

private struct ResultBanner: View {
    let result: (score: Int, total: Int)
    var body: some View {
        HStack {
            Image(systemName: "checkmark.seal.fill").foregroundStyle(MolaColor.success)
            Text("Score \(result.score) / \(result.total)").font(MolaFont.body(.semibold))
        }
        .padding(MolaSpacing.sm)
        .frame(maxWidth: .infinity)
        .molaCard()
    }
}

private struct QuestionCard: View {
    let index: Int
    let question: QuizQuestion
    let selected: Int?
    @Binding var shortAnswerText: String
    let submitted: Bool
    let onSelect: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: MolaSpacing.sm) {
            Text("\(index). \(question.prompt)")
                .font(MolaFont.body(.semibold))
                .foregroundStyle(MolaColor.text)

            switch question {
            case .multipleChoice(_, _, let options, let correctIndex, let explanation):
                ForEach(Array(options.enumerated()), id: \.offset) { i, option in
                    OptionRow(
                        text: option,
                        isSelected: selected == i,
                        isCorrect: submitted ? i == correctIndex : nil,
                        disabled: submitted
                    ) { onSelect(i) }
                }
                if submitted, let explanation {
                    Text(explanation).font(.caption).foregroundStyle(MolaColor.muted)
                }
            case .shortAnswer(_, _, let expectedAnswer, let explanation):
                TextField("Your answer", text: $shortAnswerText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .disabled(submitted)
                if submitted {
                    Text("Expected: \(expectedAnswer)").font(.caption).foregroundStyle(MolaColor.muted)
                    if let explanation {
                        Text(explanation).font(.caption).foregroundStyle(MolaColor.muted)
                    }
                }
            }
        }
        .padding(MolaSpacing.md)
        .molaCard()
    }
}

private struct OptionRow: View {
    let text: String
    let isSelected: Bool
    /// nil before submission; true/false afterward, to highlight right/wrong.
    let isCorrect: Bool?
    let disabled: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack {
                Image(systemName: isSelected ? "largecircle.fill.circle" : "circle")
                Text(text).font(MolaFont.body())
                Spacer()
                if let isCorrect, isSelected {
                    Image(systemName: isCorrect ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundStyle(isCorrect ? MolaColor.success : MolaColor.danger)
                }
            }
            .foregroundStyle(MolaColor.text)
            .padding(.vertical, MolaSpacing.xs)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }
}
