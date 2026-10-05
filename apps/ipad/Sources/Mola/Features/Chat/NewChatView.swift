import SwiftUI

/// The main panel when no chat is open, mirroring the web landing composer's
/// role (`LandingComposer.tsx` / `NewCourseChatComposer.tsx`). Existing chats
/// live in the shell's drawer.
struct NewChatView: View {
    @EnvironmentObject private var client: MolaClient
    @EnvironmentObject private var sidebarModel: SidebarViewModel
    @Binding var selectedChatId: String?
    @State private var isCreating = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: MolaSpacing.md) {
            Text("What can I help you study?")
                .font(MolaFont.title(28))
                .foregroundStyle(MolaColor.text)
            Button {
                Task { await startNewChat() }
            } label: {
                Label("Start a new chat", systemImage: "plus.bubble")
                    .padding(.horizontal, MolaSpacing.md)
                    .padding(.vertical, MolaSpacing.sm)
            }
            .buttonStyle(.borderedProminent)
            .tint(MolaColor.accent)
            .disabled(isCreating)
            if let error {
                Text(error).font(MolaFont.body()).foregroundStyle(MolaColor.danger)
            }
        }
        .padding(MolaSpacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(MolaColor.background)
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
