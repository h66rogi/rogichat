import Foundation
import Testing
import GRDB
@testable import RogichatRooms

private let room1 = "00000000-0000-4000-8000-000000000001"
private let room2 = "00000000-0000-4000-8000-000000000002"
private let actor = "00000000-0000-4000-8000-000000000010"
private func token(_ byte: UInt8 = 1) -> String { Data(repeating: byte, count: 32).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
private func scope(_ byte: UInt8 = 1) throws -> RoomsScope { try RoomsScope(partition: token(byte), clientScope: UUID(), expiresAt: Date().addingTimeInterval(3600)) }
private func directory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("rooms-tests-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true); return url
}
private func decode<T: Decodable>(_ object: [String: Any], _ type: T.Type) throws -> T { try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: object)) }
private func room(_ id: String = room1, joined: Bool = false) -> [String: Any] {
    var value: [String: Any] = ["roomId": id, "name": "방", "mode": "FAN", "joined": joined]
    if joined { value.merge(["actorId": actor, "membershipScope": token(), "authorizationRevision": token(2)]) { _, new in new } }
    return value
}
private func member(_ id: String = room1, authorization: UInt8 = 2) -> [String: Any] {
    ["roomId": id, "name": "확정한 방", "mode": "FAN", "actorId": actor, "role": "FAN", "membershipScope": token(), "authorizationRevision": token(authorization)]
}
private func manifest(_ rooms: [[String: Any]], next: String? = nil, generation: UInt8 = 3) throws -> MembershipPage {
    try decode(["schemaVersion": 2, "resetRequired": false, "rooms": rooms, "generation": token(generation), "complete": next == nil, "nextCursor": next as Any? ?? NSNull()], MembershipPage.self)
}
private func discovery(_ rooms: [[String: Any]], next: String? = nil) throws -> DiscoveryPage {
    try decode(["rooms": rooms, "next": next as Any? ?? NSNull()], DiscoveryPage.self)
}
private func reset() throws -> MembershipPage {
    try decode(["schemaVersion": 2, "resetRequired": true, "rooms": [], "generation": NSNull(), "complete": false, "nextCursor": NSNull()], MembershipPage.self)
}
@Test func strictWireVariants() throws {
    #expect(try discovery([room(joined: true)]).rooms.first?.joined == true)
    var bad = room(); bad["actorId"] = NSNull()
    #expect(throws: (any Error).self) { try discovery([bad]) }
    bad = room(joined: true); bad.removeValue(forKey: "membershipScope")
    #expect(throws: (any Error).self) { try discovery([bad]) }
    #expect(throws: (any Error).self) { try decode(["rooms": []], DiscoveryPage.self) }
    #expect(throws: (any Error).self) { try discovery([room(), room()]) }
    #expect(throws: (any Error).self) { try discovery([room()], next: room2) }
    var page: [String: Any] = ["schemaVersion": 1, "resetRequired": false, "rooms": [], "generation": token(), "complete": true, "nextCursor": NSNull()]
    #expect(throws: (any Error).self) { try decode(page, MembershipPage.self) }
    page["schemaVersion"] = 2; page["resetRequired"] = true
    #expect(throws: (any Error).self) { try decode(page, MembershipPage.self) }
    #expect(try reset().resetRequired)
    #expect(!RoomsWire.uuid(room1.uppercased().replacingOccurrences(of: "0001", with: "00AF")))
    #expect(!RoomsWire.token(String(repeating: "_", count: 43)))
    #expect(!RoomsWire.token(token() + "="))
}
@Test func completeManifestAndDiscoveryIsolation() throws {
    let root = try directory(); defer { try? FileManager.default.removeItem(at: root) }
    let db = try RoomsDatabase(url: root.appendingPathComponent("test.sqlite"), scope: scope(), deviceID: room1)
    defer { try? db.close() }
    let request = try db.beginManifest()
    let next = try #require(try db.manifestPage(manifest([member()], next: "cursor1"), request: request))
    #expect(try !db.listing().membershipConfirmed)
    #expect(try db.listing().memberships.isEmpty)
    #expect(try db.manifestPage(manifest([member(room2)]), request: next) == nil)
    #expect(try db.listing().memberships.count == 2)
    #expect(throws: RoomsError.staleScope) { try db.manifestPage(manifest([]), request: next) }
    let revision = try db.beginDiscovery()
    try db.discoveryPage(discovery([room(joined: false)]), revision: revision, after: nil)
    #expect(try db.listing().memberships.count == 2) // Discovery absence/unjoined never removes membership.
    #expect(try db.listing().memberships[0].name == "확정한 방")
    let replacement = try db.beginManifest()
    #expect(try db.manifestPage(manifest([]), request: replacement) == nil)
    #expect(throws: RoomsError.staleScope) { try db.manifestPage(manifest([member()]), request: replacement) }
    #expect(try db.listing().membershipConfirmed)
    #expect(try db.listing().memberships.isEmpty)
    let settings = try db.durabilitySettings(); #expect(settings.0 == "wal"); #expect(settings.1 == 2)
}
@Test func staleMixedDuplicateAndLoopPages() throws {
    let root = try directory(); defer { try? FileManager.default.removeItem(at: root) }
    let db = try RoomsDatabase(url: root.appendingPathComponent("test.sqlite"), scope: scope(), deviceID: room1)
    defer { try? db.close() }
    let old = try db.beginManifest(); let fresh = try db.beginManifest()
    #expect(throws: RoomsError.staleScope) { try db.manifestPage(manifest([member()]), request: old) }
    let next = try #require(try db.manifestPage(manifest([member()], next: "cursor1"), request: fresh))
    #expect(throws: RoomsError.invalidResponse) { try db.manifestPage(manifest([member(room2)], generation: 4), request: next) }
    #expect(throws: RoomsError.invalidResponse) { try db.manifestPage(manifest([member()]), request: next) }
    #expect(throws: RoomsError.invalidResponse) { try db.manifestPage(manifest([member(room2)], next: "cursor1"), request: next) }
    let restarted = try #require(try db.manifestPage(reset(), request: next))
    #expect(restarted.cacheID != next.cacheID); #expect(restarted.cursor == nil)
    #expect(throws: RoomsError.staleScope) { try db.manifestPage(manifest([]), request: next) }
    let firstRevision = try db.beginDiscovery(); let secondRevision = try db.beginDiscovery()
    #expect(throws: RoomsError.staleScope) { try db.discoveryPage(discovery([room()]), revision: firstRevision, after: nil) }
    try db.discoveryPage(discovery([room()], next: room1), revision: secondRevision, after: nil)
    #expect(throws: RoomsError.invalidResponse) { try db.discoveryPage(discovery([room()], next: room1), revision: secondRevision, after: room1) }
}
private final class Fault: @unchecked Sendable {
    private let lock = NSLock(); private var enabled = false
    func set(_ value: Bool) { lock.withLock { enabled = value } }
    func check() throws { if lock.withLock({ enabled }) { throw RoomsError.persistence } }
}
@Test func rollbackAndReopen() throws {
    let root = try directory(); defer { try? FileManager.default.removeItem(at: root) }
    let url = root.appendingPathComponent("test.sqlite"); let fault = Fault()
    let db = try RoomsDatabase(url: url, scope: scope(), deviceID: room1, beforeCommit: { _ in try fault.check() })
    let request = try db.beginManifest()
    fault.set(true)
    #expect(throws: RoomsError.persistence) { try db.manifestPage(manifest([member()]), request: request) }
    fault.set(false)
    #expect(try !db.listing().membershipConfirmed)
    #expect(try db.manifestPage(manifest([member()]), request: request) == nil)
    try db.close()
    let raw = try DatabaseQueue(path: url.path)
    #expect(try raw.read { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM memberships") } == 1)
    try raw.close()
    let reopened = try RoomsDatabase(url: url, scope: scope(), deviceID: room1)
    #expect(try !reopened.listing().membershipConfirmed) // No previous-session authority on cold open.
    #expect(try reopened.listing().memberships.isEmpty)
    try reopened.close()
}
@Test func purgeRecoveryAndOldHandle() throws {
    let root = try directory(); defer { try? FileManager.default.removeItem(at: root) }
    let fault = Fault(); let storage = RoomsStorage(root: root, beforeDelete: { try fault.check() })
    let a = try scope(); let dbA = try storage.open(scope: a)
    _ = try dbA.manifestPage(manifest([member()]), request: dbA.beginManifest())
    fault.set(true)
    #expect(throws: (any Error).self) { try storage.purge() }
    #expect(throws: RoomsError.staleScope) { try a.check() }
    #expect(throws: (any Error).self) { try storage.open(scope: scope()) }
    // New process owner must finish persisted pending purge before opening.
    let recovered = RoomsStorage(root: root)
    let b = try scope(4); let dbB = try recovered.open(scope: b)
    #expect(try dbB.listing().memberships.isEmpty)
    #expect(throws: (any Error).self) { try dbA.beginManifest() }
    let a2 = try scope(); let dbA2 = try recovered.open(scope: a2)
    #expect(throws: RoomsError.staleScope) { try b.check() }
    #expect(try dbA2.listing().memberships.isEmpty)
    try recovered.purge()
}
private func waitForSignal(_ signal: DispatchSemaphore) { signal.wait() }
private func waitForSignal(_ signal: DispatchSemaphore, timeout: DispatchTime) -> Bool { signal.wait(timeout: timeout) == .success }
private final class CommitGate: @unchecked Sendable {
    private let condition = NSCondition(); private var armed = false; private var entered = false; private var released = false
    func arm() { condition.lock(); armed = true; condition.unlock() }
    func waitAtCommit() { condition.lock(); defer { condition.unlock() }; guard armed else { return }; entered = true; condition.broadcast(); while !released { condition.wait() } }
    func waitUntilEntered() { condition.lock(); defer { condition.unlock() }; while !entered { condition.wait() } }
    func release() { condition.lock(); released = true; condition.broadcast(); condition.unlock() }
}
private final class CommitObserver: TransactionObserver, @unchecked Sendable {
    let gate: CommitGate
    private let lock = NSLock(); private var committed = false
    init(_ gate: CommitGate) { self.gate = gate }
    func observes(eventsOfKind eventKind: DatabaseEventKind) -> Bool { true }
    func databaseDidChange(with event: DatabaseEvent) {}
    func databaseWillCommit() throws { gate.waitAtCommit() }
    func databaseDidCommit(_ db: Database) { lock.withLock { committed = true } }
    func databaseDidRollback(_ db: Database) {}
    var didCommit: Bool { lock.withLock { committed } }
    func reset() { lock.withLock { committed = false } }
}
@Test func commitInvalidationLinearization() async throws {
    let root = try directory(); defer { try? FileManager.default.removeItem(at: root) }
    let gate = CommitGate(); let observer = CommitObserver(gate); let lifetime = try scope()
    let db = try RoomsDatabase(url: root.appendingPathComponent("test.sqlite"), scope: lifetime, deviceID: room1, beforeCommit: { db in db.add(transactionObserver: observer, extent: .nextTransaction) })
    let request = try db.beginManifest(); let page = try manifest([member()]); observer.reset(); gate.arm()
    let commit = Task.detached { try db.manifestPage(page, request: request) }
    await Task.detached { gate.waitUntilEntered() }.value
    let entered = DispatchSemaphore(value: 0); let finished = DispatchSemaphore(value: 0)
    let invalidate = Task.detached { entered.signal(); lifetime.invalidate(); let committed = observer.didCommit; finished.signal(); return committed }
    await Task.detached { waitForSignal(entered) }.value
    // This gate is sqlite3_commit_hook / databaseWillCommit, after the SQL closure
    // returned. An attempted invalidation must wait through the actual COMMIT.
    let premature = await Task.detached { waitForSignal(finished, timeout: .now() + 0.05) }.value
    #expect(!premature)
    gate.release(); _ = try await commit.value; #expect(await invalidate.value)
    #expect(throws: RoomsError.staleScope) { try db.listing() }
    try db.close()
    let raw = try DatabaseQueue(path: root.appendingPathComponent("test.sqlite").path)
    #expect(try await raw.read { try Int.fetchOne($0, sql: "SELECT confirmed FROM metadata") } == 1)
    try raw.close()
}

