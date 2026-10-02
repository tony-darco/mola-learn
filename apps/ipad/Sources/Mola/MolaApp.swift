import SwiftUI

@main
struct MolaApp: App {
    @StateObject private var client = MolaClient()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(client)
                .tint(MolaColor.accent)
                .task {
                    // Picks the session back up on relaunch if a server was
                    // already configured and the session cookie is still
                    // valid — otherwise RootView falls through to sign-in.
                    guard client.baseURL != nil else { return }
                    try? await client.refreshSession()
                }
        }
    }
}
