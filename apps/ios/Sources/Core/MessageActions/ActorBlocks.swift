import Foundation
import CoreFoundation

/// Own block management remains available after leave; no active membership scope is needed.
struct BlockScope: Codable, Equatable, Sendable {
    let environment: String; let accountId: String; let sessionEpoch: String; let roomId: String; let viewEpoch: String
    var valid: Bool { ["qa", "prod"].contains(environment) && [accountId, sessionEpoch, roomId, viewEpoch].allSatisfy(actionID) }
    var partition: [String] { [environment, accountId, roomId] }
}
struct BlockedActor: Equatable, Sendable { let actorId: String; let blockedAt: String }
struct BlockPage: Equatable, Sendable { let blocks: [BlockedActor]; let next: String? }
enum UnblockOutcome: String, Codable, Sendable { case unknown, acknowledged, rejected }
struct UnblockRecord: Codable, Equatable, Sendable {
    let id: String; let scope: BlockScope; let actorId: String
    var outcome: UnblockOutcome; var observedBlocked: Bool?
}
@MainActor protocol BlockJournal { func records() throws -> [UnblockRecord]; func put(_ record: UnblockRecord) throws }
struct BlockViewToken: Equatable, Sendable { let scope: BlockScope; fileprivate let generation: UInt64 }
final class BlockPageToken: Sendable {
    let view: BlockViewToken; let after: String?
    fileprivate init(view: BlockViewToken, after: String?) { self.view = view; self.after = after }
}
final class UnblockPermit: @unchecked Sendable {
    let record: UnblockRecord
    private let lock = NSLock(); private var used = false; private var revoked = false
    fileprivate init(_ record: UnblockRecord) { self.record = record }
    func revoke() { lock.withLock { revoked = true } }
    func claim() throws { try lock.withLock { guard !used, !revoked else { throw MessageActionError.stale }; used = true } }
    func request() -> ActionRequest { ActionRequest(method: "DELETE", path: "rooms/\(record.scope.roomId)/blocks/\(record.actorId)", body: nil, successStatus: 200) }
}
struct BlockReset: Equatable, Sendable { let scope: BlockScope }
@MainActor final class ActorBlocksState {
    private let journal: any BlockJournal; private let actionJournal: any ActionJournal
    private var scope: BlockScope?; private var generation: UInt64 = 0
    private var pagePending: BlockPageToken?
    private(set) var pending: UnblockPermit?
    private(set) var blocks: [BlockedActor] = []
    private(set) var complete = false
    private(set) var next: String?
    private(set) var failed = false
    private(set) var lastOutcome: UnblockOutcome?
    private var baseline: [ActionRecord] = []
    init(journal: any BlockJournal, actionJournal: any ActionJournal) { self.journal = journal; self.actionJournal = actionJournal }
    func select(_ value: BlockScope?) throws {
        generation &+= 1; pending?.revoke(); pending = nil; pagePending = nil; scope = nil; blocks = []; complete = false; next = nil; failed = false; lastOutcome = nil; baseline = []
        if let value, !value.valid { throw MessageActionError.invalidResponse }; scope = value
    }
    func capture() -> BlockViewToken? { scope.map { BlockViewToken(scope: $0, generation: generation) } }
    private func admits(_ token: BlockViewToken) -> Bool { token.scope == scope && token.generation == generation }
    func refresh() throws -> BlockPageToken? {
        guard pending == nil, scope != nil else { return nil }
        baseline = try currentActorRecords()
        generation &+= 1; blocks = []; complete = false; next = nil; failed = false
        let token = BlockPageToken(view: capture()!, after: nil); pagePending = token; return token
    }
    func more() -> BlockPageToken? {
        guard pending == nil, pagePending == nil, !complete, let next, let view = capture() else { return nil }
        let token = BlockPageToken(view: view, after: next); pagePending = token; failed = false; return token
    }
    func fail(_ token: BlockPageToken) {
        if pagePending === token, admits(token.view) { pagePending = nil; failed = true }
    }
    func accept(_ token: BlockPageToken, page: BlockPage) throws -> BlockReset? {
        guard pagePending === token, admits(token.view) else { return nil }
        guard page.blocks.count <= 50, Set(page.blocks.map(\.actorId)).count == page.blocks.count,
              page.blocks.allSatisfy({ actionID($0.actorId) && ActorBlocksWire.validDate($0.blockedAt) }),
              zip(page.blocks, page.blocks.dropFirst()).allSatisfy({ $0.actorId < $1.actorId }),
              token.after.map({ after in page.blocks.allSatisfy { $0.actorId > after } }) ?? true,
              page.next == nil || page.next == page.blocks.last?.actorId else { throw MessageActionError.invalidResponse }
        blocks = token.after == nil ? page.blocks : blocks + page.blocks
        next = page.next; complete = next == nil; pagePending = nil; failed = false
        guard try currentActorRecords() == baseline else {
            generation &+= 1; blocks = []; complete = false; next = nil; failed = true
            return nil // A concurrent block intent/receipt invalidates this read observation.
        }
        guard complete else { return nil } // Prefix omission never proves unblocked.
        let current = token.view.scope; let actors = Set(blocks.map(\.actorId))
        for var record in try journal.records() where record.scope.partition == current.partition && record.outcome == .unknown {
            record.observedBlocked = actors.contains(record.actorId); try journal.put(record)
        }
        for var record in try actionJournal.records() where record.action == .blockActor &&
            [record.selection.scope.environment, record.selection.scope.accountId, record.selection.scope.roomId] == current.partition {
            record.observedBlocked = record.selection.visibleActorId.map(actors.contains) ?? false; try actionJournal.put(record)
        }
        return BlockReset(scope: current)
    }
    private func currentActorRecords() throws -> [ActionRecord] {
        try actionJournal.records().filter { $0.action == .blockActor &&
            [$0.selection.scope.environment, $0.selection.scope.accountId, $0.selection.scope.roomId] == scope?.partition }.sorted { $0.id < $1.id }
    }
    func unknownActors() throws -> Set<String> {
        guard let scope else { return [] }
        let unblocks = try journal.records().filter { $0.scope.partition == scope.partition && $0.outcome == .unknown }.map(\.actorId)
        let actions = try actionJournal.records().filter { $0.action == .blockActor && $0.phase == .unknown &&
            [$0.selection.scope.environment, $0.selection.scope.accountId, $0.selection.scope.roomId] == scope.partition }.compactMap { $0.selection.visibleActorId }
        return Set(unblocks + actions)
    }
    /// Explicit user intent after a COMPLETE fresh list, never automatic replay of UNKNOWN.
    func unblock(_ token: BlockViewToken, actorId: String) throws -> UnblockPermit {
        guard admits(token), complete, pending == nil, blocks.contains(where: { $0.actorId == actorId }) else { throw MessageActionError.stale }
        let record = UnblockRecord(id: UUID().uuidString.lowercased(), scope: token.scope, actorId: actorId, outcome: .unknown)
        try journal.put(record); lastOutcome = .unknown; generation &+= 1; complete = false; pagePending = nil
        let permit = UnblockPermit(record); pending = permit; return permit
    }
    func finish(_ permit: UnblockPermit, outcome: UnblockOutcome) throws -> BlockReset? {
        guard var original = try journal.records().first(where: { $0.id == permit.record.id }), original.outcome == .unknown else { return nil }
        original.outcome = outcome; try journal.put(original)
        guard pending === permit, scope == original.scope else { return nil }
        pending = nil; lastOutcome = outcome
        guard outcome == .acknowledged else { return nil }
        blocks.removeAll { $0.actorId == original.actorId }; return BlockReset(scope: original.scope)
    }
}
enum ActorBlocksWire {
    static func list(_ token: BlockPageToken) throws -> ActionRequest {
        if let after = token.after, !actionID(after) { throw MessageActionError.invalidResponse }
        return ActionRequest(method: "GET", path: "rooms/\(token.view.scope.roomId)/blocks", body: nil, successStatus: 200, query: token.after.map { ["after": $0] } ?? [:])
    }
    static func validDate(_ value: String) -> Bool {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) != nil || ISO8601DateFormatter().date(from: value) != nil
    }
    static func page(_ data: Data) throws -> BlockPage {
        let root = try ActionJSON.object(data)
        guard Set(root.keys) == ["blocks", "next"], let rows = root["blocks"] as? [[String: Any]], rows.count <= 50 else { throw MessageActionError.invalidResponse }
        let blocks = try rows.map { row -> BlockedActor in
            guard Set(row.keys) == ["actorId", "blockedAt"], let id = row["actorId"] as? String, actionID(id),
                  let date = row["blockedAt"] as? String, validDate(date) else { throw MessageActionError.invalidResponse }
            return BlockedActor(actorId: id, blockedAt: date)
        }
        let next = root["next"] as? String
        guard root["next"] is NSNull || next.map(actionID) == true else { throw MessageActionError.invalidResponse }
        return BlockPage(blocks: blocks, next: next)
    }
    static func result(_ permit: UnblockPermit, status: Int, data: Data) -> UnblockOutcome {
        do {
            let root = try ActionJSON.object(data)
            if status == 200 {
                guard Set(root.keys) == ["actorId", "blocked", "resetRequired"], root["actorId"] as? String == permit.record.actorId,
                      let blocked = root["blocked"] as? NSNumber, CFGetTypeID(blocked) == CFBooleanGetTypeID(), !blocked.boolValue,
                      let reset = root["resetRequired"] as? NSNumber, CFGetTypeID(reset) == CFBooleanGetTypeID(), reset.boolValue else { return .unknown }
                return .acknowledged
            }
            return MessageActionWire.result(.blockActor, status: status, data: data) == .rejected ? .rejected : .unknown
        } catch { return .unknown }
    }
}
