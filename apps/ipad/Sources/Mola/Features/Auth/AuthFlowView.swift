import SwiftUI

/// Sign-in / sign-up, mirroring `app/(auth)/sign-in/page.tsx`'s copy
/// ("Welcome back to Mola") and fields. The web sign-up page runs a longer
/// multi-step wizard (`SignUpWizard.tsx`: university, grad date, phone); this
/// keeps to the two fields `/api/auth/sign-up` actually requires and leaves
/// the rest as a `Course` creation step once signed in, same as a web user
/// who skips the optional wizard fields.
struct AuthFlowView: View {
    @EnvironmentObject private var client: MolaClient
    @State private var mode: Mode = .signIn
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var isWorking = false
    @State private var error: String?

    enum Mode { case signIn, signUp }

    var body: some View {
        VStack(spacing: MolaSpacing.lg) {
            Text("Mola").font(MolaFont.title(40)).foregroundStyle(MolaColor.text)
            Text(mode == .signIn ? "Welcome back to Mola." : "Create your account.")
                .font(MolaFont.body())
                .foregroundStyle(MolaColor.muted)

            VStack(spacing: MolaSpacing.sm) {
                if mode == .signUp {
                    TextField("Name", text: $name)
                        .textContentType(.name)
                }
                TextField("Email", text: $email)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Password", text: $password)
                    .textContentType(mode == .signIn ? .password : .newPassword)
            }
            .textFieldStyle(.roundedBorder)
            .frame(maxWidth: 360)

            if let error {
                Text(error).font(MolaFont.body()).foregroundStyle(MolaColor.danger)
                    .frame(maxWidth: 360)
            }

            Button(mode == .signIn ? "Sign in" : "Sign up") { Task { await submit() } }
                .buttonStyle(.borderedProminent)
                .tint(MolaColor.accent)
                .disabled(isWorking || email.isEmpty || password.isEmpty)

            Button(mode == .signIn ? "No account? Sign up" : "Have an account? Sign in") {
                mode = mode == .signIn ? .signUp : .signIn
                error = nil
            }
            .font(MolaFont.body())
            .foregroundStyle(MolaColor.accent)
        }
        .padding(MolaSpacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay { if isWorking { ProgressView() } }
    }

    private func submit() async {
        isWorking = true
        error = nil
        defer { isWorking = false }
        do {
            switch mode {
            case .signIn:
                try await client.signIn(email: email, password: password)
            case .signUp:
                try await client.signUp(name: name, email: email, password: password)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
