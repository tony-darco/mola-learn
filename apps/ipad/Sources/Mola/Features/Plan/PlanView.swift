import SwiftUI

/// Mirrors `PlanTab.tsx`: today's tasks, the week, and the semester, each
/// independently proposed/accepted (§5's propose → amend → accept gate).
/// Amending a plan (`POST /api/plan/:id/amend`) is left out of this first
/// pass — accepting a proposal and checking off today's tasks are wired;
/// editing one in place is future work (see the iPad README).
struct PlanView: View {
    @EnvironmentObject private var client: MolaClient
    @StateObject private var model = PlanViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: MolaSpacing.lg) {
                TodaySection(model: model)
                if let week = model.week {
                    WeekSection(plan: week, onAccept: { Task { await model.accept(week) } })
                }
                if let semester = model.semester {
                    SemesterSection(plan: semester, onAccept: { Task { await model.accept(semester) } })
                }
                if let error = model.error {
                    Text(error).font(MolaFont.body()).foregroundStyle(MolaColor.danger)
                }
            }
            .padding(MolaSpacing.lg)
        }
        .background(MolaColor.background)
        .navigationTitle("Plan")
        .task { await model.load(client: client) }
        .refreshable { await model.load(client: client) }
    }
}

private struct TodaySection: View {
    @ObservedObject var model: PlanViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: MolaSpacing.sm) {
            Text("Today").font(MolaFont.title(20))
            if model.tasks.isEmpty {
                Text("Nothing scheduled.").font(MolaFont.body()).foregroundStyle(MolaColor.muted)
            } else {
                ForEach(model.tasks) { task in
                    TaskRow(task: task) { Task { await model.toggle(task) } }
                }
            }
            if let day = model.day, case .day(_, let summary, _) = day.payload, day.status == "proposed" {
                PendingProposalRow(summary: summary ?? "A plan for today is ready.") {
                    Task { await model.accept(day) }
                }
            }
        }
        .padding(MolaSpacing.md)
        .molaCard()
    }
}

private struct TaskRow: View {
    let task: TaskView
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack {
                Image(systemName: task.status == "done" ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(task.status == "done" ? MolaColor.success : MolaColor.muted)
                VStack(alignment: .leading) {
                    Text(task.title)
                        .font(MolaFont.body())
                        .strikethrough(task.status == "done")
                        .foregroundStyle(MolaColor.text)
                    if let minutes = task.estimatedMinutes {
                        Text("\(minutes) min").font(.caption).foregroundStyle(MolaColor.muted)
                    }
                }
                Spacer()
            }
        }
        .buttonStyle(.plain)
    }
}

private struct WeekSection: View {
    let plan: PlanRecord
    let onAccept: () -> Void

    var body: some View {
        if case .week(_, let summary, let focus, let days, let risks) = plan.payload {
            VStack(alignment: .leading, spacing: MolaSpacing.sm) {
                Text("This week").font(MolaFont.title(20))
                Text(summary).font(MolaFont.body()).foregroundStyle(MolaColor.text)
                ForEach(focus, id: \.text) { f in
                    Text("• \(f.text)").font(.caption).foregroundStyle(MolaColor.muted)
                }
                if !risks.isEmpty {
                    Text("Heads up").font(MolaFont.body(.semibold))
                    ForEach(risks, id: \.self) { risk in
                        Text("• \(risk)").font(.caption).foregroundStyle(MolaColor.muted)
                    }
                }
                Text("\(days.reduce(0) { $0 + $1.items.count }) planned items across \(days.count) days")
                    .font(.caption).foregroundStyle(MolaColor.muted)
                if plan.status == "proposed" {
                    PendingProposalRow(summary: "This week's plan is ready to accept.", onAccept: onAccept)
                }
            }
            .padding(MolaSpacing.md)
            .molaCard()
        }
    }
}

private struct SemesterSection: View {
    let plan: PlanRecord
    let onAccept: () -> Void

    var body: some View {
        if case .semester(let summary, let goals, let milestones) = plan.payload {
            VStack(alignment: .leading, spacing: MolaSpacing.sm) {
                Text("The semester").font(MolaFont.title(20))
                Text(summary).font(MolaFont.body()).foregroundStyle(MolaColor.text)
                ForEach(goals, id: \.text) { g in
                    Text("• \(g.text)").font(.caption).foregroundStyle(MolaColor.muted)
                }
                ForEach(milestones) { m in
                    HStack {
                        Text(m.title).font(.caption).foregroundStyle(MolaColor.text)
                        Spacer()
                        Text(m.targetDate).font(.caption).foregroundStyle(MolaColor.muted)
                    }
                }
                if plan.status == "proposed" {
                    PendingProposalRow(summary: "A semester plan is ready to accept.", onAccept: onAccept)
                }
            }
            .padding(MolaSpacing.md)
            .molaCard()
        }
    }
}

private struct PendingProposalRow: View {
    let summary: String
    let onAccept: () -> Void

    var body: some View {
        HStack {
            Text(summary).font(.caption).foregroundStyle(MolaColor.muted)
            Spacer()
            Button("Accept", action: onAccept)
                .buttonStyle(.borderedProminent)
                .tint(MolaColor.accent)
        }
    }
}

@MainActor
final class PlanViewModel: ObservableObject {
    @Published var day: PlanRecord?
    @Published var week: PlanRecord?
    @Published var semester: PlanRecord?
    @Published var tasks: [TaskView] = []
    @Published var error: String?

    private var client: MolaClient?

    func load(client: MolaClient) async {
        self.client = client
        error = nil
        async let dayResponse: PlanResponse = client.get("api/plan", query: ["horizon": "day"])
        async let weekResponse: PlanResponse = client.get("api/plan", query: ["horizon": "week"])
        async let semesterResponse: PlanResponse = client.get("api/plan", query: ["horizon": "semester"])
        async let tasksResponse: TasksResponse = client.get("api/tasks")
        do {
            let (d, w, s, t) = try await (dayResponse, weekResponse, semesterResponse, tasksResponse)
            self.day = d.plan
            self.week = w.plan
            self.semester = s.plan
            self.tasks = t.tasks
        } catch {
            self.error = error.localizedDescription
        }
    }

    func accept(_ plan: PlanRecord) async {
        guard let client else { return }
        do {
            try await client.sendVoid("api/plan/\(plan.id)/accept", method: "POST")
            await load(client: client)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func toggle(_ task: TaskView) async {
        guard let client else { return }
        let newStatus = task.status == "done" ? "todo" : "done"
        do {
            try await client.sendVoid("api/tasks/\(task.id)", method: "PATCH", body: ["status": newStatus])
            await load(client: client)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
