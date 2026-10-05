import SwiftUI

/// A trimmed version of `app/(shell)/courses/[id]/page.tsx`: name, number,
/// professor, summary, instructions, and the course's own chats. The web
/// page also shows uploaded documents, course memory and schedule items —
/// those panels read straight from the database in a server component with
/// no JSON route behind them, so they're not reachable from this client yet
/// (see the iPad README's scope note) and are left out rather than faked.
struct CourseDetailView: View {
    @EnvironmentObject private var client: MolaClient
    @EnvironmentObject private var sidebarModel: SidebarViewModel
    let courseId: String

    @State private var course: Course?
    @State private var isLoading = true
    @State private var error: String?

    private var courseChats: [ChatSummary] {
        sidebarModel.chats.filter { $0.courseId == courseId }
    }

    var body: some View {
        ScrollView {
            if let course {
                VStack(alignment: .leading, spacing: MolaSpacing.md) {
                    Text(headline(for: course))
                        .font(MolaFont.title(28))
                        .foregroundStyle(MolaColor.text)

                    if let professor = course.professor {
                        Label(professor, systemImage: "person").font(MolaFont.body()).foregroundStyle(MolaColor.muted)
                    }

                    if let summary = course.summary, !summary.isEmpty {
                        InfoCard(title: "Summary", text: summary)
                    }
                    if let instructions = course.instructions, !instructions.isEmpty {
                        InfoCard(title: "Instructions", text: instructions)
                    }

                    if !courseChats.isEmpty {
                        Text("Recent chats").font(MolaFont.body(.semibold)).foregroundStyle(MolaColor.text)
                        ForEach(courseChats) { chat in
                            Text(chat.title)
                                .font(MolaFont.body())
                                .foregroundStyle(MolaColor.accent)
                                .padding(.vertical, 2)
                        }
                    }
                }
                .padding(MolaSpacing.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
            } else if isLoading {
                ProgressView()
            } else if let error {
                ContentUnavailableView("Couldn't load course", systemImage: "exclamationmark.triangle", description: Text(error))
            }
        }
        .background(MolaColor.background)
        .task { await load() }
    }

    private func headline(for course: Course) -> String {
        course.number.map { "\($0) — \(course.name)" } ?? course.name
    }

    private func load() async {
        isLoading = true
        do {
            let response: CoursesResponse = try await client.get("api/courses")
            self.course = response.courses.first { $0.id == courseId }
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

private struct InfoCard: View {
    let title: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: MolaSpacing.xs) {
            Text(title).font(.caption).foregroundStyle(MolaColor.muted)
            Text(text).font(MolaFont.body()).foregroundStyle(MolaColor.text)
        }
        .padding(MolaSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .molaCard()
    }
}
