import Foundation

@MainActor protocol ConsoleRepository {
    func fetchChannelDetail(identifier: String) async throws -> ChannelDTO
    func fetchActiveSession(identifier: String) async throws -> ConsoleSessionDTO?
    func startSession(payload: StartSessionPayload) async throws -> ConsoleSessionDTO
    func endSession(sessionId: Int) async throws
    func fetchQueue(sessionId: Int, includeCompleted: Bool) async throws -> ConsoleQueueResponseDTO
    func fetchNowPlaying(sessionId: Int) async throws -> ConsoleSongRequestDTO?
    func playNow(requestId: Int) async throws -> ConsoleSongRequestDTO
    func playNext(sessionId: Int) async throws -> ConsoleSongRequestDTO?
    func skipCurrent(sessionId: Int, reason: String?) async throws -> ConsoleSongRequestDTO?
    func deleteRequest(requestId: Int) async throws
    func updateRequestOrder(requestId: Int, newOrder: Int) async throws
    func clearQueue(sessionId: Int) async throws -> ClearQueueResponse
    func createManualRequest(sessionId: Int, payload: CreateManualRequestPayload) async throws -> ConsoleSongRequestDTO
    func updateSessionSettings(sessionId: Int, payload: UpdateSettingsPayload) async throws -> ConsoleSessionSettingsDTO
    func updatePricingSettings(channelId: Int, payload: UpdatePricingSettingsPayload) async throws -> PricingSettingsDTO
    func fetchSessionHistory(identifier: String, page: Int, limit: Int) async throws -> SessionHistoryResponseDTO
    func cloneSession(sessionId: Int, identifier: String) async throws -> ConsoleSessionDTO
    func fetchCategories(identifier: String) async throws -> [Category]
    func fetchPricingSettings(channelId: Int) async throws -> PricingSettingsDTO
}

@MainActor final class AppClientConsoleRepository: ConsoleRepository {
    private let client: ChannelAPIClient
    init(client: ChannelAPIClient = .shared) { self.client = client }

    func fetchChannelDetail(identifier: String) async throws -> ChannelDTO {
        try await client.request(
            endpoint: .channelDetail(identifier: identifier),
            responseType: ChannelDTO.self
        )
    }

    func fetchActiveSession(identifier: String) async throws -> ConsoleSessionDTO? {
        try await client.requestOptional(
            endpoint: .activeSession(identifier: identifier),
            responseType: ConsoleSessionDTO.self
        )
    }

    func startSession(payload: StartSessionPayload) async throws -> ConsoleSessionDTO {
        try await client.request(
            endpoint: .startSession(payload: payload),
            responseType: ConsoleSessionDTO.self
        )
    }

    func endSession(sessionId: Int) async throws {
        try await client.requestWithoutResponse(endpoint: .endSession(sessionId: sessionId))
    }

    func fetchQueue(sessionId: Int, includeCompleted: Bool) async throws -> ConsoleQueueResponseDTO {
        try await client.request(
            endpoint: .consoleQueue(sessionId: sessionId, includeCompleted: includeCompleted),
            responseType: ConsoleQueueResponseDTO.self
        )
    }

    func fetchNowPlaying(sessionId: Int) async throws -> ConsoleSongRequestDTO? {
        try await client.requestOptional(
            endpoint: .nowPlaying(sessionId: sessionId),
            responseType: ConsoleSongRequestDTO.self
        )
    }

    func playNow(requestId: Int) async throws -> ConsoleSongRequestDTO {
        try await client.request(
            endpoint: .playNow(requestId: requestId),
            responseType: ConsoleSongRequestDTO.self
        )
    }

    func playNext(sessionId: Int) async throws -> ConsoleSongRequestDTO? {
        try await client.requestOptional(
            endpoint: .playNext(sessionId: sessionId),
            responseType: ConsoleSongRequestDTO.self
        )
    }

    func skipCurrent(sessionId: Int, reason: String?) async throws -> ConsoleSongRequestDTO? {
        try await client.requestOptional(
            endpoint: .skipCurrent(sessionId: sessionId, reason: reason),
            responseType: ConsoleSongRequestDTO.self
        )
    }

    func deleteRequest(requestId: Int) async throws {
        try await client.requestWithoutResponse(endpoint: .deleteRequest(requestId: requestId))
    }

    func updateRequestOrder(requestId: Int, newOrder: Int) async throws {
        try await client.requestWithoutResponse(
            endpoint: .updateRequestOrder(requestId: requestId, newOrder: newOrder)
        )
    }

    func clearQueue(sessionId: Int) async throws -> ClearQueueResponse {
        try await client.request(
            endpoint: .clearQueue(sessionId: sessionId),
            responseType: ClearQueueResponse.self
        )
    }

    func createManualRequest(sessionId: Int, payload: CreateManualRequestPayload) async throws -> ConsoleSongRequestDTO {
        try await client.request(
            endpoint: .createManualRequest(sessionId: sessionId, payload: payload),
            responseType: ConsoleSongRequestDTO.self
        )
    }

    func updateSessionSettings(sessionId: Int, payload: UpdateSettingsPayload) async throws -> ConsoleSessionSettingsDTO {
        try await client.request(
            endpoint: .updateSessionSettings(sessionId: sessionId, payload: payload),
            responseType: ConsoleSessionSettingsDTO.self
        )
    }

    func updatePricingSettings(channelId: Int, payload: UpdatePricingSettingsPayload) async throws -> PricingSettingsDTO {
        try await client.request(
            endpoint: .updatePricingSettings(channelId: channelId, payload: payload),
            responseType: PricingSettingsDTO.self
        )
    }

    func fetchSessionHistory(identifier: String, page: Int, limit: Int) async throws -> SessionHistoryResponseDTO {
        try await client.request(
            endpoint: .sessionHistory(identifier: identifier, page: page, limit: limit),
            responseType: SessionHistoryResponseDTO.self
        )
    }

    func cloneSession(sessionId: Int, identifier: String) async throws -> ConsoleSessionDTO {
        try await client.request(
            endpoint: .cloneSession(sessionId: sessionId, identifier: identifier),
            responseType: ConsoleSessionDTO.self
        )
    }

    func fetchCategories(identifier: String) async throws -> [Category] {
        try await client.request(
            endpoint: .channelCategories(identifier: identifier),
            responseType: [Category].self
        )
    }

    func fetchPricingSettings(channelId: Int) async throws -> PricingSettingsDTO {
        try await client.request(
            endpoint: .getPricingSettings(channelId: channelId),
            responseType: PricingSettingsDTO.self
        )
    }
}