private actor ReorderedRemote: RoomsFetching {
    var pending: [Int: CheckedContinuation<DiscoveryPage, any Error>] = [:]
    private var waiters: [(Int, CheckedContinuation<Void, Never>)] = []
    private var count = 0
    let page: MembershipPage
    init(page: MembershipPage) { self.page = page }
    func discovery(after: String?, scope: RoomsScope) async throws -> DiscoveryPage {
        count += 1; let index = count
        return try await withCheckedThrowingContinuation { continuation in
            pending[index] = continuation
            let ready = waiters.filter { $0.0 <= count }; waiters.removeAll { $0.0 <= count }; ready.forEach { $0.1.resume() }
        }
    }
    func manifest(_ request: ManifestRequest, scope: RoomsScope) async throws -> MembershipPage { page }
    func wait(_ desired: Int) async { if count >= desired { return }; await withCheckedContinuation { waiters.append((desired, $0)) } }
    func finish(_ index: Int, _ page: DiscoveryPage) { pending.removeValue(forKey: index)?.resume(returning: page) }
}
@Test func reversedRefreshAndCancelledScope() async throws {
    let root = try directory(); defer { try? FileManager.default.removeItem(at: root) }
    let lifetime = try scope(); let storage = RoomsStorage(root: root)
    let remote = ReorderedRemote(page: try manifest([member(room2)]))
    let repository = RoomsRepository(remote: remote, storage: storage, scope: lifetime)
    let old = Task { try await repository.refresh() }; await remote.wait(1)
    let fresh = Task { try await repository.refresh() }; await remote.wait(2)
    try await remote.finish(2, discovery([room(room2)]))
    #expect(try await fresh.value.discovery.map(\.id) == [room2])
    try await remote.finish(1, discovery([room()]))
    await #expect(throws: RoomsError.staleScope) { try await old.value }
    #expect(try storage.open(scope: lifetime).listing().discovery.map(\.id) == [room2])
    let late = Task { try await repository.refresh() }; await remote.wait(3)
    lifetime.invalidate()
    try await remote.finish(3, discovery([room()]))
    await #expect(throws: RoomsError.staleScope) { try await late.value }
    try storage.purge()
}

@Test func failedPurgeMarkerDoesNotAcknowledgeDeletion() throws {
    let root = try directory(); defer { try? FileManager.default.removeItem(at: root) }
    let fault = Fault(); let storage = RoomsStorage(root: root, beforeSave: { try fault.check() })
    let lifetime = try scope(); let db = try storage.open(scope: lifetime)
    _ = try db.manifestPage(manifest([member()]), request: db.beginManifest())
    fault.set(true)
    #expect(throws: RoomsError.persistence) { try storage.purge() }
    #expect(throws: RoomsError.staleScope) { try db.listing() }
    // NativeSessionService separately tests the no-credential cold path always
    // invoking purge; it cannot rely on this failed marker having been saved.
    fault.set(false)
    try db.close()
    let cold = RoomsStorage(root: root)
    try cold.purge()
    #expect(!FileManager.default.fileExists(atPath: root.appendingPathComponent("accounts").path))
    #expect(try cold.open(scope: scope()).listing().memberships.isEmpty)
    try cold.purge()
}
