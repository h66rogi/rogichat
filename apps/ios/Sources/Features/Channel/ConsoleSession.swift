import Foundation

// MARK: - Domain Models

struct ConsoleSession {
    let id: Int
    let channelId: Int
    let userId: Int
    let platform: String
    let platformChannelId: String?
    let status: String
    let overlayToken: String
    let startedAt: String
    let endedAt: String?
    let createdAt: String
    let updatedAt: String
    let settings: ConsoleSessionSettings?

    var isActive: Bool { status == "ACTIVE" }
}

struct ConsoleSessionSettings {
    let id: Int
    var requestEnabled: Bool
    var chatRequestEnabled: Bool
    var donationRequestEnabled: Bool
    var paused: Bool
    var requestCommand: String
    var maxQueueSize: Int
    var donationPriorityEnabled: Bool
    var requireSongMatch: Bool
    var preventDuplicateSongs: Bool
    var maxRequestsPerUser: Int
    var maxTotalRequests: Int
    var blockedCategoryIds: [Int]
    var karaokePlaybackMode: String
    var karaokeVideoType: String
    var showRequesterName: Bool
}

// MARK: - DTOs

struct ConsoleSessionDTO: Decodable {
    let id: Int
    let channelId: Int
    let userId: Int
    let platform: String
    let platformChannelId: String?
    let status: String
    let overlayToken: String
    let startedAt: String
    let endedAt: String?
    let createdAt: String
    let updatedAt: String
    let settings: ConsoleSessionSettingsDTO?

    func toDomain() -> ConsoleSession {
        ConsoleSession(
            id: id,
            channelId: channelId,
            userId: userId,
            platform: platform,
            platformChannelId: platformChannelId,
            status: status,
            overlayToken: overlayToken,
            startedAt: startedAt,
            endedAt: endedAt,
            createdAt: createdAt,
            updatedAt: updatedAt,
            settings: settings?.toDomain()
        )
    }
}

struct ConsoleSessionSettingsDTO: Decodable {
    let id: Int?
    let requestEnabled: Bool?
    let chatRequestEnabled: Bool?
    let donationRequestEnabled: Bool?
    let paused: Bool?
    let requestCommand: String?
    let maxQueueSize: Int?
    let donationPriorityEnabled: Bool?
    let requireSongMatch: Bool?
    let preventDuplicateSongs: Bool?
    let maxRequestsPerUser: Int?
    let maxTotalRequests: Int?
    let blockedCategoryIds: [Int]?
    let karaokePlaybackMode: String?
    let karaokeVideoType: String?
    let showRequesterName: Bool?

    func toDomain() -> ConsoleSessionSettings {
        ConsoleSessionSettings(
            id: id ?? 0,
            requestEnabled: requestEnabled ?? true,
            chatRequestEnabled: chatRequestEnabled ?? false,
            donationRequestEnabled: donationRequestEnabled ?? false,
            paused: paused ?? false,
            requestCommand: requestCommand ?? "!신청",
            maxQueueSize: maxQueueSize ?? 50,
            donationPriorityEnabled: donationPriorityEnabled ?? false,
            requireSongMatch: requireSongMatch ?? true,
            preventDuplicateSongs: preventDuplicateSongs ?? false,
            maxRequestsPerUser: maxRequestsPerUser ?? 0,
            maxTotalRequests: maxTotalRequests ?? 50,
            blockedCategoryIds: blockedCategoryIds ?? [],
            karaokePlaybackMode: karaokePlaybackMode ?? "YOUTUBE",
            karaokeVideoType: karaokeVideoType ?? "KARAOKE",
            showRequesterName: showRequesterName ?? true
        )
    }
}

// MARK: - Request Payloads

struct StartSessionPayload: Encodable {
    let platform: String
    let platformChannelId: String?
}

