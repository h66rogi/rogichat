import Foundation

struct Channel: Identifiable, Equatable {
    let id: Int
    let name: String
    let webPath: String
    let platformUrl: String?
    let profileImageUrl: String?
    let themeColor: String
    let channelDescription: String?
    let additionalLinks: [ChannelLink]
    let songCount: Int
    let artistCount: Int
    let categoryCount: Int
    let favoritesCount: Int
    let verifications: [ChannelVerificationSummary]
    let isOwnerProSubscriber: Bool
    let voiceCommissionActive: Bool
    let createdAt: Date
    let updatedAt: Date
}

struct ChannelLink: Codable, Equatable {
    let name: String
    let url: String
}

struct ChannelVerificationSummary: Codable, Equatable, Identifiable {
    let platform: String

    var id: String { platform }
    var isApproved: Bool { true } // API only returns approved verifications
}

struct ChannelSummary: Identifiable, Equatable {
    let id: Int
    let name: String
    let webPath: String
    let profileImageUrl: String?
    let themeColor: String
}

// MARK: - My Channel (채널 소유/관리 정보)
struct MyChannel: Identifiable, Equatable {
    let id: Int
    let name: String
    let webPath: String
    let profileImageUrl: String?
    let themeColor: String
    let isOwner: Bool
}

struct MyChannelDTO: Decodable {
    let id: Int
    let name: String
    let webPath: String
    let platformUrl: String?
    let profileImageUrl: String?
    let topBannerUrl: String?
    let leftBannerUrl: String?
    let rightBannerUrl: String?
    let additionalLinks: [ChannelLink]?
    let themeColor: String?
    let channelDescription: String?
    let createdAt: String?
    let updatedAt: String?
    let _count: ChannelCountDTO?
    let isOwner: Bool

    struct ChannelCountDTO: Decodable {
        let songs: Int?
        let artists: Int?
        let categories: Int?
    }

    func toDomain() -> MyChannel {
        MyChannel(
            id: id,
            name: name,
            webPath: webPath,
            profileImageUrl: profileImageUrl,
            themeColor: themeColor ?? "#6366f1",
            isOwner: isOwner
        )
    }
}

// MARK: - Channel DTO
struct ChannelDTO: Decodable {
    let visibility: String?
    let id: Int
    let name: String
    let webPath: String
    let platformUrl: String?
    let profileImageUrl: String?
    let topBannerUrl: String?
    let leftBannerUrl: String?
    let rightBannerUrl: String?
    let additionalLinks: [ChannelLink]?
    let themeColor: String?
    let channelDescription: String?
    let verifications: [ChannelVerificationSummary]?
    let isOwnerProSubscriber: Bool?
    let voiceCommissionActive: Bool?
    let createdAt: String?
    let updatedAt: String?
    let _count: ChannelCountDTO?
    /// 최신 인기 목록 API는 집계된 즐겨찾기 수를 `_count` 밖에 내려줍니다.
    let favoritesCount: Int?
    let popularityScore: Double?

    struct ChannelCountDTO: Decodable {
        let songs: Int?
        let artists: Int?
        let categories: Int?
        let userFavorites: Int?
    }

    /// `favoriteCountFromPopularityScore`는 즐겨찾기 가중치만 1로 요청한
    /// 채널 목록에서만 사용합니다. 그 요청의 popularityScore는 즐겨찾기 수와 같습니다.
    func toDomain(favoriteCountFromPopularityScore: Bool = false) -> Channel {
        let dateFormatter = ISO8601DateFormatter()
        dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let effectiveFavoritesCount: Int
        if let favoritesCount {
            effectiveFavoritesCount = favoritesCount
        } else if favoriteCountFromPopularityScore, let popularityScore {
            effectiveFavoritesCount = Int(popularityScore.rounded())
        } else {
            effectiveFavoritesCount = _count?.userFavorites ?? 0
        }

        return Channel(
            id: id,
            name: name,
            webPath: webPath,
            platformUrl: platformUrl,
            profileImageUrl: profileImageUrl,
            themeColor: themeColor ?? "#6366f1",
            channelDescription: channelDescription,
            additionalLinks: additionalLinks ?? [],
            songCount: _count?.songs ?? 0,
            artistCount: _count?.artists ?? 0,
            categoryCount: _count?.categories ?? 0,
            favoritesCount: effectiveFavoritesCount,
            verifications: verifications ?? [],
            isOwnerProSubscriber: isOwnerProSubscriber ?? false,
            voiceCommissionActive: voiceCommissionActive ?? false,
            createdAt: createdAt.flatMap { dateFormatter.date(from: $0) } ?? Date(),
            updatedAt: updatedAt.flatMap { dateFormatter.date(from: $0) } ?? Date()
        )
    }

}

