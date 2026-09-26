import Foundation

struct Schedule: Identifiable, Equatable {
    let id: Int
    let title: String
    let description: String?
    let scheduleType: ScheduleType
    let startAt: Date
    let endAt: Date?
    let allDay: Bool
    let isCanceled: Bool
    let isPublic: Bool
    let location: String?
    let externalUrl: String?
    let channel: ChannelSummary?
    let createdAt: Date
}

enum ScheduleType: String, Codable {
    case live = "LIVE"
    case collab = "COLLAB"
    case off = "OFF"
    case etc = "ETC"
    case tbd = "TBD"

    var displayName: String {
        switch self {
        case .live: return "방송시작"
        case .collab: return "합방"
        case .off: return "휴방"
        case .etc: return "기타"
        case .tbd: return "미정"
        }
    }

    var iconName: String {
        switch self {
        case .live: return "tv"
        case .collab: return "person.2.fill"
        case .off: return "moon.zzz.fill"
        case .etc: return "calendar"
        case .tbd: return "questionmark.circle"
        }
    }
}

// MARK: - Schedule DTO
struct ScheduleDTO: Decodable {
    let id: Int
    let channelId: Int
    let channelWebPath: String
    let author: ScheduleAuthorDTO
    let channel: ScheduleChannelDTO?
    let title: String
    let content: String?
    let startAt: String
    let endAt: String?
    let allDay: Bool
    let isCanceled: Bool
    let visibility: String
    let status: String
    let location: String?
    let externalUrl: String?
    let createdAt: String
    let updatedAt: String

    // Author type
    struct ScheduleAuthorDTO: Decodable {
        let id: Int
        let nickname: String
        let profileImageUrl: String?
    }

    // Channel type for schedule responses (simpler than full ChannelDTO)
    struct ScheduleChannelDTO: Decodable {
        let id: Int
        let name: String
        let profileImageUrl: String?
        let webPath: String
        let themeColor: String?

        func toSummary() -> ChannelSummary {
            ChannelSummary(
                id: id,
                name: name,
                webPath: webPath,
                profileImageUrl: profileImageUrl,
                themeColor: themeColor ?? "#3B82F6"
            )
        }
    }

    func toDomain() -> Schedule {
        let dateFormatter = ISO8601DateFormatter()
        dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        return Schedule(
            id: id,
            title: title,
            description: content,
            scheduleType: ScheduleType(rawValue: status) ?? .etc,
            startAt: dateFormatter.date(from: startAt) ?? Date(),
            endAt: endAt.flatMap { dateFormatter.date(from: $0) },
            allDay: allDay,
            isCanceled: isCanceled,
            isPublic: visibility.uppercased() == "PUBLIC",
            location: location,
            externalUrl: externalUrl,
            channel: channel?.toSummary(),
            createdAt: dateFormatter.date(from: createdAt) ?? Date()
        )
    }
}

struct SchedulesResponse: Decodable {
    let items: [ScheduleDTO]
    let page: Int
    let limit: Int
    let total: Int
}

// MARK: - Create Schedule Request
struct CreateScheduleRequest: Encodable {
    let title: String
    let content: String?
    let startAt: String
    let endAt: String?
    let allDay: Bool?
    let visibility: String?
    let location: String?
    let externalUrl: String?
    let status: String?

    init(
        title: String,
        content: String? = nil,
        startAt: Date,
        endAt: Date? = nil,
        allDay: Bool? = nil,
        visibility: String? = "PUBLIC",
        location: String? = nil,
        externalUrl: String? = nil,
        status: String? = nil
    ) {
        self.title = title
        self.content = content

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        self.startAt = formatter.string(from: startAt)
        self.endAt = endAt.map { formatter.string(from: $0) }

        self.allDay = allDay
        self.visibility = visibility
        self.location = location
        self.externalUrl = externalUrl
        self.status = status
    }
}

// MARK: - Update Schedule Request
struct UpdateScheduleRequest: Encodable {
    let title: String?
    let content: String?
    let startAt: String?
    let endAt: String?
    let allDay: Bool?
    let visibility: String?
    let location: String?
    let externalUrl: String?
    let status: String?

    enum CodingKeys: String, CodingKey {
        case title, content, startAt, endAt, allDay, visibility, location, externalUrl, status
    }

    init(
        title: String? = nil,
        content: String? = nil,
        startAt: Date? = nil,
        endAt: Date? = nil,
        allDay: Bool? = nil,
        visibility: String? = nil,
        location: String? = nil,
        externalUrl: String? = nil,
        status: String? = nil
    ) {
        self.title = title
        self.content = content
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        self.startAt = startAt.map { formatter.string(from: $0) }
        self.endAt = endAt.map { formatter.string(from: $0) }
        self.allDay = allDay
        self.visibility = visibility
        self.location = location
        self.externalUrl = externalUrl
        self.status = status
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(title, forKey: .title)
        try container.encode(content, forKey: .content)          // always encode, null = clear
        try container.encodeIfPresent(startAt, forKey: .startAt)
        try container.encode(endAt, forKey: .endAt)              // always encode, null = clear
        try container.encodeIfPresent(allDay, forKey: .allDay)
        try container.encodeIfPresent(visibility, forKey: .visibility)
        try container.encode(location, forKey: .location)        // always encode, null = clear
        try container.encode(externalUrl, forKey: .externalUrl)  // always encode, null = clear
        try container.encodeIfPresent(status, forKey: .status)
    }
}
