import Foundation

public enum RoomsError: Error, Equatable, LocalizedError, Sendable {
    case invalidResponse, staleScope, persistence, incomplete, unavailable, forbidden, connection
    public var errorDescription: String? {
        switch self {
        case .invalidResponse: "대화방 정보를 확인하지 못했어요. 다시 시도해 주세요."
        case .staleScope: "계정 상태가 변경되었어요. 대화방을 다시 확인해 주세요."
        case .persistence: "이 기기에 대화방 정보를 저장하지 못했어요. 잠금과 저장 공간을 확인한 뒤 다시 시도해 주세요."
        case .incomplete: "전체 대화방 목록을 확인하지 못했어요. 다시 시도해 주세요."
        case .unavailable: "지금은 대화방 목록을 확인할 수 없어요. 다시 시도해 주세요."
        case .forbidden: "대화방 목록에 접근할 수 없어요."
        case .connection: "연결을 확인하고 다시 시도해 주세요."
        }
    }
}
public enum RoomsWire {
    public static func uuid(_ value: String) -> Bool {
        let b = Array(value.utf8)
        guard b.count == 36, b[14] == 52, [56, 57, 97, 98].contains(b[19]) else { return false }
        return b.enumerated().allSatisfy { i, c in [8,13,18,23].contains(i) ? c == 45 : (48...57).contains(c) || (97...102).contains(c) }
    }
    public static func token(_ value: String) -> Bool {
        guard value.utf8.count == 43, value.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 }),
              let data = Data(base64Encoded: value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + "="), data.count == 32 else { return false }
        return data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") == value
    }
    public static func cursor(_ value: String) -> Bool { !value.isEmpty && value.utf8.count <= 4096 && value.utf8.allSatisfy { (33...126).contains($0) } }
}
public enum RoomAvailability: String, Codable, Sendable { case ready = "READY", ownerPending = "OWNER_PENDING" }
public struct DiscoveryRoom: Codable, Equatable, Sendable, Identifiable {
    public let roomId: String
    public let name: String
    public let mode: String
    public let joined: Bool
    public let isDefault: Bool
    public let availability: RoomAvailability
    public let actorId: String?
    public let membershipScope: String?
    public let authorizationRevision: String?
    public var id: String { roomId }
    enum CodingKeys: String, CodingKey { case roomId, name, mode, joined, actorId, membershipScope, authorizationRevision, isDefault, availability }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        roomId = try c.decode(String.self, forKey: .roomId); name = try c.decode(String.self, forKey: .name)
        mode = try c.decode(String.self, forKey: .mode); joined = try c.decode(Bool.self, forKey: .joined)
        isDefault = c.contains(.isDefault) ? try c.decode(Bool.self, forKey: .isDefault) : false
        availability = c.contains(.availability) ? try c.decode(RoomAvailability.self, forKey: .availability) : .ready
        guard availability != .ownerPending || (isDefault && !joined) else { throw RoomsError.invalidResponse }
        actorId = try c.decodeIfPresent(String.self, forKey: .actorId)
        membershipScope = try c.decodeIfPresent(String.self, forKey: .membershipScope)
        authorizationRevision = try c.decodeIfPresent(String.self, forKey: .authorizationRevision)
        guard RoomsWire.uuid(roomId), !name.isEmpty, ["FAN", "GROUP"].contains(mode) else { throw RoomsError.invalidResponse }
        if joined {
            guard let actorId, RoomsWire.uuid(actorId), let membershipScope, RoomsWire.token(membershipScope),
                  let authorizationRevision, RoomsWire.token(authorizationRevision) else { throw RoomsError.invalidResponse }
        } else if c.contains(.actorId) || c.contains(.membershipScope) || c.contains(.authorizationRevision) { throw RoomsError.invalidResponse }
    }
}
// Discovery is metadata only in persistence. Its observed joined/M/A fields
// are validated at the wire boundary but never become membership authority.
public struct DiscoveredRoom: Codable, Equatable, Sendable, Identifiable {
    public let roomId: String
    public let name: String
    public let mode: String
    public let isDefault: Bool
    public let availability: RoomAvailability
    public var id: String { roomId }
    init(_ room: DiscoveryRoom) { roomId = room.roomId; name = room.name; mode = room.mode; isDefault = room.isDefault; availability = room.availability }
    enum CodingKeys: CodingKey { case roomId, name, mode, isDefault, availability }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        roomId = try c.decode(String.self, forKey: .roomId); name = try c.decode(String.self, forKey: .name); mode = try c.decode(String.self, forKey: .mode)
        isDefault = c.contains(.isDefault) ? try c.decode(Bool.self, forKey: .isDefault) : false
        availability = c.contains(.availability) ? try c.decode(RoomAvailability.self, forKey: .availability) : .ready
        guard availability != .ownerPending || isDefault else { throw RoomsError.persistence }
        guard RoomsWire.uuid(roomId), !name.isEmpty, ["FAN", "GROUP"].contains(mode) else { throw RoomsError.persistence }
    }
}
public struct DiscoveryPage: Decodable, Sendable {
    public let rooms: [DiscoveryRoom]
    public let next: String?
    enum CodingKeys: CodingKey { case rooms, next }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rooms = try c.decode([DiscoveryRoom].self, forKey: .rooms)
        guard c.contains(.next) else { throw RoomsError.invalidResponse }
        next = try c.decodeIfPresent(String.self, forKey: .next)
        guard rooms.count <= 50, Set(rooms.map(\.id)).count == rooms.count,
              next.map(RoomsWire.uuid) ?? true, next == nil || (!rooms.isEmpty && next == rooms.last?.id) else { throw RoomsError.invalidResponse }
    }
}
public struct MembershipRoom: Codable, Equatable, Sendable, Identifiable {
    public let roomId: String
    public let name: String
    public let mode: String
    public let actorId: String
    public let role: String
    public let membershipScope: String
    public let authorizationRevision: String
    public var id: String { roomId }
    enum CodingKeys: CodingKey { case roomId, name, mode, actorId, role, membershipScope, authorizationRevision }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        roomId = try c.decode(String.self, forKey: .roomId); name = try c.decode(String.self, forKey: .name)
        mode = try c.decode(String.self, forKey: .mode); actorId = try c.decode(String.self, forKey: .actorId)
        role = try c.decode(String.self, forKey: .role)
        membershipScope = try c.decode(String.self, forKey: .membershipScope)
        authorizationRevision = try c.decode(String.self, forKey: .authorizationRevision)
        guard RoomsWire.uuid(roomId), RoomsWire.uuid(actorId), !name.isEmpty, ["FAN", "GROUP"].contains(mode),
              ["FAN", "MEMBER", "STREAMER"].contains(role), RoomsWire.token(membershipScope), RoomsWire.token(authorizationRevision) else { throw RoomsError.invalidResponse }
    }
}
public struct MembershipPage: Decodable, Sendable {
    public let resetRequired: Bool
    public let rooms: [MembershipRoom]
    public let generation: String?
    public let complete: Bool
    public let nextCursor: String?
    enum CodingKeys: CodingKey { case schemaVersion, resetRequired, rooms, generation, complete, nextCursor }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard try c.decode(Int.self, forKey: .schemaVersion) == 2, c.contains(.generation), c.contains(.nextCursor) else { throw RoomsError.invalidResponse }
        resetRequired = try c.decode(Bool.self, forKey: .resetRequired)
        rooms = try c.decode([MembershipRoom].self, forKey: .rooms)
        generation = try c.decodeIfPresent(String.self, forKey: .generation)
        complete = try c.decode(Bool.self, forKey: .complete)
        nextCursor = try c.decodeIfPresent(String.self, forKey: .nextCursor)
        guard rooms.count <= 100, Set(rooms.map(\.id)).count == rooms.count else { throw RoomsError.invalidResponse }
        if resetRequired {
            guard rooms.isEmpty, generation == nil, !complete, nextCursor == nil else { throw RoomsError.invalidResponse }
        } else {
            guard let generation, RoomsWire.token(generation), complete == (nextCursor == nil),
                  nextCursor.map(RoomsWire.cursor) ?? true, complete || !rooms.isEmpty else { throw RoomsError.invalidResponse }
        }
    }
}

