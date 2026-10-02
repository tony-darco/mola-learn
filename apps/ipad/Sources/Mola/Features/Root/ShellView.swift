import SwiftUI

/// The signed-in three-column shell. `NavigationSplitView` is the iPadOS-
/// native shape for exactly what `components/chat/Sidebar.tsx` is on the
/// web: a persistent left rail (chats/courses/sections) that stays mounted
/// while the content next to it changes.
enum ShellSection: Hashable {
    case chats
    case artifacts
    case quizzes
    case flashcards
    case mindmaps
    case plan
    case calendar
    case course(String)
}

struct ShellView: View {
    @EnvironmentObject private var client: MolaClient
    @StateObject private var sidebarModel = SidebarViewModel()
    @State private var selection: ShellSection? = .chats
    @State private var selectedChatId: String?
    @State private var showingSettings = false

    var body: some View {
        NavigationSplitView {
            SidebarListView(model: sidebarModel, selection: $selection, selectedChatId: $selectedChatId)
                .navigationTitle("Mola")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showingSettings = true } label: { Image(systemName: "gearshape") }
                    }
                }
        } content: {
            middleColumn
        } detail: {
            detailColumn
        }
        .sheet(isPresented: $showingSettings) { SettingsView() }
        .environmentObject(sidebarModel)
        .task { await sidebarModel.load(client: client) }
    }

    @ViewBuilder
    private var middleColumn: some View {
        switch selection {
        case .chats, .none:
            ChatListView(chats: sidebarModel.chats, selectedChatId: $selectedChatId)
        case .artifacts:
            ArtifactsGalleryView(kindFilter: nil)
        case .quizzes:
            ArtifactsGalleryView(kindFilter: .quiz)
        case .flashcards:
            ArtifactsGalleryView(kindFilter: .flashcardDeck)
        case .mindmaps:
            ArtifactsGalleryView(kindFilter: .mindMap)
        case .plan:
            PlanView()
        case .calendar:
            CalendarMonthView()
        case .course(let id):
            CourseDetailView(courseId: id)
        }
    }

    @ViewBuilder
    private var detailColumn: some View {
        if selection == .chats || selection == nil, let selectedChatId {
            // `.id` forces SwiftUI to tear down and recreate the view (and
            // its `@StateObject`) when the selected chat changes — without
            // it, the existing `ChatViewModel` would be reused with its old
            // `chatId` captured at construction.
            ChatDetailView(chatId: selectedChatId, client: client)
                .id(selectedChatId)
        } else {
            ContentUnavailableView(
                "Select something to view",
                systemImage: "sidebar.left",
                description: Text("Pick a chat, deck, quiz or plan from the list.")
            )
        }
    }
}

@MainActor
final class SidebarViewModel: ObservableObject {
    @Published var chats: [ChatSummary] = []
    @Published var courses: [CourseOption] = []
    @Published var error: String?

    func load(client: MolaClient) async {
        do {
            let response: ChatListResponse = try await client.get("api/chat")
            self.chats = response.chats
            self.courses = response.courses
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct SidebarListView: View {
    @ObservedObject var model: SidebarViewModel
    @Binding var selection: ShellSection?
    @Binding var selectedChatId: String?

    var body: some View {
        List(selection: $selection) {
            Section {
                NavLabel("New chat", systemImage: "plus.bubble")
                    .tag(ShellSection.chats as ShellSection?)
            }
            Section("Study") {
                NavLabel("Artifacts", systemImage: "square.grid.2x2").tag(ShellSection.artifacts as ShellSection?)
                NavLabel("Quizzes", systemImage: "checklist").tag(ShellSection.quizzes as ShellSection?)
                NavLabel("Flashcards", systemImage: "rectangle.on.rectangle").tag(ShellSection.flashcards as ShellSection?)
                NavLabel("Mind maps", systemImage: "point.3.connected.trianglepath.dotted").tag(ShellSection.mindmaps as ShellSection?)
            }
            Section("Schedule") {
                NavLabel("Plan", systemImage: "calendar.day.timeline.left").tag(ShellSection.plan as ShellSection?)
                NavLabel("Calendar", systemImage: "calendar").tag(ShellSection.calendar as ShellSection?)
            }
            if !model.courses.isEmpty {
                Section("Courses") {
                    ForEach(model.courses) { course in
                        NavLabel(course.number ?? course.name, systemImage: "book")
                            .tag(ShellSection.course(course.id) as ShellSection?)
                    }
                }
            }
            if !model.chats.isEmpty {
                Section("Chats") {
                    ForEach(model.chats) { chat in
                        Button {
                            selection = .chats
                            selectedChatId = chat.id
                        } label: {
                            Label(chat.title, systemImage: chat.isPinned ? "pin.fill" : "bubble.left")
                        }
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .scrollContentBackground(.hidden)
        .background(MolaColor.sidebarBackground)
    }
}

private struct NavLabel: View {
    let title: String
    let systemImage: String
    init(_ title: String, systemImage: String) {
        self.title = title
        self.systemImage = systemImage
    }
    var body: some View { Label(title, systemImage: systemImage) }
}
