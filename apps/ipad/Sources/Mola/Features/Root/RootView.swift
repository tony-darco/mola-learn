import SwiftUI

/// Top-level switch: no server configured → Settings' onboarding card; no
/// session → sign-in/sign-up; otherwise the real three-pane shell, mirroring
/// `app/(shell)/layout.tsx`'s role (the chrome every signed-in page sits in).
struct RootView: View {
    @EnvironmentObject private var client: MolaClient

    var body: some View {
        Group {
            if client.baseURL == nil {
                ServerSetupView()
            } else if client.currentUser == nil {
                AuthFlowView()
            } else {
                ShellView()
            }
        }
        .background(MolaColor.background)
    }
}

/// First-run: point the app at a running Mola server. Mirrors the README's
/// "Getting started" — this app is a client of the same Next.js app, not a
/// standalone backend.
struct ServerSetupView: View {
    @EnvironmentObject private var client: MolaClient
    @State private var urlText = "http://localhost:3000"
    @State private var error: String?

    var body: some View {
        VStack(spacing: MolaSpacing.lg) {
            Text("Mola")
                .font(MolaFont.title(40, weight: .bold))
                .foregroundStyle(MolaColor.text)

            Text("Enter the address of your Mola server.")
                .font(MolaFont.body())
                .foregroundStyle(MolaColor.muted)

            TextField("http://localhost:3000", text: $urlText)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .frame(maxWidth: 420)

            if let error {
                Text(error).font(MolaFont.body()).foregroundStyle(MolaColor.danger)
            }

            Button("Continue") {
                guard let url = URL(string: urlText), url.scheme != nil else {
                    error = "Enter a full URL, including http:// or https://."
                    return
                }
                client.baseURL = url
            }
            .buttonStyle(.borderedProminent)
            .tint(MolaColor.accent)
        }
        .padding(MolaSpacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
