import Foundation

// MARK: - Domain Model (콘솔용 전체 필드)

struct ConsoleSongRequest: Identifiable {
    let id: Int
    let liveSessionId: Int
    let songId: Int?
    let rawArtist: String
    let rawTitle: String
    let rawMessage: String?
    let requesterPlatformId: String
    let requesterNickname: String
    let status: String
    let source: String
    let donationAmount: Int?
    let donationNativeAmount: Int?
    let donationCurrency: String?
    let priority: Int
    let queueOrder: Int
    let playedAt: String?
    let completedAt: String?
    let rejectionReason: String?
    let createdAt: String
    let updatedAt: String
    let song: ConsoleSongInfo?
    let calculatedPrice: Int?
    let priceSource: String?
    let formattedPrice: String?

    var displayTitle: String { song?.title ?? rawTitle }
    var displayArtist: String { song?.artist?.name ?? rawArtist }
    var albumArt: String? { song?.albumArt }

    var isCompleted: Bool { status == "COMPLETED" }
    var isRejected: Bool { status == "REJECTED" }
    var isPending: Bool { status == "PENDING" }
    var isPlaying: Bool { status == "PLAYING" }
    var isDonation: Bool { source == "DONATION" }

    var statusLabel: String {
        switch status {
        case "PENDING": return "대기"
        case "ACCEPTED": return "수락"
        case "PLAYING": return "재생 중"
        case "COMPLETED": return "완료"
        case "REJECTED": return "거절"
        default: return status
        }
    }
}

struct ConsoleSongInfo {
    let id: Int
    let title: String
    let albumArt: String?
    let karaokeUrl: String?
    let coverUrl: String?
    let originalUrl: String?
    let difficulty: Int?
    let songKey: String?
    let bpm: Int?
    let artist: ConsoleSongArtist?
}

struct ConsoleSongArtist {
    let id: Int
    let name: String
}

// MARK: - DTOs

struct ConsoleSongRequestDTO: Decodable {
    let id: Int
    let liveSessionId: Int
    let songId: Int?
    let rawArtist: String
    let rawTitle: String
    let rawMessage: String?
    let requesterPlatformId: String?
    let requesterNickname: String?
    let status: String
    let source: String?
    let donationAmount: Int?
    let donationNativeAmount: Int?
    let donationCurrency: String?
    let priority: Int?
    let queueOrder: Int?
    let playedAt: String?
    let completedAt: String?
    let rejectionReason: String?
    let createdAt: String?
    let updatedAt: String?
    let song: ConsoleSongInfoDTO?
    let calculatedPrice: Int?
    let priceSource: String?
    let formattedPrice: String?

    func toDomain() -> ConsoleSongRequest {
        ConsoleSongRequest(
            id: id,
            liveSessionId: liveSessionId,
            songId: songId,
            rawArtist: rawArtist,
            rawTitle: rawTitle,
            rawMessage: rawMessage,
            requesterPlatformId: requesterPlatformId ?? "",
            requesterNickname: requesterNickname ?? "",
            status: status,
            source: source ?? "CHAT",
            donationAmount: donationAmount,
            donationNativeAmount: donationNativeAmount,
            donationCurrency: donationCurrency,
            priority: priority ?? 0,
            queueOrder: queueOrder ?? 0,
            playedAt: playedAt,
            completedAt: completedAt,
            rejectionReason: rejectionReason,
            createdAt: createdAt ?? "",
            updatedAt: updatedAt ?? "",
            song: song?.toDomain(),
            calculatedPrice: calculatedPrice,
            priceSource: priceSource,
            formattedPrice: formattedPrice
        )
    }
}

struct ConsoleSongInfoDTO: Decodable {
    let id: Int
    let title: String
    let albumArt: String?
    let karaokeUrl: String?
    let coverUrl: String?
    let originalUrl: String?
    let difficulty: Int?
    let songKey: String?
    let bpm: Int?
    let artist: ConsoleSongArtistDTO?

    func toDomain() -> ConsoleSongInfo {
        ConsoleSongInfo(
            id: id,
            title: title,
            albumArt: albumArt,
            karaokeUrl: karaokeUrl,
            coverUrl: coverUrl,
            originalUrl: originalUrl,
            difficulty: difficulty,
            songKey: songKey,
            bpm: bpm,
            artist: artist?.toDomain()
        )
    }
}

struct ConsoleSongArtistDTO: Decodable {
    let id: Int
    let name: String

    func toDomain() -> ConsoleSongArtist {
        ConsoleSongArtist(id: id, name: name)
    }
}

struct ConsoleQueueResponseDTO: Decodable {
    let requests: [ConsoleSongRequestDTO]
    let total: Int
}

// MARK: - Request Payloads

struct CreateManualRequestPayload: Encodable {
    let rawArtist: String
    let rawTitle: String
    let songId: Int?
    let rawMessage: String?
}

struct UpdateSongRequestStatusPayload: Encodable {
    let status: String
    let rejectionReason: String?

    init(status: String, rejectionReason: String? = nil) {
        self.status = status
        self.rejectionReason = rejectionReason
    }
}

struct ClearQueueResponse: Decodable {
    let deletedCount: Int
    let message: String
}
