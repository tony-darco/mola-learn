import SwiftUI

/// The canvas's own conversation — mirrors `CanvasChatPanel.tsx`'s role, a
/// narrow side panel for asking about the board. Always sends the whole
/// board as context (no marquee "ask about just this region" selection in
/// this client yet — see the iPad README's scope note).
struct CanvasChatPanelView: View {
    @ObservedObject var model: CanvasViewModel

    var body: some View {
        VStack(spacing: 0) {
            Text("Ask about this board")
                .font(MolaFont.body(.semibold))
                .foregroundStyle(MolaColor.text)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(MolaSpacing.sm)

            Divider().overlay(MolaColor.border)

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: MolaSpacing.sm) {
                        ForEach(model.chatMessages) { message in
                            CanvasChatBubble(message: message).id(message.id)
                        }
                        if model.isChatSending {
                            if model.chatStreamingText.isEmpty {
                                ProgressView().controlSize(.small).frame(maxWidth: .infinity, alignment: .leading)
                            } else {
                                CanvasChatBubble(message: CanvasChatMessage(
                                    id: "streaming", role: "assistant", content: model.chatStreamingText,
                                    status: "streaming", errorMessage: nil, canvasContext: nil
                                ))
                            }
                        }
                    }
                    .padding(MolaSpacing.sm)
                }
                .onChange(of: model.chatMessages.count) {
                    if let last = model.chatMessages.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }

            if let error = model.chatError {
                Text(error).font(.caption).foregroundStyle(MolaColor.danger).padding(.horizontal, MolaSpacing.sm)
            }

            Divider().overlay(MolaColor.border)

            HStack(alignment: .bottom, spacing: MolaSpacing.xs) {
                TextField("Ask about the board…", text: $model.chatDraft, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...4)
                    .onSubmit { Task { await model.sendChat() } }
                Button {
                    Task { await model.sendChat() }
                } label: { Image(systemName: "arrow.up.circle.fill").font(.system(size: 24)) }
                .tint(MolaColor.accent)
                .disabled(model.isChatSending || model.chatDraft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(MolaSpacing.sm)
        }
        .background(MolaColor.panel)
        .task { await model.loadChat() }
    }
}

private struct CanvasChatBubble: View {
    let message: CanvasChatMessage
    var isUser: Bool { message.role == "user" }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(isUser ? "You" : "Mola").font(.caption2).foregroundStyle(MolaColor.muted)
            Text(message.content)
                .font(MolaFont.body())
                .foregroundStyle(MolaColor.text)
                .padding(MolaSpacing.xs)
                .background(isUser ? MolaColor.border.opacity(0.4) : MolaColor.background)
                .clipShape(RoundedRectangle(cornerRadius: MolaRadius.sm, style: .continuous))
            if message.status == "error", let errorMessage = message.errorMessage {
                Text(errorMessage).font(.caption).foregroundStyle(MolaColor.danger)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
