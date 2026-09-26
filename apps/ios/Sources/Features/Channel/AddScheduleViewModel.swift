import Foundation

@MainActor
final class AddScheduleViewModel: ObservableObject {
    let channelId: Int
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

    init(channelId: Int, repository: ChannelRepository = AppClientChannelRepository()) {
        self.channelId = channelId
        self.repository = repository
        // Set default end time to 1 hour after start
        self.endAt = Date().addingTimeInterval(3600)
    }

    func createSchedule() async -> Bool {
        isLoading = true
        errorMessage = nil

        let request = CreateScheduleRequest(
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            content: content.isEmpty ? nil : content,
            startAt: startAt,
            endAt: hasEndTime ? endAt : nil,
            allDay: allDay,
            visibility: visibility,
            location: location.isEmpty ? nil : location,
            externalUrl: externalUrl.isEmpty ? nil : externalUrl,
            status: status.rawValue
        )

        do {
            _ = try await repository.createSchedule(channelId: channelId, schedule: request)
            isLoading = false
            return true
        } catch let error as ChannelAPIError {
            isLoading = false
            switch error {
            case .clientError(let statusCode, let message):
                if statusCode == 403 {
                    errorMessage = "일정을 추가할 권한이 없습니다."
                } else {
                    errorMessage = message
                }
            case .unauthorized:
                errorMessage = "로그인이 필요합니다."
            default:
                errorMessage = error.errorDescription ?? "일정 추가에 실패했습니다."
            }
            return false
        } catch {
            isLoading = false
            errorMessage = "일정 추가에 실패했습니다."
            return false
        }
    }
}
