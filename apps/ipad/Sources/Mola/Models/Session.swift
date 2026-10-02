import Foundation

/// Mirrors `lib/auth/session.ts`'s `Session` shape. The native client never
/// sees a token — identity comes from the Auth.js session cookie (see
/// `MolaClient`), this is just what `/api/auth/session` reports back.
struct AuthUser: Decodable {
    let id: String
    let email: String
    let name: String?
}

struct AuthSessionResponse: Decodable {
    let user: AuthUser?
}
