import SwiftUI

/// The signed-in shell, shaped like Claude's iPad app: one main panel at a
/// time, plus a left drawer — the role `components/chat/Sidebar.tsx` plays on
/// the web — that slides in and pushes the main panel aside. Picking anything
/// in the drawer closes it. The right side is deliberately left free for a
/// future side panel.
enum ShellSection: Hashable {
    case chats
    case artifacts
    case quizzes
    case flashcards
    case mindmaps
    case canvases
    case plan
    case calendar
    case course(String)
}

struct ShellView: View {
    @EnvironmentObject private var client: MolaClient
    @StateObject private var sidebarModel = SidebarViewModel()
    @State private var selection: ShellSection = .chats
    @State private var selectedChatId: String?
    @State private var drawerOpen = false
    @State private var showingSettings = false

    private let drawerWidth: CGFloat = 380

    var body: some View {
        ZStack(alignment: .leading) {
            DrawerView(
                model: sidebarModel,
                selection: selection,
                selectedChatId: selectedChatId,
                onSelect: select,
                onSelectChat: selectChat,
                onSettings: { showingSettings = true }
            )
            .frame(width: drawerWidth)

            mainPanel
                .overlay {
                    if drawerOpen {
                        Color.black.opacity(0.08)
                            .ignoresSafeArea()
                            .onTapGesture { drawerOpen = false }
                    }
                }
                .offset(x: drawerOpen ? drawerWidth : 0)
        }
        .animation(.snappy(duration: 0.25), value: drawerOpen)
        .sheet(isPresented: $showingSettings) { SettingsView() }
        .environmentObject(sidebarModel)
        .task { await sidebarModel.load(client: client) }
        .onChange(of: drawerOpen) { _, open in
            // Re-read the chat list whenever the drawer opens, so a title the
            // server gave a chat after its first turn shows up.
            if open { Task { await sidebarModel.load(client: client) } }
        }
    }

    private var mainPanel: some View {
        NavigationStack {
            mainContent
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { drawerOpen.toggle() } label: { Image(systemName: "line.3.horizontal") }
                            .accessibilityLabel("Menu")
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { selectChat(nil) } label: { Image(systemName: "plus.bubble") }
                            .accessibilityLabel("New chat")
                    }
                }
        }
        // A new section starts from its root rather than whatever was pushed
        // (e.g. a flashcard deck) the last time it was open.
        .id(selection)
        .background(MolaColor.background)
    }

    @ViewBuilder
    private var mainContent: some View {
        switch selection {
        case .chats:
            if let selectedChatId {
                // `.id` forces SwiftUI to tear down and recreate the view (and
                // its `@StateObject`) when the selected chat changes — without
                // it, the existing `ChatViewModel` would be reused with its old
                // `chatId` captured at construction.
                ChatDetailView(chatId: selectedChatId, client: client)
                    .id(selectedChatId)
            } else {
                NewChatView(selectedChatId: $selectedChatId)
            }
        case .artifacts:
            ArtifactsGalleryView(kindFilter: nil)
        case .quizzes:
            ArtifactsGalleryView(kindFilter: .quiz)
        case .flashcards:
            ArtifactsGalleryView(kindFilter: .flashcardDeck)
        case .mindmaps:
            ArtifactsGalleryView(kindFilter: .mindMap)
        case .canvases:
            ArtifactsGalleryView(kindFilter: .canvas)
        case .plan:
            PlanView()
        case .calendar:
            CalendarMonthView()
        case .course(let id):
            CourseDetailView(courseId: id)
        }
    }

    private func select(_ section: ShellSection) {
        selection = section
        drawerOpen = false
    }

    /// `nil` opens the new-chat screen.
    private func selectChat(_ id: String?) {
        selection = .chats
        selectedChatId = id
        drawerOpen = false
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

struct DrawerView: View {
    @ObservedObject var model: SidebarViewModel
    let selection: ShellSection
    let selectedChatId: String?
    let onSelect: (ShellSection) -> Void
    let onSelectChat: (String?) -> Void
    let onSettings: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Mola")
                    .font(MolaFont.title(24))
                    .foregroundStyle(MolaColor.text)
                Spacer()
                Button(action: onSettings) { Image(systemName: "gearshape") }
                    .accessibilityLabel("Settings")
                    .tint(MolaColor.accent)
            }
            .padding(.horizontal, MolaSpacing.md)
            .padding(.vertical, MolaSpacing.sm)

            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    DrawerHeader("Study")
                    row("Artifacts", "square.grid.2x2", .artifacts)
                    row("Quizzes", "checklist", .quizzes)
                    row("Flashcards", "rectangle.on.rectangle", .flashcards)
                    row("Mind maps", "point.3.connected.trianglepath.dotted", .mindmaps)
                    row("Canvases", "scribble.variable", .canvases)

                    DrawerHeader("Schedule")
                    row("Plan", "calendar.day.timeline.left", .plan)
                    row("Calendar", "calendar", .calendar)

                    if !model.courses.isEmpty {
                        DrawerHeader("Courses")
                        ForEach(model.courses) { course in
                            row(course.number ?? course.name, "book", .course(course.id))
                        }
                    }

                    if !model.chats.isEmpty {
                        DrawerHeader("Chats")
                        ForEach(model.chats) { chat in
                            DrawerRow(
                                title: chat.title,
                                systemImage: chat.isPinned ? "pin" : "bubble.left",
                                isSelected: selection == .chats && selectedChatId == chat.id
                            ) { onSelectChat(chat.id) }
                        }
                    }
                }
                .padding(.horizontal, MolaSpacing.sm)
            }

            Button { onSelectChat(nil) } label: {
                Label("New chat", systemImage: "plus")
                    .frame(maxWidth: .infinity)
                    .padding(MolaSpacing.sm)
            }
            .buttonStyle(.borderedProminent)
            .tint(MolaColor.accent)
            .padding(MolaSpacing.md)
        }
        .background(MolaColor.sidebarBackground)
    }

    private func row(_ title: String, _ systemImage: String, _ section: ShellSection) -> some View {
        DrawerRow(title: title, systemImage: systemImage, isSelected: selection == section) {
            onSelect(section)
        }
    }
}

private struct DrawerHeader: View {
    let title: String
    init(_ title: String) { self.title = title }

    var body: some View {
        Text(title)
            .font(MolaFont.body(.medium))
            .foregroundStyle(MolaColor.muted)
            .padding(.horizontal, MolaSpacing.sm)
            .padding(.top, MolaSpacing.md)
            .padding(.bottom, MolaSpacing.xs)
    }
}

private struct DrawerRow: View {
    let title: String
    let systemImage: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(MolaFont.body())
                .foregroundStyle(isSelected ? MolaColor.accent : MolaColor.text)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, MolaSpacing.sm)
                .padding(.vertical, 10)
                .background(
                    isSelected ? MolaColor.border : .clear,
                    in: RoundedRectangle(cornerRadius: MolaRadius.md, style: .continuous)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