struct UpdateSettingsPayload: Encodable {
    let requestEnabled: Bool?
    let chatRequestEnabled: Bool?
    let donationRequestEnabled: Bool?
    let paused: Bool?
    let requestCommand: String?
    let maxQueueSize: Int?
    let donationPriorityEnabled: Bool?
    let requireSongMatch: Bool?
    let preventDuplicateSongs: Bool?
    let maxRequestsPerUser: Int?
    let maxTotalRequests: Int?
    let blockedCategoryIds: [Int]?
    let karaokePlaybackMode: String?
    let karaokeVideoType: String?
    let showRequesterName: Bool?

    init(
        requestEnabled: Bool? = nil,
        chatRequestEnabled: Bool? = nil,
        donationRequestEnabled: Bool? = nil,
        paused: Bool? = nil,
        requestCommand: String? = nil,
        maxQueueSize: Int? = nil,
        donationPriorityEnabled: Bool? = nil,
        requireSongMatch: Bool? = nil,
        preventDuplicateSongs: Bool? = nil,
        maxRequestsPerUser: Int? = nil,
        maxTotalRequests: Int? = nil,
        blockedCategoryIds: [Int]? = nil,
        karaokePlaybackMode: String? = nil,
        karaokeVideoType: String? = nil,
        showRequesterName: Bool? = nil
    ) {
        self.requestEnabled = requestEnabled
        self.chatRequestEnabled = chatRequestEnabled
        self.donationRequestEnabled = donationRequestEnabled
        self.paused = paused
        self.requestCommand = requestCommand
        self.maxQueueSize = maxQueueSize
        self.donationPriorityEnabled = donationPriorityEnabled
        self.requireSongMatch = requireSongMatch
        self.preventDuplicateSongs = preventDuplicateSongs
        self.maxRequestsPerUser = maxRequestsPerUser
        self.maxTotalRequests = maxTotalRequests
        self.blockedCategoryIds = blockedCategoryIds
        self.karaokePlaybackMode = karaokePlaybackMode
        self.karaokeVideoType = karaokeVideoType
        self.showRequesterName = showRequesterName
    }
}

// MARK: - Session History

struct SessionHistoryItem: Identifiable {
    let id: Int
    let platform: String
    let status: String
    let startedAt: String
    let endedAt: String?
    let duration: Int?
    let stats: SessionStats
}

struct SessionStats {
    let totalRequests: Int
    let completedCount: Int
    let rejectedCount: Int
    let totalDonation: Int
}

struct SessionHistoryResponse {
    let sessions: [SessionHistoryItem]
    let pagination: SessionPagination
}

struct SessionPagination {
    let page: Int
    let limit: Int
    let total: Int
    let totalPages: Int
}

// MARK: - Session History DTOs

struct SessionHistoryItemDTO: Decodable {
    let id: Int
    let platform: String
    let status: String
    let startedAt: String
    let endedAt: String?
    let duration: Int?
    let stats: SessionStatsDTO?

    func toDomain() -> SessionHistoryItem {
        SessionHistoryItem(
            id: id,
            platform: platform,
            status: status,
            startedAt: startedAt,
            endedAt: endedAt,
            duration: duration,
            stats: stats?.toDomain() ?? SessionStats(totalRequests: 0, completedCount: 0, rejectedCount: 0, totalDonation: 0)
        )
    }
}

struct SessionStatsDTO: Decodable {
    let totalRequests: Int?
    let completedCount: Int?
    let rejectedCount: Int?
    let totalDonation: Int?

    func toDomain() -> SessionStats {
        SessionStats(
            totalRequests: totalRequests ?? 0,
            completedCount: completedCount ?? 0,
            rejectedCount: rejectedCount ?? 0,
            totalDonation: totalDonation ?? 0
        )
    }
}

struct SessionHistoryResponseDTO: Decodable {
    let sessions: [SessionHistoryItemDTO]
    let pagination: SessionPaginationDTO

    func toDomain() -> SessionHistoryResponse {
        SessionHistoryResponse(
            sessions: sessions.map { $0.toDomain() },
            pagination: pagination.toDomain()
        )
    }
}

struct SessionPaginationDTO: Decodable {
    let page: Int
    let limit: Int
    let total: Int
    let totalPages: Int

    func toDomain() -> SessionPagination {
        SessionPagination(page: page, limit: limit, total: total, totalPages: totalPages)
    }
}
