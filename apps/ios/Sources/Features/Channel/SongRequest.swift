import Foundation

// MARK: - Domain Models

struct LiveSession {
    let sessionId: Int?
    let isLive: Bool
    let settings: LiveSessionSettings?
    let queueCount: Int
}

enum SongRequestMode: String, Decodable {
    case everyone = "EVERYONE"
    case verifiedOnly = "VERIFIED_ONLY"
    case chatOnly = "CHAT_ONLY"
}

struct LiveSessionSettings {
    let requestEnabled: Bool
    let chatRequestEnabled: Bool
    let donationRequestEnabled: Bool
    let paused: Bool
    let maxQueueSize: Int
    let preventDuplicateSongs: Bool
    let blockedCategoryIds: [Int]
    let requestMode: SongRequestMode
}

struct SongRequestPayload: Encodable {
    let liveSessionId: Int
    let songId: Int?
    let rawArtist: String
    let rawTitle: String
    let rawMessage: String?
    let requesterPlatformId: String
    let requesterNickname: String
    let source: String = "MANUAL"
}

// MARK: - DTOs

struct LiveSessionDTO: Decodable {
    let sessionId: Int?
    let isLive: Bool?
    let settings: LiveSessionSettingsDTO?
    let queueCount: Int?

    func toDomain() -> LiveSession {
        LiveSession(
            sessionId: sessionId,
            isLive: isLive ?? false,
            settings: settings?.toDomain(),
            queueCount: queueCount ?? 0
        )
    }
}

struct LiveSessionSettingsDTO: Decodable {
    let requestEnabled: Bool?
    let chatRequestEnabled: Bool?
    let donationRequestEnabled: Bool?
    let paused: Bool?
    let maxQueueSize: Int?
    let preventDuplicateSongs: Bool?
    let blockedCategoryIds: [Int]?
    let requestMode: String?

    func toDomain() -> LiveSessionSettings {
        LiveSessionSettings(
            requestEnabled: requestEnabled ?? false,
            chatRequestEnabled: chatRequestEnabled ?? true,
            donationRequestEnabled: donationRequestEnabled ?? true,
            paused: paused ?? false,
            maxQueueSize: maxQueueSize ?? 0,
            preventDuplicateSongs: preventDuplicateSongs ?? false,
            blockedCategoryIds: blockedCategoryIds ?? [],
            requestMode: SongRequestMode(rawValue: requestMode ?? "EVERYONE") ?? .everyone
        )
    }
}

struct RequestedSongIdsResponse: Decodable {
    let songIds: [Int]
}

struct SongRequestResponse: Decodable {
    let id: Int
    let liveSessionId: Int
    let songId: Int?
    let rawArtist: String
    let rawTitle: String
    let status: String
    let queueOrder: Int?
}

// MARK: - Song Request Queue

struct SongRequestQueueItem: Identifiable {
    let id: Int
    let rawArtist: String
    let rawTitle: String
    let requesterNickname: String
    let status: String
    let queueOrder: Int
    let songTitle: String?
    let songArtistName: String?
    let songAlbumArt: String?

    var displayTitle: String { songTitle ?? rawTitle }
    var displayArtist: String { songArtistName ?? rawArtist }

    var statusLabel: String {
        switch status {
        case "PENDING": return "대기"
        case "ACCEPTED": return "수락"
        case "PLAYING": return "재생"
        default: return status
        }
    }
}

struct SongRequestQueueItemDTO: Decodable {
    let id: Int
    let rawArtist: String
    let rawTitle: String
    let requesterNickname: String
    let status: String
    let queueOrder: Int?
    let song: SongRequestSongDTO?

    func toDomain() -> SongRequestQueueItem {
        SongRequestQueueItem(
            id: id,
            rawArtist: rawArtist,
            rawTitle: rawTitle,
            requesterNickname: requesterNickname,
            status: status,
            queueOrder: queueOrder ?? 0,
            songTitle: song?.title,
            songArtistName: song?.artist?.name,
            songAlbumArt: song?.albumArt
        )
    }
}

struct SongRequestSongDTO: Decodable {
    let id: Int
    let title: String
    let artist: SongRequestArtistDTO?
    let albumArt: String?
}

struct SongRequestArtistDTO: Decodable {
    let id: Int
    let name: String
}

struct SongRequestQueueResponseDTO: Decodable {
    let requests: [SongRequestQueueItemDTO]
    let total: Int
}
