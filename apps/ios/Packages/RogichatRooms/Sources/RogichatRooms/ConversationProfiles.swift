import Foundation

public struct ConversationBirthday: Codable, Equatable, Sendable {
    public let month: Int
    public let day: Int
    enum CodingKeys: CodingKey { case month, day }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self); month = try c.decode(Int.self, forKey: .month); day = try c.decode(Int.self, forKey: .day)
        guard (1...12).contains(month), (1...[31,29,31,30,31,30,31,31,30,31,30,31][month - 1]).contains(day) else { throw ConversationError.invalidResponse }
    }
}
public struct ConversationProfile: Codable, Equatable, Sendable, Identifiable {
    public let actorId: String
    public let nickname: String
    public let avatar: ConversationAvatar?
    public let providerAvatarAvailable: Bool
    public let role: String
    public let birthday: ConversationBirthday?
    public var id: String { actorId }
    enum CodingKeys: CodingKey { case actorId, nickname, avatar, role, birthday, providerAvatarAvailable }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        actorId = try c.decode(String.self, forKey: .actorId); nickname = try c.decode(String.self, forKey: .nickname); avatar = try c.decodeIfPresent(ConversationAvatar.self, forKey: .avatar)
        providerAvatarAvailable = c.contains(.providerAvatarAvailable) ? try c.decode(Bool.self, forKey: .providerAvatarAvailable) : false
        role = try c.decode(String.self, forKey: .role); birthday = try c.decodeIfPresent(ConversationBirthday.self, forKey: .birthday)
        guard RoomsWire.uuid(actorId), !nickname.isEmpty, c.contains(.avatar), ["FAN", "MEMBER", "STREAMER"].contains(role), !c.contains(.birthday) || birthday != nil else { throw ConversationError.invalidResponse }
    }
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(actorId, forKey: .actorId); try c.encode(nickname, forKey: .nickname); try c.encode(avatar, forKey: .avatar); try c.encode(providerAvatarAvailable, forKey: .providerAvatarAvailable); try c.encode(role, forKey: .role); try c.encodeIfPresent(birthday, forKey: .birthday)
    }
}
public struct ConversationProfiles: Decodable, Sendable {
    public let resetRequired: Bool
    public let membershipScope: String?
    public let authorizationRevision: String?
    public let profiles: [ConversationProfile]
    public let generation: String?
    public let complete: Bool
    public let nextCursor: String?
    enum CodingKeys: CodingKey { case schemaVersion, resetRequired, membershipScope, authorizationRevision, profiles, generation, complete, nextCursor }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard try c.decode(Int.self, forKey: .schemaVersion) == 2, c.contains(.membershipScope), c.contains(.authorizationRevision), c.contains(.generation), c.contains(.nextCursor) else { throw ConversationError.invalidResponse }
        resetRequired = try c.decode(Bool.self, forKey: .resetRequired); membershipScope = try c.decodeIfPresent(String.self, forKey: .membershipScope); authorizationRevision = try c.decodeIfPresent(String.self, forKey: .authorizationRevision)
        profiles = try c.decode([ConversationProfile].self, forKey: .profiles); generation = try c.decodeIfPresent(String.self, forKey: .generation); complete = try c.decode(Bool.self, forKey: .complete); nextCursor = try c.decodeIfPresent(String.self, forKey: .nextCursor)
        guard profiles.count <= 100, Set(profiles.map(\.id)).count == profiles.count else { throw ConversationError.invalidResponse }
        if resetRequired {
            guard membershipScope == nil, authorizationRevision == nil, profiles.isEmpty, generation == nil, !complete, nextCursor == nil else { throw ConversationError.invalidResponse }
        } else {
            guard membershipScope.map(RoomsWire.token) == true, authorizationRevision.map(RoomsWire.token) == true, generation.map(RoomsWire.token) == true,
                  complete == (nextCursor == nil), nextCursor.map(RoomsWire.cursor) ?? true, complete || !profiles.isEmpty else { throw ConversationError.invalidResponse }
        }
    }
}
// The dedicated endpoint applies fresh private-send eligibility. Profiles are not candidates.
public struct PrivateRecipient: Codable, Equatable, Identifiable, Sendable {
    public let actorId: String
    public let nickname: String
    public let avatar: ConversationAvatar?
    public var id: String { actorId }
    enum CodingKeys: CodingKey { case actorId, nickname, avatar }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self); actorId = try c.decode(String.self, forKey: .actorId); nickname = try c.decode(String.self, forKey: .nickname); avatar = try c.decodeIfPresent(ConversationAvatar.self, forKey: .avatar)
        guard RoomsWire.uuid(actorId), !nickname.isEmpty, c.contains(.avatar) else { throw ConversationError.invalidResponse }
    }
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self); try c.encode(actorId, forKey: .actorId); try c.encode(nickname, forKey: .nickname); try c.encode(avatar, forKey: .avatar)
    }
}
public struct PrivateRecipients: Decodable, Sendable {
    public let recipients: [PrivateRecipient]
    public let next: String?
    enum CodingKeys: CodingKey { case recipients, next }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self); recipients = try c.decode([PrivateRecipient].self, forKey: .recipients)
        guard c.contains(.next) else { throw ConversationError.invalidResponse }; next = try c.decodeIfPresent(String.self, forKey: .next)
        guard recipients.count <= 50, Set(recipients.map(\.id)).count == recipients.count, next.map(RoomsWire.uuid) ?? true, next == nil || next == recipients.last?.id else { throw ConversationError.invalidResponse }
    }
}
public struct ConversationListing: Sendable {
    public let messages: [ConversationMessage]
    public let commands: [StoredTextCommand]
    public let profiles: [ConversationProfile]
    public let eventCursor: String?
    public let historyCursor: String?
    public let ready: Bool
    public let profilesComplete: Bool
    public let profileCursor: String?
}
