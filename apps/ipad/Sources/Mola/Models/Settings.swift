import Foundation

/// `lib/auth/api-keys.ts`'s `PublicApiKey` — `GET/POST /api/settings`'s `apiKey` field.
struct PublicApiKey: Decodable {
    let provider: String
    let lastFour: String
}
