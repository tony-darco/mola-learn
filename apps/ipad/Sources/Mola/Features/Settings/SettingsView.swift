import SwiftUI

/// A trimmed `SettingsModal.tsx`: server address, account, sign out. BYOK key
/// management (`/api/settings` POST/DELETE) is wired since it's a plain REST
/// endpoint; Google Calendar connect is left out because it is an OAuth
/// redirect flow designed for a browser tab, not something to reimplement
/// inside a sheet without a real device to test the redirect against.
struct SettingsView: View {
    @EnvironmentObject private var client: MolaClient
    @Environment(\.dismiss) private var dismiss
    @State private var apiKey: PublicApiKey?
    @State private var newKey = ""
    @State private var provider: String = "anthropic"
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Account") {
                    if let user = client.currentUser {
                        LabeledContent("Email", value: user.email)
                    }
                    if let baseURL = client.baseURL {
                        LabeledContent("Server", value: baseURL.absoluteString)
                    }
                    Button("Sign out", role: .destructive) {
                        client.signOut()
                        dismiss()
                    }
                }

                Section("Model") {
                    if let apiKey {
                        LabeledContent("Using your own key", value: "\(apiKey.provider) ••••\(apiKey.lastFour)")
                        Button("Remove key", role: .destructive) { Task { await removeKey() } }
                    } else {
                        Text("Using the shared Ollama host unless you add your own key.")
                            .font(.caption)
                            .foregroundStyle(MolaColor.muted)
                        Picker("Provider", selection: $provider) {
                            Text("Anthropic").tag("anthropic")
                            Text("OpenAI").tag("openai")
                        }
                        SecureField("API key", text: $newKey)
                        Button("Save key") { Task { await saveKey() } }
                            .disabled(newKey.isEmpty)
                    }
                }

                if let error {
                    Text(error).foregroundStyle(MolaColor.danger)
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await load() }
        }
    }

    private func load() async {
        do {
            struct Response: Decodable { let apiKey: PublicApiKey? }
            let response: Response = try await client.get("api/settings")
            self.apiKey = response.apiKey
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func saveKey() async {
        do {
            struct Response: Decodable { let apiKey: PublicApiKey? }
            let response: Response = try await client.send(
                "api/settings", method: "POST", body: ["provider": provider, "key": newKey]
            )
            self.apiKey = response.apiKey
            newKey = ""
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func removeKey() async {
        do {
            try await client.sendVoid("api/settings", method: "DELETE")
            apiKey = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
