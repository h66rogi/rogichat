import Foundation

public struct ConversationSnapshot: Decodable, Sendable {
    public let membershipScope: String
    public let authorizationRevision: String
    public let messages: [ConversationMessage]
    public let nextCursor: String
    public let historyCursor: String?
    enum CodingKeys: CodingKey { case schemaVersion, resetRequired, membershipScope, authorizationRevision, messages, nextCursor, historyCursor }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard try c.decode(Int.self, forKey: .schemaVersion) == 2, try !c.decode(Bool.self, forKey: .resetRequired), c.contains(.historyCursor) else { throw ConversationError.invalidResponse }
        membershipScope = try c.decode(String.self, forKey: .membershipScope); authorizationRevision = try c.decode(String.self, forKey: .authorizationRevision)
        messages = try c.decode([ConversationMessage].self, forKey: .messages); nextCursor = try c.decode(String.self, forKey: .nextCursor); historyCursor = try c.decodeIfPresent(String.self, forKey: .historyCursor)
        guard RoomsWire.token(membershipScope), RoomsWire.token(authorizationRevision), RoomsWire.cursor(nextCursor), historyCursor.map(RoomsWire.cursor) ?? true,
              messages.count <= 100, Set(messages.map(\.id)).count == messages.count else { throw ConversationError.invalidResponse }
    }
}
public enum ConversationEvent: Decodable, Sendable {
    case upsert(ConversationMessage), deleted(id: String, version: MessageVersion)
    enum CodingKeys: String, CodingKey, Hashable { case type, message, messageId, version }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .type) {
        case "message.upsert":
            guard Set(c.allKeys) == [.type, .message] else { throw ConversationError.invalidResponse }
            self = .upsert(try c.decode(ConversationMessage.self, forKey: .message))
        case "message.deleted":
            guard Set(c.allKeys) == [.type, .messageId, .version] else { throw ConversationError.invalidResponse }
            let id = try c.decode(String.self, forKey: .messageId); guard RoomsWire.uuid(id) else { throw ConversationError.invalidResponse }
            self = .deleted(id: id, version: try c.decode(MessageVersion.self, forKey: .version))
        default: throw ConversationError.invalidResponse
        }
    }
}
public struct ConversationEvents: Decodable, Sendable {
    public let resetRequired: Bool
    public let membershipScope: String?
    public let authorizationRevision: String?
    public let events: [ConversationEvent]
    public let hasMore: Bool
    public let nextCursor: String?
    enum CodingKeys: CodingKey { case schemaVersion, resetRequired, membershipScope, authorizationRevision, events, hasMore, nextCursor }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard try c.decode(Int.self, forKey: .schemaVersion) == 2, c.contains(.membershipScope), c.contains(.authorizationRevision), c.contains(.nextCursor) else { throw ConversationError.invalidResponse }
        resetRequired = try c.decode(Bool.self, forKey: .resetRequired); membershipScope = try c.decodeIfPresent(String.self, forKey: .membershipScope); authorizationRevision = try c.decodeIfPresent(String.self, forKey: .authorizationRevision)
        events = try c.decode([ConversationEvent].self, forKey: .events); hasMore = try c.decode(Bool.self, forKey: .hasMore); nextCursor = try c.decodeIfPresent(String.self, forKey: .nextCursor)
        guard events.count <= 100 else { throw ConversationError.invalidResponse }
        if resetRequired {
            guard membershipScope == nil, authorizationRevision == nil, events.isEmpty, !hasMore, nextCursor == nil else { throw ConversationError.invalidResponse }
        } else {
            guard membershipScope.map(RoomsWire.token) == true, authorizationRevision.map(RoomsWire.token) == true, nextCursor.map(RoomsWire.cursor) == true, !hasMore || !events.isEmpty else { throw ConversationError.invalidResponse }
        }
    }
}
public struct ConversationHistory: Decodable, Sendable {
    public let resetRequired: Bool
    public let membershipScope: String?
    public let authorizationRevision: String?
    public let messages: [ConversationMessage]
    public let nextCursor: String?
    enum CodingKeys: CodingKey { case schemaVersion, resetRequired, membershipScope, authorizationRevision, messages, nextCursor }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard try c.decode(Int.self, forKey: .schemaVersion) == 2, c.contains(.membershipScope), c.contains(.authorizationRevision), c.contains(.nextCursor) else { throw ConversationError.invalidResponse }
        resetRequired = try c.decode(Bool.self, forKey: .resetRequired); membershipScope = try c.decodeIfPresent(String.self, forKey: .membershipScope); authorizationRevision = try c.decodeIfPresent(String.self, forKey: .authorizationRevision)
        messages = try c.decode([ConversationMessage].self, forKey: .messages); nextCursor = try c.decodeIfPresent(String.self, forKey: .nextCursor)
        guard messages.count <= 100, Set(messages.map(\.id)).count == messages.count else { throw ConversationError.invalidResponse }
        if resetRequired {
            guard membershipScope == nil, authorizationRevision == nil, messages.isEmpty, nextCursor == nil else { throw ConversationError.invalidResponse }
        } else {
            guard membershipScope.map(RoomsWire.token) == true, authorizationRevision.map(RoomsWire.token) == true, nextCursor.map(RoomsWire.cursor) ?? true,
                  nextCursor == nil || !messages.isEmpty else { throw ConversationError.invalidResponse }
        }
    }
}
// Child scope is immutable and never rebounds to a refreshed/rejoined room.
// Its synchronous gate participates in the existing parent account COMMIT fence.
public final class ConversationScope: @unchecked Sendable {
    public let account: RoomsScope
    public let room: MembershipRoom
    public let cacheID: String
    public let profileCacheID: String
    public let deviceID: String
    public let directoryCycle: String
    private let lock = NSRecursiveLock()
    private var valid = true
    init(account: RoomsScope, room: MembershipRoom, deviceID: String, cycle: String) {
        self.account = account; self.room = room; self.deviceID = deviceID; directoryCycle = cycle
        cacheID = UUID().uuidString.lowercased(); profileCacheID = UUID().uuidString.lowercased()
    }
    public func invalidate() { lock.withLock { valid = false } }
    public func check() throws { try withCurrent {} }
    public func withCurrent<T>(_ action: () throws -> T) throws -> T {
        try account.withCurrent { try lock.withLock { guard valid else { throw ConversationError.staleScope }; return try action() } }
    }
}
public enum ConversationQuery: Sendable {
    case snapshot, history(cursor: String), events(cursor: String), profiles(cursor: String?), recipients(after: String?), receipt(commandID: String), message(messageID: String)
}

public protocol ConversationCoordinating: Sendable {
    var scope: ConversationScope { get }
    func refresh() async throws -> ConversationListing
    func poll() async throws -> ConversationListing
    func history() async throws -> ConversationListing
    func recipients(after: String?) async throws -> PrivateRecipients
    func send(_ command: TextCommand) async throws -> ConversationListing
    func reconcile() async throws -> ConversationListing
    func containsCommand(_ id: String) async throws -> Bool
    func listing() async throws -> ConversationListing
}

public protocol RoomsConversationOpening: Sendable {
    func openConversation(roomID: String, cycle: String) async throws -> any ConversationCoordinating
}

public enum ConversationRequest: Sendable {
    case read(ConversationQuery), send(TextCommand)
}
