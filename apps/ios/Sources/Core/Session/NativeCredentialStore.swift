import Foundation
import Security
import Darwin

struct NativeCredential: Codable, Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    let token: String
    let expiresAt: Date
    let environment: NativeEnvironment
    var description: String { "NativeCredential(<redacted>)" }
    var debugDescription: String { description }
    var customMirror: Mirror { Mirror(self, children: ["credential": "<redacted>"]) }
    var isValid: Bool { Self.isOpaque(token) && expiresAt.timeIntervalSince1970.isFinite }
    static func isOpaque(_ value: String) -> Bool {
        value.utf8.count == 43 && value.utf8.allSatisfy { (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 }
    }
}
protocol NativeCredentialStoring: Sendable {
    func read() throws -> NativeCredential?
    @discardableResult func replace(expected: NativeCredential?, with value: NativeCredential?) throws -> Bool
    func logoutPending() throws -> Bool
    func setLogoutPending(_ pending: Bool) throws
    func completePendingLogout() throws
}
protocol CredentialBytesStoring: Sendable {
    func read() throws -> Data?
    func write(_ data: Data) throws
    func remove() throws
}
private struct KeychainCredentialBytes: CredentialBytesStoring {
    let service: String
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: "nativeCredential.v1", kSecAttrSynchronizable as String: false]
    }
    func read() throws -> Data? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw ProductError.secureStorage }
        return data
    }
    func write(_ data: Data) throws {
        let attributes: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound { status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil) }
        guard status == errSecSuccess else { throw ProductError.secureStorage }
    }
    func remove() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw ProductError.secureStorage }
    }
}
// Adapted KeychainService's access-token read/write/clear boundary. The original
// refresh/FCM keys and swallowed errors do not satisfy this native contract.
// Synchronous operations under one lock make compare-and-replace nonreentrant.
final class NativeCredentialStore: NativeCredentialStoring, @unchecked Sendable {
    private struct Marker: Codable {
        var schema = 1
        var installation = UUID()
        var logoutPending: Bool
    }
    private let lock = NSLock()
    private let environment: NativeEnvironment
    private let bytes: any CredentialBytesStoring
    private let directory: URL
    private var markerURL: URL { directory.appendingPathComponent("installation.json") }
    init(environment: NativeEnvironment, directory: URL? = nil, bytes: (any CredentialBytesStoring)? = nil) {
        self.environment = environment
        self.bytes = bytes ?? KeychainCredentialBytes(service: environment.keychainService)
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(environment.keychainService, isDirectory: true)
    }
    func logoutPending() throws -> Bool { try lock.withLock { try marker().logoutPending } }
    func setLogoutPending(_ pending: Bool) throws {
        try lock.withLock { var value = try marker(); value.logoutPending = pending; try saveMarker(value) }
    }
    func completePendingLogout() throws {
        try lock.withLock {
            var value = try marker()
            guard value.logoutPending else { throw ProductError.sessionChanged }
            // No replacement can be installed while this durable intent is set.
            // Remove even a corrupt retained record without decoding its secret.
            try bytes.remove()
            value.logoutPending = false
            try saveMarker(value)
        }
    }
    func read() throws -> NativeCredential? { try lock.withLock { _ = try marker(); return try readLocked() } }
    private func readLocked() throws -> NativeCredential? {
        guard let data = try bytes.read() else { return nil }
        guard let value = try? JSONDecoder().decode(NativeCredential.self, from: data),
              value.isValid, value.environment == environment else { throw ProductError.secureStorage }
        return value
    }
    @discardableResult func replace(expected: NativeCredential?, with value: NativeCredential?) throws -> Bool {
        try lock.withLock {
            let marker = try marker()
            guard try readLocked() == expected else { return false }
            if let value {
                guard !marker.logoutPending, value.isValid, value.environment == environment else { throw ProductError.secureStorage }
                try bytes.write(JSONEncoder().encode(value))
            } else { try bytes.remove() }
            return true
        }
    }
    private func marker() throws -> Marker {
        if FileManager.default.fileExists(atPath: markerURL.path) {
            guard let data = try? Data(contentsOf: markerURL), let marker = try? JSONDecoder().decode(Marker.self, from: data), marker.schema == 1 else {
                throw ProductError.secureStorage
            }
            return marker
        }
        // Keychain can survive uninstall. A missing, excluded-from-backup app marker
        // starts a new installation and removes the old credential before reading it.
        var value = Marker(logoutPending: true)
        try saveMarker(value)
        try bytes.remove()
        value.logoutPending = false
        try saveMarker(value)
        return value
    }
    private func saveMarker(_ value: Marker) throws {
        let temporary = directory.appendingPathComponent(".session-\(UUID().uuidString)")
        var descriptor: Int32 = -1
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            var directoryURL = directory
            var resources = URLResourceValues(); resources.isExcludedFromBackup = true
            try directoryURL.setResourceValues(resources)
            #if os(iOS)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: directory.path)
            #endif
            descriptor = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
            guard descriptor >= 0 else { throw ProductError.secureStorage }
            let data = try JSONEncoder().encode(value)
            try data.withUnsafeBytes { buffer in
                var offset = 0
                while offset < buffer.count {
                    let count = Darwin.write(descriptor, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
                    guard count > 0 else { throw ProductError.secureStorage }
                    offset += count
                }
            }
            guard fsync(descriptor) == 0 else { throw ProductError.secureStorage }
            close(descriptor); descriptor = -1
            guard rename(temporary.path, markerURL.path) == 0 else { throw ProductError.secureStorage }
            // Persist the newly created installation directory as well as the renamed marker.
            let parentFD = open(directory.deletingLastPathComponent().path, O_RDONLY | O_DIRECTORY)
            guard parentFD >= 0 else { throw ProductError.secureStorage }
            let parentSynced = fsync(parentFD) == 0
            close(parentFD)
            guard parentSynced else { throw ProductError.secureStorage }
            let directoryFD = open(directory.path, O_RDONLY | O_DIRECTORY)
            guard directoryFD >= 0 else { throw ProductError.secureStorage }
            defer { close(directoryFD) }
            guard fsync(directoryFD) == 0 else { throw ProductError.secureStorage }
        } catch {
            if descriptor >= 0 { close(descriptor) }
            try? FileManager.default.removeItem(at: temporary)
            throw ProductError.secureStorage
        }
    }
}
