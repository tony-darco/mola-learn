import Foundation

/// Parses the server's SSE wire format — `encodeSSE` in
/// `packages/shared/src/stream.ts` writes exactly `data: <json>\n\n`, one
/// JSON object per event, no multi-line data fields and no `event:` lines —
/// so this only needs to split on blank lines and strip the `data: ` prefix,
/// not a general SSE/EventSource implementation.
enum SSEParser {
    static func events(from bytes: URLSession.AsyncBytes) -> AsyncThrowingStream<Data, Error> {
        AsyncThrowingStream { continuation in
            Task {
                do {
                    for try await line in bytes.lines {
                        guard line.hasPrefix("data: ") else { continue }
                        let payload = String(line.dropFirst("data: ".count))
                        if let data = payload.data(using: .utf8) {
                            continuation.yield(data)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }
}
