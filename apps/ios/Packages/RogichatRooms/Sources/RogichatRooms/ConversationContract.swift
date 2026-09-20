import Foundation

// Contract-specific message models. Chat UX/Talk source is deliberately not reused.
public enum ConversationError: Error, Equatable, LocalizedError, Sendable {
    case invalidResponse, staleScope, persistence, unavailable, forbidden, notFound, conflict, membershipChanged, invalidText, busy
    public var errorDescription: String? {
        switch self {
        case .invalidResponse: "대화 내용을 확인하지 못했어요. 다시 불러와 주세요."
        case .staleScope, .membershipChanged: "참여 상태가 변경됐어요. 대화방을 다시 열어 주세요."
        case .persistence: "이 기기에 메시지를 저장하지 못했어요. 잠금과 저장 공간을 확인해 주세요."
        case .unavailable: "대화에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요."
        case .forbidden: "현재 이 대화에 접근하거나 메시지를 보낼 수 없어요."
        case .notFound: "요청한 내용을 확인하지 못했어요."
        case .conflict: "메시지 요청이 현재 상태와 맞지 않아요."
        case .invalidText: "공백이 아닌 내용을 4,000자 이내로 입력해 주세요."
        case .busy: "앞선 메시지 요청을 확인하고 있어요."
        }
    }
}
public struct MessageVersion: Codable, Equatable, Comparable, Sendable {
    public let rawValue: String
    public init(_ value: String) throws {
        guard !value.isEmpty, value.first != "0", value.utf8.allSatisfy({ (48...57).contains($0) }), UInt64(value) != nil else { throw ConversationError.invalidResponse }
        rawValue = value
    }
    public init(from decoder: any Decoder) throws { try self.init(decoder.singleValueContainer().decode(String.self)) }
    public func encode(to encoder: any Encoder) throws { var c = encoder.singleValueContainer(); try c.encode(rawValue) }
    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue.count == rhs.rawValue.count ? lhs.rawValue < rhs.rawValue : lhs.rawValue.count < rhs.rawValue.count }
}
public enum ConversationWire {
    public static func timestamp(_ value: String) -> Bool {
        guard value.utf8.count == 24, value.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$", options: .regularExpression) != nil else { return false }
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = f.date(from: value) else { return false }
        return f.string(from: date) == value
    }
    public static func normalizedText(_ value: String) throws -> String {
        let value = value.precomposedStringWithCanonicalMapping
        // ECMAScript trim set, shared with the server's nonblank test. Never trim the sent text.
        let trim = CharacterSet(charactersIn: "\u{0009}\u{000A}\u{000B}\u{000C}\u{000D}\u{0020}\u{00A0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}")
        guard !value.trimmingCharacters(in: trim).isEmpty, value.unicodeScalars.count <= 4000, value.utf8.count <= 16384, !value.contains("\0") else { throw ConversationError.invalidText }
        return value
    }
}
public struct ConversationAvatar: Codable, Equatable, Sendable {
    public let assetId: String
    enum CodingKeys: CodingKey { case assetId }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self); assetId = try c.decode(String.self, forKey: .assetId)
        guard RoomsWire.uuid(assetId) else { throw ConversationError.invalidResponse }
    }
}
public enum MessageAuthor: Codable, Equatable, Sendable {
    case anonymous
    case member(actorId: String, nickname: String, avatar: ConversationAvatar?)
    enum CodingKeys: String, CodingKey, Hashable { case kind, actorId, nickname, avatar }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "anonymous":
            guard Set(c.allKeys) == [.kind] else { throw ConversationError.invalidResponse }; self = .anonymous
        case "member":
            let id = try c.decode(String.self, forKey: .actorId); let name = try c.decode(String.self, forKey: .nickname)
            guard RoomsWire.uuid(id), !name.isEmpty, c.contains(.avatar) else { throw ConversationError.invalidResponse }
            self = .member(actorId: id, nickname: name, avatar: try c.decodeIfPresent(ConversationAvatar.self, forKey: .avatar))
        default: throw ConversationError.invalidResponse
        }
    }
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .anonymous: try c.encode("anonymous", forKey: .kind)
        case .member(let id, let name, let avatar):
            try c.encode("member", forKey: .kind); try c.encode(id, forKey: .actorId); try c.encode(name, forKey: .nickname); try c.encode(avatar, forKey: .avatar)
        }
    }
    public var actorID: String? { if case .member(let id, _, _) = self { id } else { nil } }
    public var displayName: String { if case .member(_, let name, _) = self { name } else { "익명" } }
}
public struct MessageAttachment: Codable, Equatable, Sendable {
    public let assetId: String
    public let width: Int
    public let height: Int
    public let variant: String
    enum CodingKeys: CodingKey { case assetId, width, height, variant }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        assetId = try c.decode(String.self, forKey: .assetId); width = try c.decode(Int.self, forKey: .width); height = try c.decode(Int.self, forKey: .height); variant = try c.decode(String.self, forKey: .variant)
        guard RoomsWire.uuid(assetId), width > 0, height > 0, !variant.isEmpty else { throw ConversationError.invalidResponse }
    }
}
public enum MessageContent: Codable, Equatable, Sendable {
    case text(String?), photo([MessageAttachment]), video([MessageAttachment])
    case sticker(stickerId: String, assetId: String, width: Int, height: Int)
    enum CodingKeys: String, CodingKey, Hashable { case type, text, attachments, stickerId, assetId, width, height }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .type) {
        case "TEXT":
            guard Set(c.allKeys) == [.type, .text] else { throw ConversationError.invalidResponse }
            self = .text(try c.decodeIfPresent(String.self, forKey: .text))
        case "PHOTO", "VIDEO":
            guard Set(c.allKeys) == [.type, .attachments] else { throw ConversationError.invalidResponse }
            let items = try c.decode([MessageAttachment].self, forKey: .attachments); let video = try c.decode(String.self, forKey: .type) == "VIDEO"
            guard !items.isEmpty, items.count <= (video ? 1 : 4), Set(items.map(\.assetId)).count == items.count else { throw ConversationError.invalidResponse }
            self = video ? .video(items) : .photo(items)
        case "STICKER":
            guard Set(c.allKeys) == [.type, .stickerId, .assetId, .width, .height] else { throw ConversationError.invalidResponse }
            let sticker = try c.decode(String.self, forKey: .stickerId); let asset = try c.decode(String.self, forKey: .assetId); let width = try c.decode(Int.self, forKey: .width); let height = try c.decode(Int.self, forKey: .height)
            guard RoomsWire.uuid(sticker), RoomsWire.uuid(asset), width > 0, height > 0 else { throw ConversationError.invalidResponse }
            self = .sticker(stickerId: sticker, assetId: asset, width: width, height: height)
        default: throw ConversationError.invalidResponse
        }
    }
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .text(let text): try c.encode("TEXT", forKey: .type); try c.encode(text, forKey: .text)
        case .photo(let items): try c.encode("PHOTO", forKey: .type); try c.encode(items, forKey: .attachments)
        case .video(let items): try c.encode("VIDEO", forKey: .type); try c.encode(items, forKey: .attachments)
        case .sticker(let id, let asset, let width, let height): try c.encode("STICKER", forKey: .type); try c.encode(id, forKey: .stickerId); try c.encode(asset, forKey: .assetId); try c.encode(width, forKey: .width); try c.encode(height, forKey: .height)
        }
    }
}
public struct MessageQuote: Codable, Equatable, Sendable {
    public let id: String
    public let content: MessageContent
    enum CodingKeys: CodingKey { case id, content }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self); id = try c.decode(String.self, forKey: .id); content = try c.decode(MessageContent.self, forKey: .content)
        guard RoomsWire.uuid(id), case .text(.some) = content else { throw ConversationError.invalidResponse }
    }
}
public struct MessageActions: Codable, Equatable, Sendable { public let reply: Bool; public let publish: Bool; public let delete: Bool }
public struct MessageCounterpart: Codable, Equatable, Sendable {
    public let actorId: String
    enum CodingKeys: CodingKey { case actorId }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self); actorId = try c.decode(String.self, forKey: .actorId)
        guard RoomsWire.uuid(actorId) else { throw ConversationError.invalidResponse }
    }
}
public struct ConversationMessage: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let version: MessageVersion
    public let createdAt: String
    public let audience: String
    public let author: MessageAuthor
    public let content: MessageContent
    public let quote: MessageQuote?
    public let counterpart: MessageCounterpart?
    public let allowedActions: MessageActions
    enum CodingKeys: CodingKey { case id, version, createdAt, audience, author, content, quote, counterpart, allowedActions }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id); version = try c.decode(MessageVersion.self, forKey: .version); createdAt = try c.decode(String.self, forKey: .createdAt)
        audience = try c.decode(String.self, forKey: .audience); author = try c.decode(MessageAuthor.self, forKey: .author); content = try c.decode(MessageContent.self, forKey: .content)
        guard RoomsWire.uuid(id), ConversationWire.timestamp(createdAt), ["SHARED", "PRIVATE"].contains(audience), c.contains(.quote), c.contains(.counterpart) else { throw ConversationError.invalidResponse }
        quote = try c.decodeIfPresent(MessageQuote.self, forKey: .quote); counterpart = try c.decodeIfPresent(MessageCounterpart.self, forKey: .counterpart); allowedActions = try c.decode(MessageActions.self, forKey: .allowedActions)
        if audience == "SHARED", counterpart != nil { throw ConversationError.invalidResponse }
        if case .anonymous = author, counterpart != nil || allowedActions.reply { throw ConversationError.invalidResponse }
    }
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id); try c.encode(version, forKey: .version); try c.encode(createdAt, forKey: .createdAt)
        try c.encode(audience, forKey: .audience); try c.encode(author, forKey: .author); try c.encode(content, forKey: .content)
        try c.encode(quote, forKey: .quote); try c.encode(counterpart, forKey: .counterpart); try c.encode(allowedActions, forKey: .allowedActions)
    }
    public var replyRecipient: String? {
        guard allowedActions.reply else { return nil }
        return audience == "PRIVATE" ? counterpart?.actorId : author.actorID
    }
    public static func displayBefore(_ a: Self, _ b: Self) -> Bool { a.createdAt == b.createdAt ? a.id < b.id : a.createdAt < b.createdAt }
}
