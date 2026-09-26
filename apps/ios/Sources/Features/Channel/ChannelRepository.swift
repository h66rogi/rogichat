import Foundation

@MainActor protocol ChannelRepository {
    // MARK: - Detail
    func fetchChannelDetail(identifier: String) async throws -> ChannelDTO
    func fetchChannelProfile(channelId: Int) async throws -> ChannelProfile
    func fetchChannelPermission(identifier: String) async throws -> ChannelPermissionResponse
    func fetchChannelWardrobe(identifier: String) async throws -> ChannelWardrobeResponse
    func checkFavorite(channelId: Int) async throws -> FavoriteStatusResponse
    func fetchFavoritesCount(channelId: Int) async throws -> ChannelFavoritesCountResponse
    func addFavorite(channelId: Int) async throws
    func removeFavorite(channelId: Int) async throws

    // MARK: - Management (Categories)
    func fetchCategoriesManage(channelId: Int) async throws -> [Category]
    func createCategory(channelId: Int, name: String, color: String) async throws -> Category
    func updateCategory(channelId: Int, categoryId: Int, name: String, color: String, displayOrder: Int?) async throws -> Category
    func deleteCategory(channelId: Int, categoryId: Int) async throws

    // MARK: - Settings
    func updateChannel(identifier: String, body: UpdateChannelRequestBody) async throws -> ChannelDTO
    func uploadImage(imageData: Data, fileName: String, mimeType: String) async throws -> UploadImageResponse

    // MARK: - Schedules
    func fetchSchedules(channelId: Int, yearMonth: String?) async throws -> SchedulesResponse
    func deleteSchedule(scheduleId: Int) async throws
    func createSchedule(channelId: Int, schedule: CreateScheduleRequest) async throws -> ScheduleDTO
    func updateSchedule(scheduleId: Int, schedule: UpdateScheduleRequest) async throws -> ScheduleDTO
}

@MainActor final class AppClientChannelRepository: ChannelRepository {
    private let client: ChannelAPIClient
    init(client: ChannelAPIClient = .shared) { self.client = client }

    // MARK: - Detail

    func fetchChannelDetail(identifier: String) async throws -> ChannelDTO {
        try await client.request(
            endpoint: .channelDetail(identifier: identifier),
            responseType: ChannelDTO.self
        )
    }

    func fetchChannelProfile(channelId: Int) async throws -> ChannelProfile {
        try await client.request(
            endpoint: .channelProfile(channelId: channelId),
            responseType: ChannelProfile.self
        )
    }

    func fetchChannelPermission(identifier: String) async throws -> ChannelPermissionResponse {
        try await client.request(
            endpoint: .channelPermission(identifier: identifier),
            responseType: ChannelPermissionResponse.self
        )
    }

    func fetchChannelWardrobe(identifier: String) async throws -> ChannelWardrobeResponse {
        try await client.request(
            endpoint: .channelWardrobe(identifier: identifier),
            responseType: ChannelWardrobeResponse.self
        )
    }

    func checkFavorite(channelId: Int) async throws -> FavoriteStatusResponse {
        try await client.request(
            endpoint: .checkFavorite(channelId: channelId),
            responseType: FavoriteStatusResponse.self
        )
    }

    func fetchFavoritesCount(channelId: Int) async throws -> ChannelFavoritesCountResponse {
        try await client.request(
            endpoint: .channelFavoritesCount(channelId: channelId),
            responseType: ChannelFavoritesCountResponse.self
        )
    }

    func addFavorite(channelId: Int) async throws {
        try await client.requestWithoutResponse(
            endpoint: .addFavorite(channelId: channelId)
        )
    }

    func removeFavorite(channelId: Int) async throws {
        try await client.requestWithoutResponse(
            endpoint: .removeFavorite(channelId: channelId)
        )
    }

    // MARK: - Management (Categories)

    func fetchCategoriesManage(channelId: Int) async throws -> [Category] {
        try await client.request(
            endpoint: .channelCategoriesManage(channelId: channelId),
            responseType: [Category].self
        )
    }

    func createCategory(channelId: Int, name: String, color: String) async throws -> Category {
        try await client.request(
            endpoint: .createCategory(channelId: channelId, name: name, color: color),
            responseType: Category.self
        )
    }

    func updateCategory(channelId: Int, categoryId: Int, name: String, color: String, displayOrder: Int?) async throws -> Category {
        try await client.request(
            endpoint: .updateCategory(channelId: channelId, categoryId: categoryId, name: name, color: color, displayOrder: displayOrder),
            responseType: Category.self
        )
    }

    func deleteCategory(channelId: Int, categoryId: Int) async throws {
        try await client.requestWithoutResponse(
            endpoint: .deleteCategory(channelId: channelId, categoryId: categoryId)
        )
    }

    // MARK: - Settings

    func updateChannel(identifier: String, body: UpdateChannelRequestBody) async throws -> ChannelDTO {
        try await client.request(
            endpoint: .updateChannel(identifier: identifier, body: body),
            responseType: ChannelDTO.self
        )
    }

    func uploadImage(imageData: Data, fileName: String, mimeType: String) async throws -> UploadImageResponse {
        try await client.uploadImage(imageData: imageData, fileName: fileName, mimeType: mimeType)
    }

    // MARK: - Schedules

    func fetchSchedules(channelId: Int, yearMonth: String?) async throws -> SchedulesResponse {
        try await client.request(
            endpoint: .channelSchedules(channelId: channelId, yearMonth: yearMonth),
            responseType: SchedulesResponse.self
        )
    }

    func deleteSchedule(scheduleId: Int) async throws {
        try await client.requestWithoutResponse(
            endpoint: .deleteSchedule(scheduleId: scheduleId)
        )
    }

    func createSchedule(channelId: Int, schedule: CreateScheduleRequest) async throws -> ScheduleDTO {
        try await client.request(
            endpoint: .createSchedule(channelId: channelId, schedule: schedule),
            responseType: ScheduleDTO.self
        )
    }

    func updateSchedule(scheduleId: Int, schedule: UpdateScheduleRequest) async throws -> ScheduleDTO {
        try await client.request(
            endpoint: .updateSchedule(scheduleId: scheduleId, schedule: schedule),
            responseType: ScheduleDTO.self
        )
    }
}
