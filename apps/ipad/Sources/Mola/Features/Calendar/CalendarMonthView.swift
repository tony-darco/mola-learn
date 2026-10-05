import SwiftUI

/// A month grid against `GET /api/calendar/events?from=&to=`, mirroring
/// `MonthGrid.tsx`. Read-only for now — creating/editing a personal event and
/// the Google/ICS source panels (`SourcesPanel.tsx`, `FeedsDrawer.tsx`) are
/// future work (see the iPad README).
struct CalendarMonthView: View {
    @EnvironmentObject private var client: MolaClient
    @State private var monthAnchor = Calendar.current.startOfDay(for: Date())
    @State private var events: [CalendarEvent] = []
    @State private var isLoading = true
    @State private var error: String?

    private let calendar = Calendar.current
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 1), count: 7)

    var body: some View {
        VStack(spacing: 0) {
            header
            if isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                grid
            }
        }
        .background(MolaColor.background)
        .navigationTitle("Calendar")
        .task(id: monthAnchor) { await load() }
    }

    private var header: some View {
        HStack {
            Button { shiftMonth(by: -1) } label: { Image(systemName: "chevron.left") }
            Spacer()
            Text(monthTitle).font(MolaFont.title(18))
            Spacer()
            Button { shiftMonth(by: 1) } label: { Image(systemName: "chevron.right") }
        }
        .padding(MolaSpacing.md)
        .tint(MolaColor.accent)
    }

    private var grid: some View {
        VStack(spacing: 1) {
            LazyVGrid(columns: columns, spacing: 1) {
                ForEach(calendar.shortWeekdaySymbols, id: \.self) { symbol in
                    Text(symbol).font(.caption).foregroundStyle(MolaColor.muted)
                }
            }
            LazyVGrid(columns: columns, spacing: 1) {
                ForEach(daysInGrid, id: \.self) { date in
                    DayCell(
                        date: date,
                        isCurrentMonth: calendar.isDate(date, equalTo: monthAnchor, toGranularity: .month),
                        events: events(on: date)
                    )
                }
            }
        }
        .background(MolaColor.border)
    }

    private var monthTitle: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "LLLL yyyy"
        return formatter.string(from: monthAnchor)
    }

    private var daysInGrid: [Date] {
        guard
            let monthInterval = calendar.dateInterval(of: .month, for: monthAnchor),
            let firstWeek = calendar.dateInterval(of: .weekOfMonth, for: monthInterval.start)
        else { return [] }
        var days: [Date] = []
        var cursor = firstWeek.start
        // 6 full weeks covers every month's grid without recomputing a
        // variable row count, same trade-off `MonthGrid.tsx` makes.
        for _ in 0..<42 {
            days.append(cursor)
            cursor = calendar.date(byAdding: .day, value: 1, to: cursor) ?? cursor
        }
        return days
    }

    private func events(on date: Date) -> [CalendarEvent] {
        events.filter { event in
            guard let start = Date.parseMolaTimestamp(event.start) else { return false }
            return calendar.isDate(start, inSameDayAs: date)
        }
    }

    private func shiftMonth(by delta: Int) {
        monthAnchor = calendar.date(byAdding: .month, value: delta, to: monthAnchor) ?? monthAnchor
    }

    private func load() async {
        isLoading = true
        error = nil
        guard
            let monthInterval = calendar.dateInterval(of: .month, for: monthAnchor),
            let from = calendar.dateInterval(of: .weekOfMonth, for: monthInterval.start)?.start,
            let to = calendar.date(byAdding: .day, value: 42, to: from)
        else { isLoading = false; return }

        let iso = ISO8601DateFormatter()
        do {
            let response: CalendarEventsResponse = try await client.get(
                "api/calendar/events", query: ["from": iso.string(from: from), "to": iso.string(from: to)]
            )
            self.events = response.events
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

private struct DayCell: View {
    let date: Date
    let isCurrentMonth: Bool
    let events: [CalendarEvent]

    private var dayNumber: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "d"
        return formatter.string(from: date)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(dayNumber)
                .font(.caption2)
                .foregroundStyle(isCurrentMonth ? MolaColor.text : MolaColor.muted)
            ForEach(events.prefix(3)) { event in
                Text(event.title)
                    .font(.system(size: 9))
                    .lineLimit(1)
                    .padding(.horizontal, 3)
                    .padding(.vertical, 1)
                    .background(MolaColor.accent.opacity(0.15))
                    .foregroundStyle(MolaColor.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 3))
            }
            if events.count > 3 {
                Text("+\(events.count - 3) more").font(.system(size: 9)).foregroundStyle(MolaColor.muted)
            }
        }
        .padding(4)
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .topLeading)
        .background(MolaColor.panel)
    }
}

extension Date {
    /// Postgres `timestamptz` columns round-trip through `Date.toISOString()`
    /// with milliseconds (`...123Z`), which the plain `ISO8601DateFormatter`
    /// rejects — this tries the fractional-second variant first, then falls
    /// back to the plain one.
    static func parseMolaTimestamp(_ value: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: value) { return date }
        return ISO8601DateFormatter().date(from: value)
    }
}
