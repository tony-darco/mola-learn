import SwiftUI

/// `MindMapView.tsx` on the web is a d3 force/zoom canvas. Reproducing that
/// interaction model in SwiftUI is a separate project in its own right, so
/// this renders the same tree as an indented, collapsible outline instead —
/// every node and the parent/child structure is there, cross-links (`edges`)
/// listed below it, just not as a pannable canvas. A real canvas version is
/// listed as future work in the iPad README.
struct MindMapView: View {
    let title: String
    let rootId: String
    let nodes: [MindMapNode]
    let edges: [MindMapEdge]

    private var byParent: [String?: [MindMapNode]] {
        Dictionary(grouping: nodes, by: { $0.parentId })
    }
    private var byId: [String: MindMapNode] {
        Dictionary(uniqueKeysWithValues: nodes.map { ($0.id, $0) })
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: MolaSpacing.sm) {
                if let root = byId[rootId] {
                    OutlineRow(node: root, depth: 0, byParent: byParent)
                } else {
                    // No single declared root resolved — fall back to every
                    // node with no parent, so the tree still renders.
                    ForEach(byParent[nil] ?? []) { node in
                        OutlineRow(node: node, depth: 0, byParent: byParent)
                    }
                }

                if !edges.isEmpty {
                    Divider().padding(.vertical, MolaSpacing.sm)
                    Text("Cross-links").font(MolaFont.body(.semibold)).foregroundStyle(MolaColor.text)
                    ForEach(Array(edges.enumerated()), id: \.offset) { _, edge in
                        let fromLabel = byId[edge.from]?.label ?? edge.from
                        let toLabel = byId[edge.to]?.label ?? edge.to
                        HStack(spacing: MolaSpacing.xs) {
                            Image(systemName: "arrow.triangle.branch").foregroundStyle(MolaColor.muted)
                            Text("\(fromLabel) → \(toLabel)")
                                .font(.caption)
                                .foregroundStyle(MolaColor.muted)
                            if let label = edge.label {
                                Text("(\(label))").font(.caption).foregroundStyle(MolaColor.muted)
                            }
                        }
                    }
                }
            }
            .padding(MolaSpacing.lg)
        }
        .background(MolaColor.background)
    }
}

private struct OutlineRow: View {
    let node: MindMapNode
    let depth: Int
    let byParent: [String?: [MindMapNode]]
    @State private var expanded = true

    private var children: [MindMapNode] { byParent[node.id] ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: MolaSpacing.xs) {
            Button {
                withAnimation { expanded.toggle() }
            } label: {
                HStack(spacing: MolaSpacing.xs) {
                    if !children.isEmpty {
                        Image(systemName: expanded ? "chevron.down" : "chevron.right")
                            .font(.caption)
                            .foregroundStyle(MolaColor.muted)
                    } else {
                        Image(systemName: "circle.fill")
                            .font(.system(size: 5))
                            .foregroundStyle(MolaColor.accent)
                    }
                    Text(node.label)
                        .font(depth == 0 ? MolaFont.body(.bold) : MolaFont.body())
                        .foregroundStyle(MolaColor.text)
                }
            }
            .buttonStyle(.plain)

            if let note = node.note {
                Text(note)
                    .font(.caption)
                    .foregroundStyle(MolaColor.muted)
                    .padding(.leading, 20)
            }

            if expanded {
                ForEach(children) { child in
                    OutlineRow(node: child, depth: depth + 1, byParent: byParent)
                        .padding(.leading, 20)
                }
            }
        }
    }
}
