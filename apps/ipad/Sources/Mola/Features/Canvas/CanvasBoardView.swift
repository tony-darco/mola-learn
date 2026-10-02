import SwiftUI

enum CanvasTool: String, CaseIterable {
    case pen, eraser, pan, text

    var systemImage: String {
        switch self {
        case .pen: return "pencil.tip"
        case .eraser: return "eraser"
        case .pan: return "hand.draw"
        case .text: return "textformat"
        }
    }
}

/// The infinite-ish whiteboard surface. Draws `model.elements` each frame and
/// turns touch input into new `draw`/`text` elements (or taps, in eraser
/// mode, into removals) — see `CanvasViewModel`'s header for exactly what's
/// in and out of scope versus `components/chat/CanvasView.tsx` on the web.
struct CanvasBoardView: View {
    @ObservedObject var model: CanvasViewModel

    @State private var tool: CanvasTool = .pen
    @State private var strokeColorHex = "#1c1b18"
    @State private var strokeWidth: Double = 3
    @State private var liveStrokeScreenPoints: [CGPoint] = []
    @State private var addingTextAt: CGPoint?
    @State private var newTextDraft = ""
    @State private var panStartViewport: CGPoint = .zero
    @State private var isPanning = false
    @State private var zoomStart: Double = 1

    private let palette = ["#1c1b18", "#481715", "#2563eb", "#15803d", "#b91c1c"]

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                backgroundLayer

                Canvas { context, _ in
                    for element in model.elements {
                        draw(element, in: &context)
                    }
                    if !liveStrokeScreenPoints.isEmpty {
                        var path = Path()
                        path.addLines(liveStrokeScreenPoints)
                        context.stroke(
                            path, with: .color(Color(hex: strokeColorHex) ?? .black),
                            style: StrokeStyle(lineWidth: strokeWidth, lineCap: .round, lineJoin: .round)
                        )
                    }
                }
                .contentShape(Rectangle())
                .gesture(primaryGesture)
                .simultaneousGesture(zoomGesture)