// MARK: - Favorite Channel Response
struct FavoriteChannelDTO: Decodable {
    let id: Int
    let channelId: Int
    let channelName: String
    let profileImageUrl: String?
    let webPath: String
    let themeColor: String
    let ownerNickname: String
    let channelDescription: String?
    let createdAt: String
    let songCount: Int?
    let artistCount: Int?
    let favoritesCount: Int?

    func toChannel() -> Channel {
        let dateFormatter = ISO8601DateFormatter()
        dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let createdDate = dateFormatter.date(from: createdAt) ?? Date()

        return Channel(
            id: channelId,
            name: channelName,
            webPath: webPath,
            platformUrl: nil,
            profileImageUrl: profileImageUrl,
            themeColor: themeColor,
            channelDescription: nil,
            additionalLinks: [],
            songCount: songCount ?? 0,
            artistCount: artistCount ?? 0,
            categoryCount: 0,
            favoritesCount: favoritesCount ?? 0,
            verifications: [],
            isOwnerProSubscriber: false,
            voiceCommissionActive: false,
            createdAt: createdDate,
            updatedAt: createdDate
        )
    }
}

struct FavoriteChannelsResponse: Decodable {
    let items: [FavoriteChannelDTO]
    let total: Int
    let page: Int
    let limit: Int
    let totalPages: Int

    enum CodingKeys: String, CodingKey {
        case items = "favorites"
        case total
        case page
        case limit
        case totalPages
    }
}

// MARK: - Channel Profile
struct ChannelProfile: Decodable {
    let channelId: Int
    let birthday: String?
    let residence: String?
    let heightCm: String?
    let weightKg: String?
    let nationality: String?
    let gender: String?
    let symbolColor: String?
    let agency: String?
    let affiliatedGroups: [String]?
    let fandomName: String?
    let religion: String?
    let nickname: String?
    let description: String?
    let homeDescription: String?
    let education: [String]?
    let mbti: String?
    let alias: [String]?
    let debutDate: String?
    let broadcastingPlatforms: [String]?
    let bio: String?
    let links: [ProfileLink]?
    let updatedAt: String?
    let anniversaries: ProfileAnniversaries?

    struct ProfileLink: Decodable {
        let label: String?
        let url: String
        let icon: String?
    }

    struct ProfileAnniversaries: Decodable {
        let milestones: ProfileMilestones?
        let birthday: ProfileBirthday?
        let nextUpcomingEvent: ProfileUpcomingEvent?
    }

    struct ProfileMilestones: Decodable {
        let daysPassed: Int
        let nextMilestone: String
        let daysToMilestone: Int
    }

    struct ProfileBirthday: Decodable {
        let daysUntilBirthday: Int
        let birthdayDate: String
    }

    struct ProfileUpcomingEvent: Decodable {
        let type: String
        let label: String
        let daysUntil: Int
    }

    // 성별을 한글로 변환
    var genderDisplayName: String? {
        guard let gender = gender else { return nil }
        switch gender {
        case "MALE": return "남성"
        case "FEMALE": return "여성"
        case "NONBINARY": return "논바이너리"
        case "OTHER": return "기타"
        case "SECRET": return "비공개"
        default: return gender
        }
    }

    // 생일을 표시 형식으로 변환
    var birthdayDisplayName: String? {
        guard let birthday = birthday else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        guard let date = formatter.date(from: birthday) else { return birthday }

        let displayFormatter = DateFormatter()
        displayFormatter.locale = Locale(identifier: "ko_KR")

        let calendar = Calendar.current
        let year = calendar.component(.year, from: date)

        if year == 1900 {
            displayFormatter.dateFormat = "M월 d일"
        } else {
            displayFormatter.dateFormat = "yyyy년 M월 d일"
        }

        return displayFormatter.string(from: date)
    }

    // 데뷔일을 표시 형식으로 변환
    var debutDateDisplayName: String? {
        guard let debutDate = debutDate else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: debutDate) else { return debutDate }

        let displayFormatter = DateFormatter()
        displayFormatter.locale = Locale(identifier: "ko_KR")
        displayFormatter.dateFormat = "yyyy년 M월 d일"

        return displayFormatter.string(from: date)
    }
}
