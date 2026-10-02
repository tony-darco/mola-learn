import Foundation

/// Ported from the `canvas*` schemas added to `packages/shared/src/artifacts.ts`
/// (the `feat/canvas` branch). A canvas is an `artifacts` row like any other
/// — `kind: "canvas"`, `payload: { elements, viewport, background }` — so it
/// already flows through `ArtifactRecord` / `GET /api/artifacts`; only the
/// payload shape is new.

struct CanvasPoint: Codable, Hashable {
    let x: Double
    let y: Double
    let pressure: Double?
}

struct CanvasViewport: Codable, Hashable {
    var x: Double
    var y: Double
    var zoom: Double
}

struct CanvasBackground: Codable, Hashable {
    var pattern: String // dots | grid | lines | blank
    var color: String
}

/// The eight `canvasElementBaseSchema.extend({...})` variants, modeled as one
/// struct (the fields every element shares) plus an enum for the part that
/// actually varies — mirrors how `ArtifactPayload` handles the artifact-kind
/// union, just one level deeper.
enum CanvasElementProps: Hashable {
    case draw(points: [CanvasPoint], color: String, strokeWidth: Double, variant: String, dash: String)
    case text(text: String, color: String, fontSize: Double, backgroundColor: String?, bold: Bool, italic: Bool, textAlign: String, autoFit: String)
    case frame(name: String)
    case line(endX: Double, endY: Double, color: String, strokeWidth: Double, dash: String, startArrow: Bool, endArrow: Bool)
    case shape(shapeKind: String, color: String, fillColor: String?, fillStyle: String, strokeWidth: Double, dash: String)
    case note(text: String, color: String, textColor: String, fontSize: Double, bold: Bool, italic: Bool, textAlign: String, autoFit: String)
    case math(latex: String, color: String, fontSize: Double)
    case image(url: String, naturalWidth: Double, naturalHeight: Double)

    /// The `type` discriminator string this case round-trips as.
    var typeName: String {
        switch self {
        case .draw: return "draw"
        case .text: return "text"
        case .frame: return "frame"
        case .line: return "line"
        case .shape: return "shape"
        case .note: return "note"
        case .math: return "math"
        case .image: return "image"
        }
    }
}

struct CanvasElement: Identifiable, Hashable {
    var id: String
    var parentId: String?
    var index: String
    var x: Double
    var y: Double
    var width: Double
    var height: Double
    var rotation: Double
    var opacity: Double
    var createdBy: String // "user" | "ai"
    var props: CanvasElementProps
}

extension CanvasElement: Codable {
    private enum CodingKeys: String, CodingKey {
        case id, parentId, index, x, y, width, height, rotation, opacity, createdBy, type, props
    }
    private enum PropsKeys: String, CodingKey {
        case points, color, strokeWidth, variant, dash
        case text, fontSize, backgroundColor, bold, italic, textAlign, autoFit
        case name
        case endX, endY, startArrow, endArrow
        case shapeKind, fillColor, fillStyle
        case textColor
        case latex
        case url, naturalWidth, naturalHeight
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        parentId = try c.decodeIfPresent(String.self, forKey: .parentId)
        index = try c.decode(String.self, forKey: .index)
        x = try c.decode(Double.self, forKey: .x)
        y = try c.decode(Double.self, forKey: .y)
        width = try c.decode(Double.self, forKey: .width)
        height = try c.decode(Double.self, forKey: .height)
        rotation = try c.decodeIfPresent(Double.self, forKey: .rotation) ?? 0
        opacity = try c.decodeIfPresent(Double.self, forKey: .opacity) ?? 1
        createdBy = try c.decodeIfPresent(String.self, forKey: .createdBy) ?? "user"