                // Real SwiftUI views for anything with readable text — lets
                // it wrap and stay crisp at any zoom, which a `Canvas`-drawn
                // `Text` would not. `allowsHitTesting(false)` so these never
                // steal the drag/erase gestures above from the board itself.
                ForEach(model.elements) { element in
                    textLikeOverlay(for: element)
                }
                .allowsHitTesting(false)
            }
            .clipped()
            .overlay(alignment: .top) { toolbar }
            .overlay(alignment: .bottomTrailing) { statusPill }
            .alert("Add text", isPresented: Binding(
                get: { addingTextAt != nil }, set: { if !$0 { addingTextAt = nil } }
            )) {
                TextField("Text", text: $newTextDraft)
                Button("Add") { commitNewText() }
                Button("Cancel", role: .cancel) { addingTextAt = nil; newTextDraft = "" }
            }
        }
        .background(Color(hex: model.background.color) ?? .white)
    }

    // MARK: - Gestures

    private var primaryGesture: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                // A simultaneous two-finger pinch can still deliver drag
                // updates for one of the fingers — ignore them so a pinch
                // doesn't also scribble a stray stroke in pen mode.
                guard !isZooming else { return }
                switch tool {
                case .pen:
                    liveStrokeScreenPoints.append(value.location)
                case .pan:
                    if !isPanning {
                        isPanning = true
                        panStartViewport = CGPoint(x: model.viewport.x, y: model.viewport.y)
                    }
                    model.viewport.x = panStartViewport.x + value.translation.width
                    model.viewport.y = panStartViewport.y + value.translation.height
                case .eraser, .text:
                    break
                }
            }
            .onEnded { value in
                switch tool {
                case .pen:
                    commitStroke()
                case .pan:
                    isPanning = false
                    model.viewportChanged()
                case .eraser:
                    eraseElement(near: value.location)
                case .text:
                    addingTextAt = value.location
                }
            }
    }

    @State private var isZooming = false

    private var zoomGesture: some Gesture {
        // `value` is the magnification relative to the gesture's START (1.0
        // when it began), not an incremental delta since the last callback
        // — unlike `DragGesture`'s `translation`. Anchoring to the zoom
        // level captured on the first callback (the same fix `isPanning`
        // needed above) avoids compounding it on every frame.
        MagnificationGesture()
            .onChanged { value in
                if !isZooming {
                    isZooming = true
                    zoomStart = model.viewport.zoom
                }
                model.viewport.zoom = min(4, max(0.2, zoomStart * value))
            }
            .onEnded { _ in
                isZooming = false
                model.viewportChanged()
            }
    }

    private func commitStroke() {
        defer { liveStrokeScreenPoints = [] }
        guard liveStrokeScreenPoints.count > 1 else { return }

        let worldPoints = liveStrokeScreenPoints.map(toWorld)
        let minX = worldPoints.map(\.x).min()!
        let minY = worldPoints.map(\.y).min()!
        let maxX = worldPoints.map(\.x).max()!
        let maxY = worldPoints.map(\.y).max()!
        let relative = worldPoints.map { CanvasPoint(x: $0.x - minX, y: $0.y - minY, pressure: nil) }

        model.addElement { index in
            CanvasElement(
                id: UUID().uuidString, parentId: nil, index: index, x: minX, y: minY,
                width: max(1, maxX - minX), height: max(1, maxY - minY),
                rotation: 0, opacity: 1, createdBy: "user",
                props: .draw(points: relative, color: strokeColorHex, strokeWidth: strokeWidth, variant: "pen", dash: "solid")
            )
        }
    }

    private func commitNewText() {
        defer { addingTextAt = nil; newTextDraft = "" }
        guard let screenPoint = addingTextAt, !newTextDraft.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        let world = toWorld(screenPoint)
        model.addElement { index in
            CanvasElement(
                id: UUID().uuidString, parentId: nil, index: index, x: world.x, y: world.y,
                width: 200, height: 40, rotation: 0, opacity: 1, createdBy: "user",
                props: .text(
                    text: newTextDraft, color: strokeColorHex, fontSize: 18,
                    backgroundColor: nil, bold: false, italic: false, textAlign: "left", autoFit: "grow"
                )
            )
        }
    }

    private func eraseElement(near screenPoint: CGPoint) {
        let world = toWorld(screenPoint)
        // Nearest element whose bounding box contains the tap, with a small
        // margin so a thin line/stroke is still tappable.
        let margin = 12.0 / model.viewport.zoom
        if let hit = model.elements.last(where: { el in
            world.x >= el.x - margin && world.x <= el.x + el.width + margin
                && world.y >= el.y - margin && world.y <= el.y + el.height + margin
        }) {
            model.removeElement(id: hit.id)
        }
    }

    // MARK: - Coordinate transform
    // screen = world * zoom + viewport(x, y) — matches the web's own
    // d3-zoom convention (`lib/canvas/marquee.ts`'s `ViewTransform` comment).

    private func toScreen(_ world: CGPoint) -> CGPoint {
        CGPoint(x: world.x * model.viewport.zoom + model.viewport.x, y: world.y * model.viewport.zoom + model.viewport.y)
    }
    private func toWorld(_ screen: CGPoint) -> CGPoint {
        CGPoint(x: (screen.x - model.viewport.x) / model.viewport.zoom, y: (screen.y - model.viewport.y) / model.viewport.zoom)
    }

    // MARK: - Rendering

    @ViewBuilder
    private var backgroundLayer: some View {
        switch model.background.pattern {
        case "blank":
            EmptyView()
        default:
            // Dots/grid/lines all render as the same light dot grid in v1 —
            // a visual simplification, not a functional gap (nothing reads
            // the pattern back out).
            GeometryReader { geo in
                Canvas { context, size in
                    let spacing = 24.0 * model.viewport.zoom
                    guard spacing > 4 else { return }
                    var x = model.viewport.x.truncatingRemainder(dividingBy: spacing)
                    while x < size.width {
                        var y = model.viewport.y.truncatingRemainder(dividingBy: spacing)
                        while y < size.height {
                            context.fill(Path(ellipseIn: CGRect(x: x - 1, y: y - 1, width: 2, height: 2)), with: .color(MolaColor.border))
                            y += spacing
                        }
                        x += spacing
                    }
                }
                .frame(width: geo.size.width, height: geo.size.height)
            }
        }
    }

    private func draw(_ element: CanvasElement, in context: inout GraphicsContext) {
        switch element.props {
        case .draw(let points, let color, let strokeWidth, let variant, _):
            var path = Path()
            path.addLines(points.map { toScreen(CGPoint(x: element.x + $0.x, y: element.y + $0.y)) })
            let color = Color(hex: color) ?? .black
            context.stroke(
                path, with: .color(variant == "highlighter" ? color.opacity(0.35) : color),
                style: StrokeStyle(
                    lineWidth: (variant == "highlighter" ? strokeWidth * 3 : strokeWidth) * model.viewport.zoom,
                    lineCap: .round, lineJoin: .round
                )
            )
        case .line(let endX, let endY, let color, let strokeWidth, _, _, _):
            var path = Path()
            path.move(to: toScreen(CGPoint(x: element.x, y: element.y)))
            path.addLine(to: toScreen(CGPoint(x: element.x + endX, y: element.y + endY)))
            context.stroke(path, with: .color(Color(hex: color) ?? .black), style: StrokeStyle(lineWidth: strokeWidth * model.viewport.zoom, lineCap: .round))
        case .shape(let shapeKind, let color, let fillColor, _, let strokeWidth, _):
            let rect = CGRect(origin: toScreen(CGPoint(x: element.x, y: element.y)), size: CGSize(width: element.width * model.viewport.zoom, height: element.height * model.viewport.zoom))
            let path = shapePath(shapeKind, in: rect)
            if let fillColor, let fill = Color(hex: fillColor) {
                context.fill(path, with: .color(fill))
            }
            context.stroke(path, with: .color(Color(hex: color) ?? .black), style: StrokeStyle(lineWidth: strokeWidth * model.viewport.zoom))
        case .frame(let name):
            let rect = CGRect(origin: toScreen(CGPoint(x: element.x, y: element.y)), size: CGSize(width: element.width * model.viewport.zoom, height: element.height * model.viewport.zoom))
            context.stroke(Path(rect), with: .color(MolaColor.muted), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
            context.draw(Text(name).font(.caption).foregroundStyle(MolaColor.muted), at: CGPoint(x: rect.minX + 4, y: rect.minY - 10), anchor: .leading)
        case .text, .note, .math, .image:
            break // rendered as real SwiftUI views below, for selectable/readable text
        }
    }

    private func shapePath(_ kind: String, in rect: CGRect) -> Path {
        switch kind {
        case "ellipse": return Path(ellipseIn: rect)
        case "triangle":
            var p = Path()
            p.move(to: CGPoint(x: rect.midX, y: rect.minY))
            p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
            p.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
            p.closeSubpath()
            return p
        case "star":
            return Path(rect) // simplified — a real star path isn't worth the geometry for v1
        default:
            return Path(rect)
        }
    }

    @ViewBuilder
    private func textLikeOverlay(for element: CanvasElement) -> some View {
        let origin = toScreen(CGPoint(x: element.x, y: element.y))
        let size = CGSize(width: element.width * model.viewport.zoom, height: element.height * model.viewport.zoom)

        switch element.props {
        case .text(let text, let color, let fontSize, let backgroundColor, let bold, let italic, let textAlign, _):
            Text(text)
                .font(.system(size: fontSize * model.viewport.zoom, weight: bold ? .bold : .regular))
                .italic(italic)
                .multilineTextAlignment(textAlignment(textAlign))
                .foregroundStyle(Color(hex: color) ?? .black)
                .frame(width: size.width, height: size.height, alignment: frameAlignment(textAlign))
                .background(backgroundColor.flatMap { Color(hex: $0) } ?? .clear)
                .position(x: origin.x + size.width / 2, y: origin.y + size.height / 2)
        case .note(let text, let color, let textColor, let fontSize, let bold, let italic, let textAlign, _):
            Text(text)
                .font(.system(size: fontSize * model.viewport.zoom, weight: bold ? .bold : .regular))
                .italic(italic)
                .multilineTextAlignment(textAlignment(textAlign))
                .foregroundStyle(Color(hex: textColor) ?? .black)
                .padding(6)
                .frame(width: size.width, height: size.height, alignment: frameAlignment(textAlign))
                .background(Color(hex: color) ?? .yellow)
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .position(x: origin.x + size.width / 2, y: origin.y + size.height / 2)
        case .math(let latex, let color, let fontSize):
            // No KaTeX/MathJax in SwiftUI — shows the raw LaTeX source
            // rather than rendering it. See the iPad README's scope note.
            Text(latex)
                .font(.system(size: fontSize * model.viewport.zoom, design: .monospaced))
                .foregroundStyle(Color(hex: color) ?? .black)
                .position(x: origin.x + size.width / 2, y: origin.y + size.height / 2)
        case .image(let url, _, _):
            if let imageURL = URL(string: url) {
                AsyncImage(url: imageURL) { phase in
                    switch phase {
                    case .success(let image): image.resizable().scaledToFit()
                    default: Color.gray.opacity(0.2)
                    }
                }
                .frame(width: size.width, height: size.height)
                .position(x: origin.x + size.width / 2, y: origin.y + size.height / 2)
            }
        case .draw, .line, .shape, .frame:
            EmptyView()
        }
    }

    private func textAlignment(_ value: String) -> TextAlignment {
        switch value {
        case "center": return .center
        case "right": return .trailing
        default: return .leading
        }
    }
    private func frameAlignment(_ value: String) -> Alignment {
        switch value {
        case "center": return .center
        case "right": return .trailing
        default: return .leading
        }
    }

    // MARK: - Chrome

    private var toolbar: some View {
        HStack(spacing: MolaSpacing.sm) {
            ForEach(CanvasTool.allCases, id: \.self) { candidate in
                Button {
                    tool = candidate
                } label: {
                    Image(systemName: candidate.systemImage)
                        .padding(8)
                        .background(tool == candidate ? MolaColor.accent.opacity(0.15) : .clear, in: Circle())
                }
            }
            Divider().frame(height: 20)
            ForEach(palette, id: \.self) { hex in
                Circle()
                    .fill(Color(hex: hex) ?? .black)
                    .frame(width: 20, height: 20)
                    .overlay(Circle().stroke(MolaColor.border, lineWidth: strokeColorHex == hex ? 2 : 0))
                    .onTapGesture { strokeColorHex = hex }
            }
        }
        .padding(MolaSpacing.sm)
        .background(MolaColor.panel, in: Capsule())
        .overlay(Capsule().stroke(MolaColor.border, lineWidth: 1))
        .padding(.top, MolaSpacing.sm)
        .tint(MolaColor.accent)
    }

    private var statusPill: some View {
        Group {
            if model.isSaving {
                Label("Saving…", systemImage: "arrow.triangle.2.circlepath").font(.caption)
            } else if let error = model.saveError {
                Label(error, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(MolaColor.danger)
            }
        }
        .padding(MolaSpacing.xs)
        .background(MolaColor.panel.opacity(0.9), in: Capsule())
        .padding(MolaSpacing.sm)
    }
}

extension Color {
    /// `nil` on anything that isn't a plain `#rrggbb`/`#rgb` string — callers
    /// fall back to a sensible default rather than force-unwrapping, since
    /// this renders content a different client (the web app) produced.
    init?(hex rawHex: String) {
        var hex = rawHex.trimmingCharacters(in: .whitespacesAndNewlines)
        if hex.hasPrefix("#") { hex.removeFirst() }
        guard hex.count == 6 || hex.count == 3 else { return nil }
        if hex.count == 3 { hex = hex.map { "\($0)\($0)" }.joined() }
        guard let value = UInt32(hex, radix: 16) else { return nil }
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
