import SwiftUI

/// The middle column when "Chats" is selected: a "new chat" composer plus the
/// existing list, mirroring the web landing composer's role
/// (`LandingComposer.tsx` / `NewCourseChatComposer.tsx`) collapsed into one
/// iPad pane rather than a separate marketing route.
struct ChatListView: View {
    @EnvironmentObject private var client: MolaClient
    @EnvironmentObject private var sidebarModel: SidebarViewModel
    let chats: [ChatSummary]
    @Binding var selectedChatId: String?
    @State private var isCreating = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: MolaSpacing.sm) {
                Text("What can I help you study?")
                    .font(MolaFont.title(22))
                    .foregroundStyle(MolaColor.text)
                Button {
                    Task { await startNewChat() }
                } label: {
                    Label("Start a new chat", systemImage: "plus.bubble")
                        .frame(maxWidth: .infinity)
                        .padding(MolaSpacing.sm)
                }
                .buttonStyle(.borderedProminent)
                .tint(MolaColor.accent)
                .disabled(isCreating)
                if let error {
                    Text(error).font(MolaFont.body()).foregroundStyle(MolaColor.danger)
                }
            }
            .padding(MolaSpacing.md)

            Divider().overlay(MolaColor.border)

            if chats.isEmpty {
                ContentUnavailableView(
                    "No chats yet", systemImage: "bubble.left",
                    description: Text("Start one above to begin tutoring.")
                )
            } else {
                List(chats, selection: $selectedChatId) { chat in
                    Text(chat.title).tag(chat.id as String?)
                }
                .listStyle(.plain)
            }
        }
        .background(MolaColor.background)
        .navigationTitle("Chats")
    }

    private func startNewChat() async {
        isCreating = true
        error = nil
        defer { isCreating = false }
        do {
            struct NewChat: Decodable { let id: String }
            let created: NewChat = try await client.send("api/chat", method: "POST", body: [:])
            await sidebarModel.load(client: client)
            selectedChatId = created.id
        } catch {
            self.error = error.localizedDescription
        }
    }
}