        let type = try c.decode(String.self, forKey: .type)
        let p = try c.nestedContainer(keyedBy: PropsKeys.self, forKey: .props)
        switch type {
        case "draw":
            props = .draw(
                points: try p.decode([CanvasPoint].self, forKey: .points),
                color: try p.decode(String.self, forKey: .color),
                strokeWidth: try p.decode(Double.self, forKey: .strokeWidth),
                variant: try p.decodeIfPresent(String.self, forKey: .variant) ?? "pen",
                dash: try p.decodeIfPresent(String.self, forKey: .dash) ?? "solid"
            )
        case "text":
            props = .text(
                text: try p.decode(String.self, forKey: .text),
                color: try p.decode(String.self, forKey: .color),
                fontSize: try p.decode(Double.self, forKey: .fontSize),
                backgroundColor: try p.decodeIfPresent(String.self, forKey: .backgroundColor),
                bold: try p.decodeIfPresent(Bool.self, forKey: .bold) ?? false,
                italic: try p.decodeIfPresent(Bool.self, forKey: .italic) ?? false,
                textAlign: try p.decodeIfPresent(String.self, forKey: .textAlign) ?? "left",
                autoFit: try p.decodeIfPresent(String.self, forKey: .autoFit) ?? "grow"
            )
        case "frame":
            props = .frame(name: try p.decode(String.self, forKey: .name))
        case "line":
            props = .line(
                endX: try p.decode(Double.self, forKey: .endX),
                endY: try p.decode(Double.self, forKey: .endY),
                color: try p.decode(String.self, forKey: .color),
                strokeWidth: try p.decode(Double.self, forKey: .strokeWidth),
                dash: try p.decodeIfPresent(String.self, forKey: .dash) ?? "solid",
                startArrow: try p.decodeIfPresent(Bool.self, forKey: .startArrow) ?? false,
                endArrow: try p.decodeIfPresent(Bool.self, forKey: .endArrow) ?? false
            )
        case "shape":
            props = .shape(
                shapeKind: try p.decode(String.self, forKey: .shapeKind),
                color: try p.decode(String.self, forKey: .color),
                fillColor: try p.decodeIfPresent(String.self, forKey: .fillColor),
                fillStyle: try p.decodeIfPresent(String.self, forKey: .fillStyle) ?? "none",
                strokeWidth: try p.decode(Double.self, forKey: .strokeWidth),
                dash: try p.decodeIfPresent(String.self, forKey: .dash) ?? "solid"
            )
        case "note":
            props = .note(
                text: try p.decode(String.self, forKey: .text),
                color: try p.decode(String.self, forKey: .color),
                textColor: try p.decodeIfPresent(String.self, forKey: .textColor) ?? "#1c1b18",
                fontSize: try p.decode(Double.self, forKey: .fontSize),
                bold: try p.decodeIfPresent(Bool.self, forKey: .bold) ?? false,
                italic: try p.decodeIfPresent(Bool.self, forKey: .italic) ?? false,
                textAlign: try p.decodeIfPresent(String.self, forKey: .textAlign) ?? "left",
                autoFit: try p.decodeIfPresent(String.self, forKey: .autoFit) ?? "grow"
            )
        case "math":
            props = .math(
                latex: try p.decode(String.self, forKey: .latex),
                color: try p.decode(String.self, forKey: .color),
                fontSize: try p.decode(Double.self, forKey: .fontSize)
            )
        case "image":
            props = .image(
                url: try p.decode(String.self, forKey: .url),
                naturalWidth: try p.decode(Double.self, forKey: .naturalWidth),
                naturalHeight: try p.decode(Double.self, forKey: .naturalHeight)
            )
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: c, debugDescription: "unknown canvas element type: \(type)"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encodeIfPresent(parentId, forKey: .parentId)
        try c.encode(index, forKey: .index)
        try c.encode(x, forKey: .x)
        try c.encode(y, forKey: .y)
        try c.encode(width, forKey: .width)
        try c.encode(height, forKey: .height)
        try c.encode(rotation, forKey: .rotation)
        try c.encode(opacity, forKey: .opacity)
        try c.encode(createdBy, forKey: .createdBy)
        try c.encode(props.typeName, forKey: .type)

        var p = c.nestedContainer(keyedBy: PropsKeys.self, forKey: .props)
        switch props {
        case .draw(let points, let color, let strokeWidth, let variant, let dash):
            try p.encode(points, forKey: .points)
            try p.encode(color, forKey: .color)
            try p.encode(strokeWidth, forKey: .strokeWidth)
            try p.encode(variant, forKey: .variant)
            try p.encode(dash, forKey: .dash)
        case .text(let text, let color, let fontSize, let backgroundColor, let bold, let italic, let textAlign, let autoFit):
            try p.encode(text, forKey: .text)
            try p.encode(color, forKey: .color)
            try p.encode(fontSize, forKey: .fontSize)
            try p.encodeIfPresent(backgroundColor, forKey: .backgroundColor)
            try p.encode(bold, forKey: .bold)
            try p.encode(italic, forKey: .italic)
            try p.encode(textAlign, forKey: .textAlign)
            try p.encode(autoFit, forKey: .autoFit)
        case .frame(let name):
            try p.encode(name, forKey: .name)
        case .line(let endX, let endY, let color, let strokeWidth, let dash, let startArrow, let endArrow):
            try p.encode(endX, forKey: .endX)
            try p.encode(endY, forKey: .endY)
            try p.encode(color, forKey: .color)
            try p.encode(strokeWidth, forKey: .strokeWidth)
            try p.encode(dash, forKey: .dash)
            try p.encode(startArrow, forKey: .startArrow)
            try p.encode(endArrow, forKey: .endArrow)
        case .shape(let shapeKind, let color, let fillColor, let fillStyle, let strokeWidth, let dash):
            try p.encode(shapeKind, forKey: .shapeKind)
            try p.encode(color, forKey: .color)
            try p.encodeIfPresent(fillColor, forKey: .fillColor)
            try p.encode(fillStyle, forKey: .fillStyle)
            try p.encode(strokeWidth, forKey: .strokeWidth)
            try p.encode(dash, forKey: .dash)
        case .note(let text, let color, let textColor, let fontSize, let bold, let italic, let textAlign, let autoFit):
            try p.encode(text, forKey: .text)
            try p.encode(color, forKey: .color)
            try p.encode(textColor, forKey: .textColor)
            try p.encode(fontSize, forKey: .fontSize)
            try p.encode(bold, forKey: .bold)
            try p.encode(italic, forKey: .italic)
            try p.encode(textAlign, forKey: .textAlign)
            try p.encode(autoFit, forKey: .autoFit)
        case .math(let latex, let color, let fontSize):
            try p.encode(latex, forKey: .latex)
            try p.encode(color, forKey: .color)
            try p.encode(fontSize, forKey: .fontSize)
        case .image(let url, let naturalWidth, let naturalHeight):
            try p.encode(url, forKey: .url)
            try p.encode(naturalWidth, forKey: .naturalWidth)
            try p.encode(naturalHeight, forKey: .naturalHeight)
        }
    }
}

// MARK: - Canvas chat (`lib/canvas/chat.ts`)
//
// A canvas's own conversation: no tools, no artifacts, no hint ladder — just
// a question about the board and a streamed answer. Same SSE framing as the
// main chat (`data: <json>\n\n`, decoded by the shared `SSEParser`), but its
// own small event set, mirrored here rather than folded into `StreamEvent`.

/** A rectangle in canvas (world) coordinates — `lib/canvas/marquee.ts`'s `Rect`. Unused by this
 client in v1 (no selection UI yet), kept so `CanvasContext.region` round-trips on reload. */
struct CanvasRect: Codable, Hashable {
    let minX: Double
    let minY: Double
    let maxX: Double
    let maxY: Double
}

/// What the model was shown with one message — stored on the user's message
/// so a reload can show "what Mola saw" without re-reading the board.
struct CanvasChatContext: Codable, Hashable {
    let text: String
    let region: CanvasRect?
}

struct CanvasChatMessage: Codable, Identifiable, Hashable {
    let id: String
    let role: String // "user" | "assistant"
    let content: String
    let status: String // streaming | done | error
    let errorMessage: String?
    let canvasContext: CanvasChatContext?
}

struct CanvasChatHistoryResponse: Decodable {
    let chatId: String?
    let messages: [CanvasChatMessage]
}

enum CanvasChatStreamEvent {
    case context(userMessageId: String, messageId: String, text: String, region: CanvasRect?)
    case textDelta(text: String)
    case messageEnd(messageId: String)
    case error(message: String)
    case unknown
}

extension CanvasChatStreamEvent {
    static func decode(from data: Data) -> CanvasChatStreamEvent {
        guard
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = obj["type"] as? String
        else { return .unknown }

        switch type {
        case "canvas_context":
            var region: CanvasRect?
            if let r = obj["region"] as? [String: Any],
               let minX = r["minX"] as? Double, let minY = r["minY"] as? Double,
               let maxX = r["maxX"] as? Double, let maxY = r["maxY"] as? Double {
                region = CanvasRect(minX: minX, minY: minY, maxX: maxX, maxY: maxY)
            }
            return .context(
                userMessageId: obj["userMessageId"] as? String ?? "",
                messageId: obj["messageId"] as? String ?? "",
                text: obj["text"] as? String ?? "",
                region: region
            )
        case "text_delta":
            return .textDelta(text: obj["text"] as? String ?? "")
        case "message_end":
            return .messageEnd(messageId: obj["messageId"] as? String ?? "")
        case "error":
            return .error(message: obj["message"] as? String ?? "unknown error")
        default:
            return .unknown
        }
    }
}

// MARK: - Ordering

/// A simple append-only substitute for the web's `fractional-indexing`
/// package (`lib/canvas/order.ts`'s `nextIndexAfterAll`). The schema only
/// requires `index` to be a non-empty string (`z.string().min(1)`) — nothing
/// server-side parses its format — so this doesn't need to reproduce that
/// library's exact base-62 encoding, only its contract: each new key sorts
/// (via plain `<`) after every key that came before it. Extending the
/// current maximum by one more character always satisfies that, since a
/// string is never less than one of its own prefixes.
final class CanvasOrder {
    private var last: String

    init(existing: [CanvasElement]) {
        last = existing.map(\.index).max() ?? "a0"
    }

    func next() -> String {
        last += "n"
        return last
    }
}
