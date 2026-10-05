import SwiftUI

/// The chat transcript + composer. Mirrors `ChatMain.tsx`: turns scroll, a
/// streaming assistant turn renders live text plus collapsed tool-call rows,
/// and an inline artifact block appears the moment the matching SSE
/// `artifact` event lands.
struct ChatDetailView: View {
    @StateObject private var model: ChatViewModel

    /// Takes the already-configured `MolaClient` as a parameter rather than
    /// reading it via `@EnvironmentObject` — `@StateObject`'s initializer
    /// runs before the environment is resolved, so the client has to come
    /// from the caller (`ShellView`, which already holds one) instead.
    init(chatId: String, client: MolaClient) {
        _model = StateObject(wrappedValue: ChatViewModel(chatId: chatId, client: client))
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: MolaSpacing.md) {
                        ForEach(model.messages) { message in
                            MessageBubbleView(message: message)
                                .id(message.id)
                        }
                        ForEach(model.artifacts) { artifact in
                            ArtifactBlockView(artifact: artifact)
                        }
                        if model.isSending {
                            StreamingTurnView(text: model.streamingText, activity: model.activity)
                        }
                    }
                    .padding(MolaSpacing.md)
                }
                .onChange(of: model.messages.count) {
                    if let last = model.messages.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }

            if let error = model.error {
                Text(error)
                    .font(MolaFont.body())
                    .foregroundStyle(MolaColor.danger)
                    .padding(.horizontal, MolaSpacing.md)
            }

            Divider().overlay(MolaColor.border)

            HStack(alignment: .bottom, spacing: MolaSpacing.sm) {
                TextField("Ask about your course…", text: $model.draft, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...6)
                    .onSubmit { Task { await model.send() } }
                Button {
                    Task { await model.send() }
                } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.system(size: 28))
                }
                .tint(MolaColor.accent)
                .disabled(model.isSending || model.draft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(MolaSpacing.md)
        }
        .background(MolaColor.background)
        .navigationTitle(model.course?.name ?? "Chat")
        .task { await model.load() }
    }
}

struct MessageBubbleView: View {
    let message: ChatMessage

    var isUser: Bool { message.role == "user" }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 48) }
            Text(message.content)
                .font(MolaFont.body())
                .foregroundStyle(isUser ? MolaColor.accentForeground : MolaColor.text)
                .padding(MolaSpacing.sm)
                .background(isUser ? MolaColor.accent : MolaColor.panel)
                .clipShape(RoundedRectangle(cornerRadius: MolaRadius.md, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: MolaRadius.md, style: .continuous)
                        .stroke(isUser ? .clear : MolaColor.border, lineWidth: 1)
                )
            if !isUser { Spacer(minLength: 48) }
        }
    }
}

/// The live turn — streamed text plus the collapsed tool/sub-agent activity
/// rows `TurnView.tsx` / `ActivityRow.tsx` render on the web.
struct StreamingTurnView: View {
    let text: String
    let activity: [ActivityEntry]

    var body: some View {
        VStack(alignment: .leading, spacing: MolaSpacing.xs) {
            ForEach(activity) { entry in
                HStack(spacing: MolaSpacing.xs) {
                    Image(systemName: icon(for: entry.kind))
                    Text(entry.label).font(MolaFont.body()).foregroundStyle(MolaColor.muted)
                }
                .font(.caption)
            }
            if !text.isEmpty {
                Text(text)
                    .font(MolaFont.body())
                    .foregroundStyle(MolaColor.text)
                    .padding(MolaSpacing.sm)
                    .background(MolaColor.panel)
                    .clipShape(RoundedRectangle(cornerRadius: MolaRadius.md, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: MolaRadius.md, style: .continuous)
                            .stroke(MolaColor.border, lineWidth: 1)
                    )
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func icon(for kind: ActivityEntry.Kind) -> String {
        switch kind {
        case .tool(let status): return status == "error" ? "xmark.circle" : "wrench.and.screwdriver"
        case .subagent: return "person.2"
        }
    }
}
