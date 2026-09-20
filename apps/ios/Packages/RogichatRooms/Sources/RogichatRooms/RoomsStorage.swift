import Foundation
import Darwin

// App-owned no-backup marker; never UserDefaults. A pending purge is completed
// before another database can open, including after process death.
public final class RoomsStorage: @unchecked Sendable {
    private struct Marker: Codable { var schema = 1; var deviceID = UUID().uuidString.lowercased(); var partition: String?; var pendingPurge = false }
    private let root: URL
    private let lock = NSRecursiveLock()
    private var active: RoomsDatabase?
    private let beforeDelete: @Sendable () throws -> Void
    private let beforeSave: @Sendable () throws -> Void
    public init(root: URL, beforeDelete: @escaping @Sendable () throws -> Void = {}, beforeSave: @escaping @Sendable () throws -> Void = {}) { self.root = root; self.beforeDelete = beforeDelete; self.beforeSave = beforeSave }
    public func open(scope: RoomsScope) throws -> RoomsDatabase {
        try lock.withLock {
            try scope.check()
            var marker = try loadMarker()
            if marker.pendingPurge { try finishPurge(&marker) }
            if let active, active.scope === scope { return active }
            if let active { active.scope.invalidate(); try active.close(); self.active = nil }
            if marker.partition != nil && marker.partition != scope.partition {
                marker.pendingPurge = true; try save(marker); try finishPurge(&marker)
            }
            marker.partition = scope.partition; try save(marker)
            let directory = root.appendingPathComponent("accounts", isDirectory: true).appendingPathComponent(scope.partition, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try RoomsDatabase.protectFiles(directory: directory)
            let database = try RoomsDatabase(url: directory.appendingPathComponent("rooms.sqlite"), scope: scope, deviceID: marker.deviceID)
            active = database
            return database
        }
    }
    public func purge() throws {
        try lock.withLock {
            active?.scope.invalidate()
            var marker = try loadMarker()
            marker.pendingPurge = true
            try save(marker) // If delete/close fails, next process must finish this.
            try finishPurge(&marker)
        }
    }
    private func finishPurge(_ marker: inout Marker) throws {
        if let active { active.scope.invalidate(); try active.close(); self.active = nil }
        try beforeDelete()
        let accounts = root.appendingPathComponent("accounts", isDirectory: true)
        if FileManager.default.fileExists(atPath: accounts.path) { try FileManager.default.removeItem(at: accounts) }
        marker.partition = nil; marker.pendingPurge = false
        try save(marker)
    }
    private func loadMarker() throws -> Marker {
        let path = root.appendingPathComponent("lifecycle.json")
        guard FileManager.default.fileExists(atPath: path.path) else {
            // A lost installation marker never admits surviving cache files.
            var marker = Marker(pendingPurge: true); try save(marker); try finishPurge(&marker); return marker
        }
        do {
            let marker = try JSONDecoder().decode(Marker.self, from: Data(contentsOf: path))
            guard marker.schema == 1, RoomsWire.uuid(marker.deviceID), marker.partition.map(RoomsWire.token) ?? true else { throw RoomsError.persistence }
            return marker
        } catch { throw RoomsError.persistence }
    }
    private func save(_ marker: Marker) throws {
        let temporary = root.appendingPathComponent(".pending-\(UUID().uuidString)")
        var descriptor: Int32 = -1
        do {
            try beforeSave()
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try RoomsDatabase.protectFiles(directory: root)
            descriptor = Darwin.open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
            guard descriptor >= 0 else { throw RoomsError.persistence }
            let bytes = try JSONEncoder().encode(marker)
            try bytes.withUnsafeBytes { buffer in
                var offset = 0
                while offset < buffer.count {
                    let count = Darwin.write(descriptor, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
                    guard count > 0 else { throw RoomsError.persistence }; offset += count
                }
            }
            guard fsync(descriptor) == 0 else { throw RoomsError.persistence }
            close(descriptor); descriptor = -1
            guard rename(temporary.path, root.appendingPathComponent("lifecycle.json").path) == 0 else { throw RoomsError.persistence }
            for directory in [root, root.deletingLastPathComponent()] {
                let fd = Darwin.open(directory.path, O_RDONLY | O_DIRECTORY)
                guard fd >= 0 else { throw RoomsError.persistence }
                let success = fsync(fd) == 0; close(fd)
                guard success else { throw RoomsError.persistence }
            }
        } catch {
            if descriptor >= 0 { close(descriptor) }
            try? FileManager.default.removeItem(at: temporary)
            throw RoomsError.persistence
        }
    }
}
