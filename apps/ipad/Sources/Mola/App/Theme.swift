import SwiftUI

/// Design tokens ported 1:1 from `apps/web/app/globals.css`'s `:root` block —
/// the "Mola" theme (the web app's default; it has no dark variant yet, same
/// as here). Keep these two files in sync by hand if the web palette changes;
/// there is no shared source of truth across the Next.js and Swift targets.
enum MolaColor {
    static let background = Color(hex: 0xF7F5EE)
    static let panel = Color(hex: 0xFFFFFF)
    static let border = Color(hex: 0xE5E1D3)
    static let text = Color(hex: 0x1C1B18)
    static let muted = Color(hex: 0x7A776E)
    static let accent = Color(hex: 0x481715)
    static let accentForeground = Color(hex: 0xF7F5EE)
    static let sidebarBackground = Color(hex: 0xF7F5EE)

    // Semantic extras the web app expresses via Tailwind utilities with no
    // single named CSS variable — chosen to read consistently with the
    // palette above rather than lifted from a specific class.
    static let danger = Color(hex: 0x8B2E22)
    static let success = Color(hex: 0x3F6B4A)
}

enum MolaRadius {
    static let sm: CGFloat = 6
    static let md: CGFloat = 8
    static let lg: CGFloat = 12
}

enum MolaSpacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 16
    static let lg: CGFloat = 24
    static let xl: CGFloat = 32
}

/// `font: 15px/1.6 ui-sans-serif, system-ui, ...` from globals.css — the
/// system font at a matching size/leading rather than a bundled face, since
/// the web app itself never loads a custom font for body text.
enum MolaFont {
    static func body(_ weight: Font.Weight = .regular) -> Font {
        .system(size: 15, weight: weight, design: .default)
    }
    static func title(_ size: CGFloat = 28, weight: Font.Weight = .bold) -> Font {
        .system(size: size, weight: weight, design: .default)
    }
    static func mono(_ size: CGFloat = 14) -> Font {
        .system(size: size, weight: .regular, design: .monospaced)
    }
}

extension Color {
    init(hex: UInt32) {
        let r = Double((hex >> 16) & 0xFF) / 255
        let g = Double((hex >> 8) & 0xFF) / 255
        let b = Double(hex & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
    }
}

/// A single `.mola(...)` card style used across the app, matching the web
/// app's `.border .rounded-lg .bg-surface` pattern seen throughout the shell.
struct MolaCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(MolaColor.panel)
            .clipShape(RoundedRectangle(cornerRadius: MolaRadius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: MolaRadius.lg, style: .continuous)
                    .stroke(MolaColor.border, lineWidth: 1)
            )
    }
}

extension View {
    func molaCard() -> some View { modifier(MolaCard()) }
}
