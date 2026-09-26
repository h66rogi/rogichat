import Foundation

@MainActor
final class ScheduleViewModel: ObservableObject {
    let channelId: Int
    private let repository: ChannelRepository

    @Published var schedules: [Schedule] = []
    @Published var selectedYearMonth: String
    @Published var isLoading = false
    @Published var selectedSchedule: Schedule?
    @Published var showScheduleDetail = false
    @Published var showDeleteAlert = false
    @Published var showEditSheet = false
    @Published var deleteError: String?
    @Published var showDeleteError = false

    private let calendar = Calendar.current

    var currentMonthString: String {
        let components = selectedYearMonth.split(separator: "-")
        guard components.count == 2,
              let year = Int(components[0]),
              let month = Int(components[1]) else {
            return selectedYearMonth
        }

        return "\(year)년 \(month)월"
    }

    var groupedSchedules: [ScheduleGroup] {
        let grouped = Dictionary(grouping: schedules) { schedule -> Date in
            calendar.startOfDay(for: schedule.startAt)
        }

        return grouped
            .map { ScheduleGroup(date: $0.key, schedules: $0.value.sorted { $0.startAt < $1.startAt }) }
            .sorted { $0.date < $1.date }
    }

    private var today: Date {
        calendar.startOfDay(for: Date())
    }

    var pastScheduleGroups: [ScheduleGroup] {
        groupedSchedules.filter { $0.date < today }
    }

    var upcomingScheduleGroups: [ScheduleGroup] {
        groupedSchedules.filter { $0.date >= today }
    }

    var pastScheduleCount: Int {
        pastScheduleGroups.reduce(0) { $0 + $1.schedules.count }
    }

    init(channelId: Int, repository: ChannelRepository = AppClientChannelRepository()) {
        self.channelId = channelId
        self.repository = repository

        let now = Date()
        let year = calendar.component(.year, from: now)
        let month = calendar.component(.month, from: now)
        self.selectedYearMonth = String(format: "%04d-%02d", year, month)
    }

    func loadSchedules() async {
        isLoading = true

        do {
            let response = try await repository.fetchSchedules(
                channelId: channelId,
                yearMonth: selectedYearMonth
            )
            schedules = response.items.map { $0.toDomain() }
        } catch {
        }

        isLoading = false
    }

    func deleteSchedule(_ schedule: Schedule) async -> Bool {
        do {
            try await repository.deleteSchedule(scheduleId: schedule.id)
            schedules.removeAll { $0.id == schedule.id }
            return true
        } catch {
            deleteError = "일정을 삭제할 수 없습니다."
            showDeleteError = true
            return false
        }
    }

    func previousMonth() {
        guard var components = parseYearMonth(selectedYearMonth) else { return }
        components.month! -= 1
        if components.month! < 1 {
            components.month = 12
            components.year! -= 1
        }
        selectedYearMonth = formatYearMonth(components)
    }

    func nextMonth() {
        guard var components = parseYearMonth(selectedYearMonth) else { return }
        components.month! += 1
        if components.month! > 12 {
            components.month = 1
            components.year! += 1
        }
        selectedYearMonth = formatYearMonth(components)
    }

    private func parseYearMonth(_ ym: String) -> DateComponents? {
        let parts = ym.split(separator: "-")
        guard parts.count == 2,
              let year = Int(parts[0]),
              let month = Int(parts[1]) else {
            return nil
        }
        return DateComponents(year: year, month: month)
    }

    private func formatYearMonth(_ components: DateComponents) -> String {
        guard let year = components.year, let month = components.month else {
            return selectedYearMonth
        }
        return String(format: "%04d-%02d", year, month)
    }
}