// Shared synchronous gate: invalidation and the SQLite COMMIT are linearized,
// including the interval after the final scope check. No credential is stored here.
public final class RoomsScope: @unchecked Sendable {
    public let partition: String
    public let clientScope: UUID
    private let lock = NSRecursiveLock()
    private var valid = true
    private let expiresAt: Date
    private let now: @Sendable () -> Date
    public init(partition: String, clientScope: UUID, expiresAt: Date, now: @escaping @Sendable () -> Date = { Date() }) throws {
        guard RoomsWire.token(partition), expiresAt > now() else { throw RoomsError.staleScope }
        self.partition = partition; self.clientScope = clientScope; self.expiresAt = expiresAt; self.now = now
    }
    public func invalidate() { lock.withLock { valid = false } }
    public func check() throws { try withCurrent {} }
    public func withCurrent<T>(_ operation: () throws -> T) throws -> T {
        try lock.withLock {
            guard valid, now() < expiresAt else { throw RoomsError.staleScope }
            try Task.checkCancellation()
            return try operation()
        }
    }
}

public enum RoomsQuery: Sendable {
    case discovery(after: String?)
    case manifest(deviceID: String, cacheID: String, cursor: String?)
}

public enum RoomCommandAction: String, Sendable { case join, leave }
public struct RoomCommandIntent: Sendable {
    public let scope: RoomsScope
    public let roomID: String
    public let roomName: String
    public let action: RoomCommandAction
    public let cycle: String
    public let membershipScope: String?
    public init(scope: RoomsScope, roomID: String, roomName: String, action: RoomCommandAction, cycle: String, membershipScope: String?) throws {
        let validMembership = action == .leave ? membershipScope.map(RoomsWire.token) == true : membershipScope == nil
        guard RoomsWire.uuid(roomID), UUID(uuidString: cycle) != nil, validMembership else { throw RoomsError.staleScope }
        self.scope = scope; self.roomID = roomID; self.roomName = roomName; self.action = action; self.cycle = cycle; self.membershipScope = membershipScope
    }
}
public struct RoomJoinAcknowledgement: Decodable, Sendable {
    public let actorId: String
    public let historyPolicy: String
    public let policyVersion: UInt32
    public let membershipScope: String
    public let authorizationRevision: String
    enum CodingKeys: CodingKey { case actorId, historyPolicy, policyVersion, membershipScope, authorizationRevision }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        actorId = try c.decode(String.self, forKey: .actorId); historyPolicy = try c.decode(String.self, forKey: .historyPolicy)
        policyVersion = try c.decode(UInt32.self, forKey: .policyVersion)
        membershipScope = try c.decode(String.self, forKey: .membershipScope); authorizationRevision = try c.decode(String.self, forKey: .authorizationRevision)
        guard RoomsWire.uuid(actorId), ["ALL_AVAILABLE", "SINCE_JOIN"].contains(historyPolicy), RoomsWire.token(membershipScope), RoomsWire.token(authorizationRevision) else { throw RoomsError.invalidResponse }
    }
}
public enum RoomCommandError: Error, Equatable, LocalizedError, Sendable {
    case inProgress, confirmationChanged, forbidden, notFound, conflict, invalidRequest
    public var errorDescription: String? {
        switch self {
        case .inProgress: "앞선 참여 요청을 확인하고 있어요."
        case .confirmationChanged: "참여 상태가 변경되었어요. 목록을 다시 확인한 뒤 선택해 주세요."
        case .forbidden: "현재 이 요청을 처리할 수 없어요. 참여 상태를 다시 확인해 주세요."
        case .notFound: "이 대화방을 확인할 수 없어요. 참여 상태를 다시 확인해 주세요."
        case .conflict: "현재 상태에서는 요청을 처리할 수 없어요."
        case .invalidRequest: "요청을 확인하지 못했어요. 참여 상태를 다시 확인해 주세요."
        }
    }
}
public enum RoomCommandOutcome: Sendable, Equatable {
    case acknowledged, unknown, rejected(RoomCommandError)
    public var notice: String? {
        switch self {
        case .acknowledged: nil
        case .unknown: nil
        case .rejected(let error): error.errorDescription
        }
    }
}
public struct RoomCommandReconciliationError: Error, LocalizedError, Sendable {
    public let outcome: RoomCommandOutcome
    public var errorDescription: String? { "참여 상태를 확인하지 못했어요. 다시 확인해 주세요." }
}
// This live gate belongs to the feature coordinator, never to a preserved listing.
public struct RoomsActionState: Sendable {
    public private(set) var cycle: String?
    public private(set) var working = false
    public init() {}
    public mutating func close(working: Bool) { cycle = nil; self.working = working }
    public mutating func confirmed(cycle: String) { self.cycle = cycle; working = false }
    public func permits(cycle: String?) -> Bool { !working && cycle != nil && self.cycle == cycle }
}

public struct RoomsListing: Sendable, Equatable {
    public let memberships: [MembershipRoom]
    public let discovery: [DiscoveredRoom]
    public let membershipConfirmed: Bool
    public let discoveryComplete: Bool
    public let cycle: String?
}
public struct ManifestRequest: Sendable {
    public let run: String
    public let deviceID: String
    public let cacheID: String
    public let cursor: String?
}

public struct RoomCommandResult: Sendable {
    public let listing: RoomsListing
    public let outcome: RoomCommandOutcome
}

public protocol RoomsCoordinating: Sendable {
    func refresh() async throws -> RoomsListing
    func loadMore() async throws -> RoomsListing
    func command(_ intent: RoomCommandIntent) async throws -> RoomCommandResult
}
