import Foundation

enum MolaError: LocalizedError {
    case notConfigured
    case http(Int, String)
    case decoding(Error)
    case notAuthenticated

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Set a server address in Settings before signing in."
        case .http(let code, let body):
            return "Server returned \(code): \(body)"
        case .decoding(let err):
            return "Couldn't read the server's response: \(err.localizedDescription)"
        case .notAuthenticated:
            return "Signed out."
        }
    }
}

/// Talks to the Mola web app's own API (`apps/web/app/api/**`) — there is no
/// separate mobile backend. Identity is the same Auth.js v5 JWT session
/// cookie the web client uses (`lib/auth/next-auth.ts`, credentials
/// provider), not a bearer token, so this relies on `URLSession`'s shared
/// cookie storage rather than an Authorization header.
///
/// Auth.js's Credentials provider has no JSON "log in, get a token" endpoint
/// — signing in means POSTing the same form the web `/sign-in` page submits
/// to `/api/auth/callback/credentials`, carrying a CSRF token minted by
/// `/api/auth/csrf`. The 302 redirect that follows isn't meaningful here (it
/// points at `/sign-in` or `/chat`, web routes); success is instead confirmed
/// by immediately reading `/api/auth/session` back.
@MainActor
final class MolaClient: ObservableObject {
    @Published private(set) var currentUser: AuthUser?
    @Published var baseURL: URL? {
        didSet { UserDefaults.standard.set(baseURL?.absoluteString, forKey: Self.baseURLKey) }
    }

