import SwiftUI

/// Board + chat side by side, like `CanvasView.tsx`'s page layout. The chat
/// panel can be hidden to give the board the full width — useful once the
/// toolbar and a wide board are both on screen at once.
struct CanvasDetailView: View {
    @StateObject private var model: CanvasViewModel
    @State private var showingChat = true

    /// Takes the already-configured `MolaClient` as a parameter for the same
    /// reason `ChatDetailView` does — `@StateObject`'s initializer runs
    /// before `@EnvironmentObject` is resolved.
    init(
        canvasId: String, title: String, initialElements: [CanvasElement],
        initialViewport: CanvasViewport, initialBackground: CanvasBackground,
        initialVersion: Int, client: MolaClient
    ) {
        _model = StateObject(wrappedValue: CanvasViewModel(
            canvasId: canvasId, title: title, initialElements: initialElements,
            initialViewport: initialViewport, initialBackground: initialBackground,
            initialVersion: initialVersion, client: client
        ))
    }

    var body: some View {
        HStack(spacing: 0) {
            CanvasBoardView(model: model)
            if showingChat {
                Divider().overlay(MolaColor.border)
                CanvasChatPanelView(model: model)
                    .frame(width: 340)
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showingChat.toggle()
                } label: { Image(systemName: "bubble.left") }
                .accessibilityLabel(showingChat ? "Hide chat" : "Show chat")
            }
        }
        .background(MolaColor.background)
    }
}
