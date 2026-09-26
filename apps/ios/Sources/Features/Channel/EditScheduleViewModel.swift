import Foundation

@MainActor
final class EditScheduleViewModel: ObservableObject {
    let scheduleId: Int
    private let repository: ChannelRepository

    // Required fields
    @Published var title = ""
    @Published var startAt = Date()
    @Published var allDay = false

    // Optional fields
    @Published var hasEndTime = false
    @Published var endAt = Date()
    @Published var status: ScheduleType = .live
    @Published var location = ""
    @Published var externalUrl = ""
    @Published var content = ""
    @Published var visibility = "PUBLIC"

    // State
    @Published var isLoading = false
    @Published var errorMessage: String?

    var isValid: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    init(schedule: Schedule, repository: ChannelRepository = AppClientChannelRepository()) {
        self.scheduleId = schedule.id
        self.repository = repository
        self.title = schedule.title
        self.startAt = schedule.startAt
        self.allDay = schedule.allDay
        self.hasEndTime = schedule.endAt != nil
        self.endAt = schedule.endAt ?? schedule.startAt.addingTimeInterval(3600)
        self.status = schedule.scheduleType
        self.location = schedule.location ?? ""
        self.externalUrl = schedule.externalUrl ?? ""
        self.content = schedule.description ?? ""
        self.visibility = schedule.isPublic ? "PUBLIC" : "PRIVATE"
    }

    func updateSchedule() async -> Bool {
        isLoading = true
        errorMessage = nil

        let normalizedExternalUrl: String? = {
            let trimmed = externalUrl.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { return nil }
            if !trimmed.contains("://") {
                return "https://" + trimmed
            }
            return trimmed
        }()

        let request = UpdateScheduleRequest(
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            content: content.isEmpty ? nil : content,
            startAt: startAt,
            endAt: hasEndTime ? endAt : nil,
            allDay: allDay,
            visibility: visibility,
            location: location.isEmpty ? nil : location,
            externalUrl: normalizedExternalUrl,
            status: status.rawValue
        )

        do {
            _ = try await repository.updateSchedule(scheduleId: scheduleId, schedule: request)
            isLoading = false
            return true
        } catch let error as ChannelAPIError {
            isLoading = false
            switch error {
            case .clientError(let statusCode, let message):
                if statusCode == 403 {
                    errorMessage = "일정을 수정할 권한이 없습니다."
                } else {
                    errorMessage = message
                }
            case .unauthorized:
                errorMessage = "로그인이 필요합니다."
            default:
                errorMessage = error.errorDescription ?? "일정 수정에 실패했습니다."
            }
            return false
        } catch {
            isLoading = false
            errorMessage = "일정 수정에 실패했습니다."
            return false
        }
    }
}