    private static let baseURLKey = "mola.baseURL"
    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = .shared
        config.httpShouldSetCookies = true
        self.session = URLSession(configuration: config)
        if let stored = UserDefaults.standard.string(forKey: Self.baseURLKey) {
            self.baseURL = URL(string: stored)
        }
    }

    // MARK: - Auth

    func signIn(email: String, password: String) async throws {
        let base = try requireBaseURL()

        // 1. Mint a CSRF token (and its cookie — URLSession's shared cookie
        //    storage attaches it to the next request automatically).
        let csrfURL = base.appending(path: "api/auth/csrf")
        let (csrfData, csrfResponse) = try await session.data(from: csrfURL)
        try Self.checkOK(csrfResponse, csrfData)
        guard
            let csrfObj = try JSONSerialization.jsonObject(with: csrfData) as? [String: Any],
            let csrfToken = csrfObj["csrfToken"] as? String
        else { throw MolaError.decoding(NSError(domain: "Mola", code: 0)) }

        // 2. Submit the credentials callback the same way the web sign-in
        //    form does — on success Auth.js sets the session cookie via
        //    Set-Cookie, which URLSession's cookie storage picks up from the
        //    response headers even though we don't need the body.
        var request = URLRequest(url: base.appending(path: "api/auth/callback/credentials"))
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let form = [
            "csrfToken": csrfToken, "email": email, "password": password, "json": "true",
        ]
        request.httpBody = Self.formEncode(form).data(using: .utf8)
        _ = try await session.data(for: request)

        // 3. Confirm. A failed sign-in sets no session cookie, so this comes
        //    back with `user: null`.
        try await refreshSession()
        guard currentUser != nil else {
            throw MolaError.http(401, "Invalid email or password")
        }
    }

    func signUp(name: String, email: String, password: String) async throws {
        let base = try requireBaseURL()
        var request = URLRequest(url: base.appending(path: "api/auth/sign-up"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "name": name, "email": email, "password": password,
        ])
        let (data, response) = try await session.data(for: request)
        try Self.checkOK(response, data)
        try await signIn(email: email, password: password)
    }

    func refreshSession() async throws {
        let base = try requireBaseURL()
        let (data, response) = try await session.data(from: base.appending(path: "api/auth/session"))
        try Self.checkOK(response, data)
        // An empty body (`{}`) means "no session" — Auth.js's session route
        // returns that rather than 401 for a logged-out request.
        if let decoded = try? JSONDecoder.mola.decode(AuthSessionResponse.self, from: data) {
            currentUser = decoded.user
        } else {
            currentUser = nil
        }
    }

    func signOut() {
        currentUser = nil
        if let base = baseURL, let cookies = HTTPCookieStorage.shared.cookies(for: base) {
            cookies.forEach { HTTPCookieStorage.shared.deleteCookie($0) }
        }
    }

    // MARK: - Generic JSON requests

    func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        let url = try endpoint(path, query: query)
        let (data, response) = try await session.data(from: url)
        try Self.checkOK(response, data)
        do {
            return try JSONDecoder.mola.decode(T.self, from: data)
        } catch {
            throw MolaError.decoding(error)
        }
    }

    @discardableResult
    func send<T: Decodable>(
        _ path: String, method: String, body: [String: Any]? = nil
    ) async throws -> T {
        let url = try endpoint(path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await session.data(for: request)
        try Self.checkOK(response, data)
        do {
            return try JSONDecoder.mola.decode(T.self, from: data)
        } catch {
            throw MolaError.decoding(error)
        }
    }

    /// For calls whose response the caller doesn't need to decode (e.g. DELETE).
    func sendVoid(_ path: String, method: String, body: [String: Any]? = nil) async throws {
        let url = try endpoint(path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await session.data(for: request)
        try Self.checkOK(response, data)
    }

    // MARK: - SSE
    //
    // The main chat stream (contract 6, `packages/shared/src/stream.ts`) and
    // the canvas chat stream (`lib/canvas/chat.ts`) use the same wire framing
    // — `data: <json>\n\n`, one object per event — but different event
    // vocabularies, so `rawSSE` does the HTTP + framing once and each typed
    // wrapper below only supplies its own decoder.

    /// Opens an HTTP request and yields each SSE frame's raw JSON payload.
    private func rawSSE(_ request: URLRequest) -> AsyncThrowingStream<Data, Error> {
        AsyncThrowingStream { continuation in
            Task {
                do {
                    let (bytes, response) = try await self.session.bytes(for: request)
                    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                        throw MolaError.http(http.statusCode, "")
                    }
                    for try await event in SSEParser.events(from: bytes) {
                        continuation.yield(event)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }

    private func jsonRequest(_ path: String, method: String, body: [String: Any]?) throws -> URLRequest {
        var request = URLRequest(url: try endpoint(path))
        request.httpMethod = method
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        return request
    }

    /// Opens a POST and yields `StreamEvent`s as they arrive — used for
    /// `POST /api/chat/:chatId` (see `encodeSSE`/`StreamEvent` in
    /// `packages/shared/src/stream.ts`).
    func streamPost(_ path: String, body: [String: Any]) -> AsyncThrowingStream<StreamEvent, Error> {
        guard let request = try? jsonRequest(path, method: "POST", body: body) else {
            return AsyncThrowingStream { $0.finish(throwing: MolaError.notConfigured) }
        }
        return mapStream(rawSSE(request), StreamEvent.decode(from:))
    }

    /// `GET /api/chat/:chatId/messages/:messageId/stream` — reconnects to an
    /// in-progress turn after e.g. the app was backgrounded mid-stream.
    func streamGet(_ path: String) -> AsyncThrowingStream<StreamEvent, Error> {
        guard let request = try? jsonRequest(path, method: "GET", body: nil) else {
            return AsyncThrowingStream { $0.finish(throwing: MolaError.notConfigured) }
        }
        return mapStream(rawSSE(request), StreamEvent.decode(from:))
    }

    /// `POST /api/canvas/:canvasId/chat` — a canvas's own conversation.
    /// `lib/canvas/chat.ts`'s event set, not the main chat's.
    func canvasChatStream(_ path: String, body: [String: Any]) -> AsyncThrowingStream<CanvasChatStreamEvent, Error> {
        guard let request = try? jsonRequest(path, method: "POST", body: body) else {
            return AsyncThrowingStream { $0.finish(throwing: MolaError.notConfigured) }
        }
        return mapStream(rawSSE(request), CanvasChatStreamEvent.decode(from:))
    }

    private func mapStream<T>(
        _ source: AsyncThrowingStream<Data, Error>, _ decode: @escaping (Data) -> T
    ) -> AsyncThrowingStream<T, Error> {
        AsyncThrowingStream { continuation in
            Task {
                do {
                    for try await data in source {
                        continuation.yield(decode(data))
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }

    // MARK: - Helpers

    private func requireBaseURL() throws -> URL {
        guard let baseURL else { throw MolaError.notConfigured }
        return baseURL
    }

    private func endpoint(_ path: String, query: [String: String] = [:]) throws -> URL {
        let base = try requireBaseURL()
        var components = URLComponents(
            url: base.appending(path: path.hasPrefix("/") ? String(path.dropFirst()) : path),
            resolvingAgainstBaseURL: false
        )
        if !query.isEmpty {
            components?.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components?.url else { throw MolaError.notConfigured }
        return url
    }

    private static func checkOK(_ response: URLResponse, _ data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw MolaError.http(http.statusCode, body)
        }
    }

    private static func formEncode(_ fields: [String: String]) -> String {
        fields.map { key, value in
            let allowed = CharacterSet.urlQueryAllowed.subtracting(.init(charactersIn: "+&="))
            let k = key.addingPercentEncoding(withAllowedCharacters: allowed) ?? key
            let v = value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
            return "\(k)=\(v)"
        }.joined(separator: "&")
    }
}
