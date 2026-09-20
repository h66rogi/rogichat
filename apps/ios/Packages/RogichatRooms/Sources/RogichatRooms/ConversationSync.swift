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
    case read(ConversationQuery), send(TextCommand), feature(ConversationFeatureRequest)
}

// Constructed only by reviewed feature adapters. This travels through the same immutable
// account/room authorization gate as sync; no captured credential escapes that boundary.
public struct ConversationFeatureRequest: Sendable {
    public let method: String
    public let path: String
    public let body: Data?
    public let upload: URL?
    public let uploadBytes: Int64?
    public let expectedStatus: Int
    public let query: [String: String]
    public let admit: @Sendable () throws -> Void
    public init(method: String, path: String, body: Data?, upload: URL? = nil, uploadBytes: Int64? = nil,
                expectedStatus: Int, query: [String: String] = [:], admit: @escaping @Sendable () throws -> Void = {}) throws {
        guard ["GET", "POST", "PUT", "PATCH", "DELETE"].contains(method), [200, 201, 202, 204].contains(expectedStatus),
              !path.isEmpty, !path.hasPrefix("/"), !path.contains(".."), !path.contains("%"), !path.contains("#"),
              body == nil || upload == nil, upload == nil || uploadBytes.map({ $0 > 0 && $0 <= 50 * 1024 * 1024 }) == true
        else { throw ConversationError.invalidResponse }
        self.method = method; self.path = path; self.body = body; self.upload = upload
        self.uploadBytes = uploadBytes; self.expectedStatus = expectedStatus; self.query = query; self.admit = admit
    }
    public func validate(room: String) throws {
        let raw = path.split(separator: "?", maxSplits: 1).map(String.init)
        let parts = raw[0].split(separator: "/").map(String.init)
        let allowed: Bool
        if parts.count >= 3, parts[0] == "media", ["upload-intents", "assets"].contains(parts[1]) {
            allowed = RoomsWire.uuid(parts[2]) && (parts.count == 3 || (parts.count == 4 && ["content", "access"].contains(parts[3])))
        } else if parts == ["media", "upload-intents"] { allowed = method == "POST" }
        else if parts.count == 2, parts[0] == "report-receipts" { allowed = method == "GET" && RoomsWire.uuid(parts[1]) }
        else if parts.count >= 3, parts[0] == "rooms", parts[1] == room {
            switch parts[2] {
            case "actors":
                allowed = parts.count == 6 && RoomsWire.uuid(parts[3]) && parts[4] == "provider-avatar" && parts[5] == "access" && method == "POST" && body == nil && upload == nil && expectedStatus == 200
            case "stickers", "read-state": allowed = parts.count == 3
            case "blocks": allowed = parts.count == 3 || (parts.count == 4 && RoomsWire.uuid(parts[3]))
            case "publications": allowed = parts.count == 4 && RoomsWire.uuid(parts[3])
            case "messages":
                allowed = parts.count >= 5 && parts.count <= 6 && RoomsWire.uuid(parts[3]) &&
                    ["delete", "publications", "reactions", "reports"].contains(parts[4]) && (parts.count != 6 || parts[5] == "me")
            default: allowed = false
            }
        } else { allowed = false }
        guard allowed, query.keys.allSatisfy({ $0 == "after" }), query.values.allSatisfy(RoomsWire.uuid),
              query.isEmpty || (["blocks", "stickers"].contains(parts.last ?? "") && method == "GET" && raw.count == 1) else { throw ConversationError.invalidResponse }
        if raw.count == 2 {
            guard ["stickers", "blocks"].contains(parts.last ?? ""), raw[1].hasPrefix("after="), RoomsWire.uuid(String(raw[1].dropFirst(6))) else { throw ConversationError.invalidResponse }
        }
    }
}
public struct ConversationFeatureFailure: Error, Sendable {
    public let status: Int
    public let data: Data
    public init(status: Int, data: Data) { self.status = status; self.data = data }
}
// Feature journals retain opaque, typed-adapter validated records, never credentials or signed URLs.
public enum ConversationJournal: String, Sendable { case media, actions, viewport, moderation, blockRooms }
public protocol ConversationFeatureJournal: Sendable {
    func records(_ journal: ConversationJournal) throws -> [Data]
    func put(_ journal: ConversationJournal, id: String, value: Data) throws
    func remove(_ journal: ConversationJournal, id: String) throws
}
public protocol ConversationFeatureStoring: Sendable {
    var localFeatures: any ConversationFeatureJournal { get }
    func featureRecords(_ journal: ConversationJournal) async throws -> [Data]
    func putFeature(_ journal: ConversationJournal, id: String, value: Data) async throws
    func removeFeature(_ journal: ConversationJournal, id: String) async throws
    func blockProjection(_ messageID: String) async throws
}
