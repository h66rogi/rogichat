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
struct KeychainCredentialBytes: CredentialBytesStoring {
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
final class NativeCredentialStore: NativeSessionEpochReading, NativePushStoring, PasswordAuthStoring, AppleAuthStoring, AccountDeletionStoring, @unchecked Sendable {
    private struct Marker: Codable {
        var schema = 1
        var installation = UUID()
        var logoutPending: Bool
        var cancelledAuth: UUID? = nil
    }
    private struct Envelope: Codable {
        var schema = 3
        var credential: NativeCredential?
        var pushInstallation: StoredPushInstallation? = nil
        var pending: SOOPPending?
        var authEpoch = UUID()
        var installedByAuth: UUID? = nil
        var deletions: [AccountDeletionRecord]? = []
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
            // Preserve protected admission evidence; corrupt envelopes require
            // the separately confirmed device reset instead of automatic removal.
            var state = try envelope()
            guard admitsSession(state) else { throw ProductError.accountDeletionPending }
            state.credential = nil; state.pending = nil; state.installedByAuth = nil; state.authEpoch = UUID()
            try saveSessionCleared(state)
            value.logoutPending = false
            try saveMarker(value)
        }
    }
    func read() throws -> NativeCredential? { try lock.withLock { _ = try marker(); return try readLocked() } }
    private func envelope() throws -> Envelope {
        guard let data = try bytes.read() else { return Envelope() }
        guard data.count <= 65_536 else { throw ProductError.secureStorage }
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        if object?["schema"] != nil {
            guard var value = try? JSONDecoder().decode(Envelope.self, from: data), [2,3].contains(value.schema),
                  value.schema != 3 || value.deletions != nil else { throw ProductError.secureStorage }
            let records = value.deletions ?? []
            guard records.count <= 16, Set(records.map(\.id)).count == records.count,
                  records.allSatisfy({ $0.valid && $0.environment == environment && $0.installation == (try? marker().installation) }),
                  records.filter({ $0.cleanupPending || $0.phase != .finished }).count <= 1,
                  records.allSatisfy({ !$0.cleanupPending && $0.phase == .finished }) || (value.credential == nil && value.pending == nil && value.installedByAuth == nil) else { throw ProductError.secureStorage }
            value.schema = 3; value.deletions = records
            if let push = value.pushInstallation {
                _ = try push.validated()
                guard push.installationEpoch == (try marker().installation) else { throw ProductError.secureStorage }
            }
            guard value.credential.map({ $0.isValid && $0.environment == environment }) ?? true else { throw ProductError.secureStorage }
            if let pending = value.pending {
                guard pending.id == value.authEpoch, pending.environment == environment, pending.proof.valid,
                      (pending.intent == .login ? pending.originalCredential == nil && pending.accountID == nil && pending.serverGeneration == nil : pending.originalCredential?.isValid == true && pending.originalCredential?.environment == environment && UUID(uuidString: pending.accountID ?? "") != nil && NativeCredential.isOpaque(pending.serverGeneration ?? "")),
                      (pending.provider == nil || pending.provider == "apple" || pending.provider == "password"), pending.createdAt.timeIntervalSince1970.isFinite else { throw ProductError.secureStorage }
                if pending.phase == .starting {
                    guard pending.transactionID == nil, pending.authorizeURL == nil, pending.nativeNonce == nil, pending.nativeState == nil else { throw ProductError.secureStorage }
                } else {
                    if pending.provider == "password" {
                        guard pending.phase == .exchanging, pending.transactionID == nil, pending.authorizeURL == nil,
                              pending.nativeNonce == nil, pending.nativeState == nil else { throw ProductError.secureStorage }
                    } else if pending.provider == "apple" {
                        guard let transaction = pending.transactionID, UUID(uuidString: transaction) != nil,
                              pending.authorizeURL == nil, pending.nativeNonce.map(NativeCredential.isOpaque) == true,
                              pending.nativeState.map(NativeCredential.isOpaque) == true else { throw ProductError.secureStorage }
                    } else {
                    guard pending.nativeNonce == nil, pending.nativeState == nil,
                          let transaction = pending.transactionID, let url = pending.authorizeURL else { throw ProductError.secureStorage }
                    do { try SOOPStartResponse(transactionId: transaction, authorizeUrl: url, expiresIn: 600).validate(environment: environment) }
                    catch { throw ProductError.secureStorage }
                    }
                }
            }
            guard value.installedByAuth == nil || (value.credential != nil && value.pending == nil) else { throw ProductError.secureStorage }
            return try finishCancellation(value)
        }
        // Upgrade the previous token-only record on the next atomic write.
        guard let old = try? JSONDecoder().decode(NativeCredential.self, from: data), old.isValid, old.environment == environment else { throw ProductError.secureStorage }
        return Envelope(credential: old)
    }
    private func finishCancellation(_ input: Envelope) throws -> Envelope {
        var marker = try marker()
        guard let cancelled = marker.cancelledAuth else { return input }
        var state = input
        if state.pending?.id == cancelled || state.installedByAuth == cancelled {
            if state.installedByAuth == cancelled { state.credential = nil; state.installedByAuth = nil }
            state.pending = nil; state.authEpoch = UUID()
            try bytes.write(JSONEncoder().encode(state))
        }
        marker.cancelledAuth = nil; try saveMarker(marker)
        return state
    }
    private func saveEnvelope(_ value: Envelope) throws {
        let data = try JSONEncoder().encode(value)
        guard data.count <= 65_536, (value.deletions ?? []).count <= 16, (value.deletions ?? []).allSatisfy(\.valid) else { throw ProductError.secureStorage }
        try bytes.write(data)
    }
    private func saveSessionCleared(_ state: Envelope) throws {
        if (state.deletions ?? []).isEmpty && state.pushInstallation == nil { try bytes.remove() }
        else { try saveEnvelope(state) }
    }
    private func admitsSession(_ state: Envelope) -> Bool {
        (state.deletions ?? []).allSatisfy { !$0.cleanupPending && $0.phase == .finished }
    }
    private func readLocked() throws -> NativeCredential? {
        let state = try envelope()
        guard admitsSession(state) else { throw ProductError.accountDeletionPending }
        return state.credential
    }
    @discardableResult func replace(expected: NativeCredential?, with value: NativeCredential?) throws -> Bool {
        try lock.withLock {
            let marker = try marker()
            var state = try envelope()
            guard admitsSession(state), state.credential == expected else { return false }
            if let value {
                guard !marker.logoutPending, value.isValid, value.environment == environment else { throw ProductError.secureStorage }
                state.credential = value; state.pending = nil; state.installedByAuth = nil; state.authEpoch = UUID()
                try saveEnvelope(state)
            } else {
                state.credential = nil; state.pending = nil; state.installedByAuth = nil; state.authEpoch = UUID()
                try saveSessionCleared(state)
            }
            return true
        }
    }
    func sessionEpoch(expected: NativeCredential) throws -> UUID {
        try lock.withLock {
            let marker = try marker(); let state = try envelope()
            guard !marker.logoutPending, admitsSession(state), state.credential == expected, state.installedByAuth == nil else { throw ProductError.sessionChanged }
            return state.authEpoch
        }
    }
    func pushInstallation(expected: NativeCredential) throws -> StoredPushInstallation {
        try lock.withLock {
            let marker = try marker(); var state = try envelope()
            guard !marker.logoutPending, admitsSession(state), state.credential == expected else { throw ProductError.sessionChanged }
            if let value = state.pushInstallation { _ = try value.validated(); return value }
            let value = StoredPushInstallation(installationID: UUID().uuidString.lowercased(), bindingSecret: try SOOPProof.generate().verifier, installationEpoch: marker.installation)
            state.pushInstallation = value; try saveEnvelope(state); return value
        }
    }
    func updatePushInstallation(_ value: StoredPushInstallation, expected: NativeCredential) throws {
        try lock.withLock {
            let marker = try marker(); var state = try envelope()
            _ = try value.validated()
            guard !marker.logoutPending, admitsSession(state), state.credential == expected,
                  value.installationEpoch == marker.installation, state.pushInstallation?.installationID == value.installationID,
                  state.pushInstallation?.bindingSecret == value.bindingSecret else { throw ProductError.sessionChanged }
            state.pushInstallation = value; try saveEnvelope(state)
        }
    }
    func beginAuth(intent: SOOPIntent, proof: SOOPProof, expected: NativeCredential?, accountID: String?, serverGeneration: String?, now: Date) throws -> SOOPPending {
        try beginProviderAuth(provider: nil, intent: intent, proof: proof, expected: expected, accountID: accountID, serverGeneration: serverGeneration, now: now)
    }
    func beginPassword(expected: NativeCredential?, accountID: String?, serverGeneration: String?, now: Date) throws -> SOOPPending {
        try beginProviderAuth(provider: "password", intent: expected == nil ? .login : .link, proof: SOOPProof.generate(), expected: expected, accountID: accountID, serverGeneration: serverGeneration, now: now)
    }
    func beginApple(intent: SOOPIntent, proof: SOOPProof, expected: NativeCredential?, accountID: String?, serverGeneration: String?, now: Date) throws -> SOOPPending {
        try beginProviderAuth(provider: "apple", intent: intent, proof: proof, expected: expected, accountID: accountID, serverGeneration: serverGeneration, now: now)
    }
    private func beginProviderAuth(provider: String?, intent: SOOPIntent, proof: SOOPProof, expected: NativeCredential?, accountID: String?, serverGeneration: String?, now: Date) throws -> SOOPPending {
        try lock.withLock {
            let marker = try marker()
            var state = try envelope()
            guard !marker.logoutPending, admitsSession(state), state.installedByAuth == nil, state.credential == expected, proof.valid,
                  intent == .login ? expected == nil && accountID == nil && serverGeneration == nil : expected != nil && accountID != nil && serverGeneration != nil else { throw SOOPAuthError.sessionChanged }
            let id = UUID()
            var pending = SOOPPending(id: id, installation: marker.installation, environment: environment, intent: intent,
                                      proof: proof, createdAt: now, originalCredential: expected, accountID: accountID, serverGeneration: serverGeneration)
            pending.provider = provider
            if provider == "password" { pending.phase = .exchanging }
            state.pending = pending; state.authEpoch = id
            try saveEnvelope(state)
            return pending
        }
    }
    private func currentPending(_ state: Envelope, now: Date) throws -> SOOPPending {
        let marker = try marker()
        guard !marker.logoutPending, admitsSession(state), let pending = state.pending, pending.id == state.authEpoch,
              pending.installation == marker.installation, pending.originalCredential == state.credential else { throw SOOPAuthError.sessionChanged }
        guard pending.isCurrent(at: now) else { throw SOOPAuthError.expired }
        return pending
    }
    func pendingAuth(now: Date) throws -> SOOPPending? {
        try lock.withLock {
            _ = try marker(); let state = try envelope()
            guard state.pending != nil else { return nil }
            return try currentPending(state, now: now)
        }
    }
    func finishAuthStart(id: UUID, response: SOOPStartResponse, now: Date) throws -> SOOPPending {
        try lock.withLock {
            var state = try envelope(); var pending = try currentPending(state, now: now)
            guard pending.provider == nil, pending.id == id, pending.phase == .starting, now.timeIntervalSince(pending.createdAt) < 60 else { throw SOOPAuthError.expired }
            try response.validate(environment: environment)
            pending.transactionID = response.transactionId; pending.authorizeURL = response.authorizeUrl; pending.phase = .browser
            state.pending = pending; try saveEnvelope(state); return pending
        }
    }
    func finishAppleStart(id: UUID, transaction: String, nonce: String, state returnedState: String, now: Date) throws -> SOOPPending {
        try lock.withLock {
            var state = try envelope(); var pending = try currentPending(state, now: now)
            guard pending.provider == "apple", pending.id == id, pending.phase == .starting,
                  now.timeIntervalSince(pending.createdAt) < 60, UUID(uuidString: transaction) != nil,
                  NativeCredential.isOpaque(nonce), NativeCredential.isOpaque(returnedState) else { throw SOOPAuthError.expired }
            pending.transactionID = transaction; pending.nativeNonce = nonce; pending.nativeState = returnedState; pending.phase = .browser
            state.pending = pending; try saveEnvelope(state); return pending
        }
    }
    func claimAuthExchange(id: UUID, now: Date) throws -> SOOPPending {
        try lock.withLock {
            var state = try envelope(); var pending = try currentPending(state, now: now)
            guard pending.id == id, pending.phase == .browser, pending.transactionID != nil else { throw SOOPAuthError.failed }
            pending.phase = .exchanging; state.pending = pending
            try saveEnvelope(state) // Persist before network: never replay after a crash.
            return pending
        }
    }
    func installAuth(id: UUID, credential: NativeCredential, now: Date) throws {
        try lock.withLock {
            var state = try envelope(); let pending = try currentPending(state, now: now)
            guard pending.id == id, pending.phase == .exchanging, credential.isValid, credential.environment == environment,
                  credential.expiresAt > now else { throw SOOPAuthError.sessionChanged }
            state.credential = credential; state.pending = nil; state.authEpoch = UUID(); state.installedByAuth = id
            try saveEnvelope(state) // Credential + consumed proof/epoch commit in one Keychain update.
        }
    }
    func acknowledgeAuth(id: UUID, credential: NativeCredential) throws {
        try lock.withLock {
            let marker = try marker(); var state = try envelope()
            guard !marker.logoutPending, admitsSession(state), state.installedByAuth == id, state.credential == credential else { throw SOOPAuthError.sessionChanged }
            state.installedByAuth = nil; try saveEnvelope(state)
        }
    }
    func discardAuth(id: UUID, credential: NativeCredential) throws {
        try lock.withLock {
            var state = try envelope()
            guard state.installedByAuth == id, state.credential == credential else { return }
            var marker = try marker(); marker.cancelledAuth = id; try saveMarker(marker)
            state.credential = nil; state.installedByAuth = nil; state.pending = nil; state.authEpoch = UUID()
            try saveEnvelope(state)
            marker.cancelledAuth = nil; try saveMarker(marker)
        }
    }
    func cancelAuth(id: UUID? = nil) throws {
        try lock.withLock {
            var marker = try marker(); var state = try envelope()
            let current = state.pending?.id ?? state.installedByAuth
            if let id, current != id { return }
            guard let current else { return }
            // Durable nonsecret intent fences restoration even if Keychain update fails.
            marker.cancelledAuth = current; try saveMarker(marker)
            if state.installedByAuth != nil { state.credential = nil; state.installedByAuth = nil }
            state.pending = nil; state.authEpoch = UUID(); try saveEnvelope(state)
            marker.cancelledAuth = nil; try saveMarker(marker)
        }
    }
    func reconcileAuth(accountID: String?, serverGeneration: String?) throws {
        try lock.withLock {
            _ = try marker(); var state = try envelope()
            guard let pending = state.pending, pending.intent == .link else { return }
            if pending.accountID != accountID || pending.serverGeneration != serverGeneration {
                state.pending = nil; state.authEpoch = UUID(); try saveEnvelope(state)
            }
        }
    }
    func recoverAuth(now: Date) throws -> String? {
        try lock.withLock {
            _ = try marker(); var state = try envelope()
            if state.installedByAuth != nil {
                // A crash before UI acknowledgement never restores an unpublished login.
                var marker = try marker(); marker.cancelledAuth = state.installedByAuth; try saveMarker(marker)
                state = try finishCancellation(state)
                return SOOPAuthError.exchangeUncertain.errorDescription
            }
            guard let pending = state.pending else { return nil }
            if pending.provider == "apple" || !pending.isCurrent(at: now) || pending.phase != .browser {
                state.pending = nil; state.authEpoch = UUID(); try saveEnvelope(state)
                return (pending.isCurrent(at: now) ? SOOPAuthError.exchangeUncertain : .expired).errorDescription
            }
            return nil
        }
    }
    func resetConfirmed() throws {
        try lock.withLock {
            // Explicit user recovery also handles corrupt records without decoding them.
            var marker = Marker(logoutPending: true)
            try saveMarker(marker)
            try bytes.remove()
            marker.logoutPending = false
            try saveMarker(marker)
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

extension NativeCredentialStore {
    func deletionRecords() throws -> [AccountDeletionRecord] { try lock.withLock { _ = try marker(); return try envelope().deletions ?? [] } }
    func reserveDeletion(_ intent: AccountDeletionIntent, expected: NativeCredential) throws -> AccountDeletionRecord {
        try lock.withLock {
            let install = try marker(); var state = try envelope()
            guard !install.logoutPending, admitsSession(state), state.credential == expected, state.installedByAuth == nil,
                  UUID(uuidString: intent.accountID) != nil else { throw ProductError.sessionChanged }
            guard (state.deletions ?? []).count < 16 else { throw ProductError.deletionHistoryFull }
            state.authEpoch = UUID(); state.pending = nil; state.credential = nil
            let record = AccountDeletionRecord(id: intent.id, installation: install.installation, environment: environment,
                accountID: intent.accountID, clientScope: intent.clientScope, fingerprint: AccountDeletionRecord.fingerprint(expected),
                authEpoch: state.authEpoch, quarantine: expected)
            state.deletions = (state.deletions ?? []) + [record]
            try saveEnvelope(state)
            return record
        }
    }
    private func deletionIndex(_ record: AccountDeletionRecord, state: Envelope) throws -> Int {
        guard try marker().installation == record.installation,
              let index = state.deletions?.firstIndex(where: { $0.id == record.id && $0.installation == record.installation && $0.fingerprint == record.fingerprint }) else { throw ProductError.sessionChanged }
        return index
    }
    func claimDeletion(_ record: AccountDeletionRecord) throws -> AccountDeletionRecord {
        try lock.withLock {
            var state = try envelope(); let i = try deletionIndex(record, state: state)
            var current = state.deletions![i]
            guard current.revision == record.revision, current.phase == .preparing, state.authEpoch == current.authEpoch,
                  !(try marker().logoutPending), state.credential == nil else { throw ProductError.sessionChanged }
            current.phase = .dispatchClaimed; current.outcome = .unknown; current.revision += 1
            state.deletions![i] = current; try saveEnvelope(state); return current
        }
    }
    func classifyDeletion(_ record: AccountDeletionRecord, response: AccountDeletionResponse) throws -> AccountDeletionRecord {
        try lock.withLock {
            var state = try envelope(); let i = try deletionIndex(record, state: state)
            var current = state.deletions![i]
            // A late result can only upgrade its own retained unknown record. It
            // cannot replace the whole envelope or touch a new account's session.
            guard current.revision == record.revision || (current.outcome == .unknown && response.receipt != nil) else { throw ProductError.sessionChanged }
            current.outcome = response.outcome; current.receipt = response.receipt; current.phase = .finished; current.revision += 1
            if response != .recentAuth { current.quarantine = nil }
            state.deletions![i] = current; try saveEnvelope(state); return current
        }
    }
    func verifyDeletionCleanup(_ record: AccountDeletionRecord) throws {
        try lock.withLock {
            let state = try envelope(); let i = try deletionIndex(record, state: state)
            guard state.deletions![i].revision == record.revision, state.deletions![i].cleanupPending,
                  state.credential == nil, state.pending == nil, state.installedByAuth == nil else { throw ProductError.sessionChanged }
        }
    }
    func finishDeletion(_ record: AccountDeletionRecord) throws -> AccountDeletionRecord {
        try lock.withLock {
            var state = try envelope(); let i = try deletionIndex(record, state: state)
            var current = state.deletions![i]
            guard current.revision == record.revision, current.phase == .finished else { throw ProductError.sessionChanged }
            current.quarantine = nil; current.cleanupPending = false; current.revision += 1
            state.deletions![i] = current; try saveEnvelope(state); return current
        }
    }
    func releaseDeletion(_ record: AccountDeletionRecord, now: Date) throws -> NativeCredential {
        try lock.withLock {
            var state = try envelope(); let i = try deletionIndex(record, state: state)
            var current = state.deletions![i]
            guard current.revision == record.revision, current.outcome == .recentAuthRequired, current.phase == .finished,
                  state.authEpoch == current.authEpoch, !(try marker().logoutPending), state.credential == nil,
                  state.pending == nil, state.installedByAuth == nil, let original = current.quarantine, original.expiresAt > now,
                  AccountDeletionRecord.fingerprint(original) == current.fingerprint else { throw ProductError.sessionChanged }
            state.credential = original; state.authEpoch = UUID()
            current.quarantine = nil; current.cleanupPending = false; current.released = true; current.revision += 1
            state.deletions![i] = current; try saveEnvelope(state); return original
        }
    }
    func recoverDeletion(_ record: AccountDeletionRecord) throws -> AccountDeletionRecord {
        try lock.withLock {
            var state = try envelope(); let i = try deletionIndex(record, state: state)
            var current = state.deletions![i]
            if current.phase != .finished { current.outcome = .unknown; current.receipt = nil; current.phase = .finished }
            if current.released, let credential = state.credential, AccountDeletionRecord.fingerprint(credential) == current.fingerprint {
                state.credential = nil; state.pending = nil; state.installedByAuth = nil; state.authEpoch = UUID()
                current.cleanupPending = true
            }
            current.released = false; current.quarantine = nil; current.revision += 1
            state.deletions![i] = current; try saveEnvelope(state); return current
        }
    }
}

protocol NativeSessionEpochReading: Sendable {
    func sessionEpoch(expected: NativeCredential) throws -> UUID
}
