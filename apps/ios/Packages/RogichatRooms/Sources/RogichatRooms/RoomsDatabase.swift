import Foundation
import GRDB

// All access is owned by RoomsRepository. The extra scope gate covers the actual
// COMMIT, not only the SQL closure. No HTTP or actor suspension occurs in SQL.
public final class RoomsDatabase: @unchecked Sendable {
    private let queue: DatabaseQueue
    public let scope: RoomsScope
    private let deviceID: String
    private var closed = false
    private let lock = NSRecursiveLock()
    let beforeCommit: @Sendable (Database) throws -> Void
    public init(url: URL, scope: RoomsScope, deviceID: String,
                beforeCommit: @escaping @Sendable (Database) throws -> Void = { _ in }) throws {
        guard RoomsWire.uuid(deviceID) else { throw RoomsError.persistence }
        self.scope = scope; self.deviceID = deviceID; self.beforeCommit = beforeCommit
        var configuration = Configuration()
        configuration.prepareDatabase { db in
            try db.execute(sql: "PRAGMA journal_mode = WAL")
            try db.execute(sql: "PRAGMA synchronous = FULL")
            guard try String.fetchOne(db, sql: "PRAGMA journal_mode") == "wal", try Int.fetchOne(db, sql: "PRAGMA synchronous") == 2 else { throw RoomsError.persistence }
        }
        queue = try DatabaseQueue(path: url.path, configuration: configuration)
        var migrator = DatabaseMigrator()
        migrator.registerMigration("rooms-v1") { db in
            try db.execute(sql: "CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, partition TEXT NOT NULL, confirmed INTEGER NOT NULL CHECK(confirmed IN (0,1)), discoveryRevision TEXT, discoveryNext TEXT, discoveryComplete INTEGER NOT NULL DEFAULT 0 CHECK(discoveryComplete IN (0,1)))")
            try db.execute(sql: "CREATE TABLE discovery (id TEXT PRIMARY KEY NOT NULL, value BLOB NOT NULL)")
            try db.execute(sql: "CREATE TABLE memberships (id TEXT PRIMARY KEY NOT NULL, value BLOB NOT NULL)")
            try db.execute(sql: "CREATE TABLE manifest (id INTEGER PRIMARY KEY CHECK(id=1), run TEXT NOT NULL, cache TEXT NOT NULL, generation TEXT, next TEXT, complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN (0,1)))")
            try db.execute(sql: "CREATE TABLE staging (id TEXT PRIMARY KEY NOT NULL, value BLOB NOT NULL)")
            try db.execute(sql: "CREATE TABLE visited_cursors (value TEXT PRIMARY KEY NOT NULL)")
        }
        try migrator.migrate(queue)
        try scope.withCurrent {
            try queue.write { db in
                if let previous = try String.fetchOne(db, sql: "SELECT partition FROM metadata WHERE id=1"), previous != scope.partition { throw RoomsError.persistence }
                try db.execute(sql: "INSERT OR REPLACE INTO metadata (id,owner,partition,confirmed) VALUES (1,?,?,0)", arguments: [scope.clientScope.uuidString, scope.partition])
                // A cold process/session never resumes a cursor bound to the old session.
                try db.execute(sql: "DELETE FROM manifest; DELETE FROM staging; DELETE FROM visited_cursors; DELETE FROM discovery")
            }
        }
        try Self.protectFiles(directory: url.deletingLastPathComponent())
    }
    public static func protectFiles(directory: URL) throws {
        var directory = directory
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: directory.path)
        for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: file.path)
        }
        #endif
    }
    private func write<T>(_ operation: (Database) throws -> T) throws -> T {
        try lock.withLock {
            guard !closed else { throw RoomsError.staleScope }
            return try queue.writeWithoutTransaction { db in
                try scope.withCurrent {
                    var output: T?
                    try db.inTransaction {
                        try verify(db)
                        output = try operation(db)
                        try beforeCommit(db)
                        try scope.check()
                        return .commit
                    }
                    return output!
                }
            }
        }
    }
    private func verify(_ db: Database) throws {
        guard try String.fetchOne(db, sql: "SELECT owner FROM metadata WHERE id=1") == scope.clientScope.uuidString,
              try String.fetchOne(db, sql: "SELECT partition FROM metadata WHERE id=1") == scope.partition else { throw RoomsError.staleScope }
    }
    public func close() throws { try lock.withLock { if !closed { try queue.close(); closed = true } } }
    public func beginDiscovery() throws -> String {
        try write { db in
            let revision = UUID().uuidString
            try db.execute(sql: "DELETE FROM discovery")
            try db.execute(sql: "UPDATE metadata SET discoveryRevision=?,discoveryNext=NULL,discoveryComplete=0 WHERE id=1", arguments: [revision])
            return revision
        }
    }
    public func discoveryPage(_ page: DiscoveryPage, revision: String, after: String?) throws {
        try write { db in
            guard try String.fetchOne(db, sql: "SELECT discoveryRevision FROM metadata") == revision,
                  try String.fetchOne(db, sql: "SELECT discoveryNext FROM metadata") == after,
                  try Int.fetchOne(db, sql: "SELECT discoveryComplete FROM metadata") == 0 else { throw RoomsError.staleScope }
            if let after, page.rooms.contains(where: { $0.id <= after }) { throw RoomsError.invalidResponse }
            guard zip(page.rooms, page.rooms.dropFirst()).allSatisfy({ $0.0.id < $0.1.id }) else { throw RoomsError.invalidResponse }
            for room in page.rooms {
                guard try !Bool.fetchOne(db, sql: "SELECT EXISTS(SELECT 1 FROM discovery WHERE id=?)", arguments: [room.id])! else { throw RoomsError.invalidResponse }
                try db.execute(sql: "INSERT INTO discovery(id,value) VALUES (?,?)", arguments: [room.id, try JSONEncoder().encode(DiscoveredRoom(room))])
            }
            try db.execute(sql: "UPDATE metadata SET discoveryNext=?,discoveryComplete=?", arguments: [page.next, page.next == nil])
        }
    }
    public func discoveryNext(revision: String) throws -> String? {
        try write { db in
            guard try String.fetchOne(db, sql: "SELECT discoveryRevision FROM metadata") == revision else { throw RoomsError.staleScope }
            return try String.fetchOne(db, sql: "SELECT discoveryNext FROM metadata")
        }
    }
    public func beginManifest() throws -> ManifestRequest {
        try write { db in try startManifest(db) }
    }
    private func startManifest(_ db: Database) throws -> ManifestRequest {
        let run = UUID().uuidString; let cache = UUID().uuidString.lowercased()
        try db.execute(sql: "DELETE FROM staging; DELETE FROM manifest; DELETE FROM visited_cursors")
        try db.execute(sql: "INSERT INTO manifest(id,run,cache) VALUES(1,?,?)", arguments: [run, cache])
        try db.execute(sql: "UPDATE metadata SET confirmed=0")
        return ManifestRequest(run: run, deviceID: deviceID, cacheID: cache, cursor: nil)
    }
    // nil means a complete authoritative generation committed; reset returns a new run.
    public func manifestPage(_ page: MembershipPage, request: ManifestRequest) throws -> ManifestRequest? {
        try write { db in
            guard let row = try Row.fetchOne(db, sql: "SELECT * FROM manifest WHERE id=1"),
                  row["run"] as String == request.run, row["cache"] as String == request.cacheID, row["complete"] as Int == 0,
                  row["next"] as String? == request.cursor else { throw RoomsError.staleScope }
            if page.resetRequired { return try startManifest(db) }
            let previous: String? = row["generation"]
            guard previous == nil || previous == page.generation else { throw RoomsError.invalidResponse }
            if let next = page.nextCursor {
                guard next != request.cursor,
                      try !Bool.fetchOne(db, sql: "SELECT EXISTS(SELECT 1 FROM visited_cursors WHERE value=?)", arguments: [next])! else { throw RoomsError.invalidResponse }
                try db.execute(sql: "INSERT INTO visited_cursors(value) VALUES (?)", arguments: [next])
            }
            for room in page.rooms {
                guard try !Bool.fetchOne(db, sql: "SELECT EXISTS(SELECT 1 FROM staging WHERE id=?)", arguments: [room.id])! else { throw RoomsError.invalidResponse }
                try db.execute(sql: "INSERT INTO staging(id,value) VALUES (?,?)", arguments: [room.id, try JSONEncoder().encode(room)])
            }
            guard try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM staging")! <= 10_000 else { throw RoomsError.incomplete }
            try db.execute(sql: "UPDATE manifest SET generation=?,next=?", arguments: [page.generation, page.nextCursor])
            if page.complete {
                try db.execute(sql: "DELETE FROM memberships; INSERT INTO memberships SELECT * FROM staging; DELETE FROM staging")
                try db.execute(sql: "UPDATE metadata SET confirmed=1; UPDATE manifest SET complete=1")
                return nil
            }
            return ManifestRequest(run: request.run, deviceID: request.deviceID, cacheID: request.cacheID, cursor: page.nextCursor)
        }
    }
    public func listing() throws -> RoomsListing {
        try write { db in
            let confirmed = try Bool.fetchOne(db, sql: "SELECT confirmed FROM metadata")!
            let memberships = confirmed ? try Data.fetchAll(db, sql: "SELECT value FROM memberships ORDER BY id COLLATE BINARY").map { try JSONDecoder().decode(MembershipRoom.self, from: $0) } : []
            let discovery = try Data.fetchAll(db, sql: "SELECT value FROM discovery ORDER BY id COLLATE BINARY").map { try JSONDecoder().decode(DiscoveredRoom.self, from: $0) }
            return RoomsListing(memberships: memberships, discovery: discovery, membershipConfirmed: confirmed,
                                discoveryComplete: try Bool.fetchOne(db, sql: "SELECT discoveryComplete FROM metadata")!,
                                cycle: confirmed ? try String.fetchOne(db, sql: "SELECT run FROM manifest WHERE complete=1") : nil)
        }
    }
    public func prepareCommand(_ intent: RoomCommandIntent) throws -> ManifestRequest {
        try write { db in
            guard intent.scope === scope,
                  try Bool.fetchOne(db, sql: "SELECT confirmed FROM metadata") == true,
                  try String.fetchOne(db, sql: "SELECT run FROM manifest WHERE complete=1") == intent.cycle else { throw RoomCommandError.confirmationChanged }
            let value = try Data.fetchOne(db, sql: "SELECT value FROM memberships WHERE id=?", arguments: [intent.roomID])
            switch intent.action {
            case .join:
                guard value == nil, try Bool.fetchOne(db, sql: "SELECT EXISTS(SELECT 1 FROM discovery WHERE id=?)", arguments: [intent.roomID]) == true else { throw RoomCommandError.confirmationChanged }
            case .leave:
                guard let value, try JSONDecoder().decode(MembershipRoom.self, from: value).membershipScope == intent.membershipScope else { throw RoomCommandError.confirmationChanged }
            }
            // All room A values can change. Keep old membership rows unconfirmed;
            // never use a partial/rejected mutation to delete membership evidence.
            try db.execute(sql: "DELETE FROM discovery; UPDATE metadata SET discoveryRevision=NULL,discoveryNext=NULL,discoveryComplete=0")
            return try startManifest(db)
        }
    }
    public func durabilitySettings() throws -> (String, Int) {
        try queue.read { db in (try String.fetchOne(db, sql: "PRAGMA journal_mode")!, try Int.fetchOne(db, sql: "PRAGMA synchronous")!) }
    }
}
