import Foundation

// Real credential transport only. No product path issues or imports a credential
// until provider completion is implemented against its committed server contract.
actor NativeSessionService: SessionServing {
    nonisolated let capabilities = SessionCapabilities(canEditProfile: true, canSignOut: true)
    private let environment: NativeEnvironment
    private let api: any NativeRequesting
    private let store: any NativeCredentialStoring
    private let now: @Sendable () -> Date
    private var epoch: UInt64 = 0
    private var validated: SessionSnapshot?
    private var activeCredential: NativeCredential?
    private var writingProfile = false
    private var profileRevision: UInt64 = 0
    private var logoutRequested = false
    init(environment: NativeEnvironment, api: any NativeRequesting, store: any NativeCredentialStoring,
         now: @escaping @Sendable () -> Date = { Date() }) {
        self.environment = environment; self.api = api; self.store = store; self.now = now
    }
    func restore() async throws -> SessionSnapshot {
        epoch &+= 1
        let ticket = epoch
        validated = nil; activeCredential = nil
        try Task.checkCancellation()
        if try logoutRequested || store.logoutPending() {
            try store.setLogoutPending(true)
            try store.completePendingLogout()
            logoutRequested = false
            return SessionSnapshot(access: .signedOut, account: nil,
                                   notice: ProductError.remoteLogoutUnconfirmed.errorDescription)
        }
        guard let credential = try currentCredential() else { return .signedOut }
        do {
            let data = try await api.perform(.session, credential: credential)
            try requireCurrent(ticket, credential)
            let dto = try decode(NativeSessionDTO.self, data)
            let snapshot = try dto.snapshot(credential: credential, now: now())
            validated = snapshot; activeCredential = credential
            return snapshot
        } catch {
            guard ticket == epoch else { throw ProductError.sessionChanged }
            try Task.checkCancellation()
            if error as? ProductError == .unauthenticated {
                try clear(credential)
                return .signedOut
            }
            throw error
        }
    }
    func revalidate() async throws -> SessionSnapshot {
        guard let previous = validated, let credential = activeCredential else { return try await restore() }
        let ticket = epoch
        let revision = profileRevision
        do {
            try requireCurrent(ticket, credential)
            let data = try await api.perform(.session, credential: credential)
            try requireCurrent(ticket, credential)
            var snapshot = try decode(NativeSessionDTO.self, data).snapshot(credential: credential, now: now())
            let sameScope = snapshot.account?.id == previous.account?.id && snapshot.access == previous.access
                && snapshot.serverGeneration == previous.serverGeneration
            if !sameScope { epoch &+= 1 }
            else if revision != profileRevision { snapshot.account = validated?.account }
            validated = snapshot; activeCredential = credential
            return snapshot
        } catch {
            guard ticket == epoch else { throw ProductError.sessionChanged }
            try Task.checkCancellation()
            if error as? ProductError == .unauthenticated {
                try clear(credential)
                epoch &+= 1
                return .signedOut
            }
            throw error
        }
    }
    func loadProfile() async throws -> AccountProfile { try await profile(.profile) }
    func updateProfile(_ update: ProfileUpdate) async throws -> AccountProfile {
        guard !writingProfile, update.isValid else { throw ProductError.unavailable }
        writingProfile = true
        defer { writingProfile = false }
        return try await profile(.updateProfile(update))
    }
    private func profile(_ endpoint: NativeEndpoint) async throws -> AccountProfile {
        guard let account = validated?.account, let credential = activeCredential else { throw ProductError.unauthenticated }
        let ticket = epoch
        try requireCurrent(ticket, credential)
        do {
            let data = try await api.perform(endpoint, credential: credential)
            try requireCurrent(ticket, credential)
            let profile = try decode(NativeProfileDTO.self, data).profile(expectedID: account.id)
            if case .updateProfile = endpoint {
                validated?.account?.displayName = profile.displayName
                validated?.account?.avatarAssetID = profile.avatarAssetID
                profileRevision &+= 1
            }
            return profile
        } catch {
            guard ticket == epoch else { throw ProductError.sessionChanged }
            try Task.checkCancellation()
            if error as? ProductError == .unauthenticated { try clear(credential) }
            if error as? ProductError == .linkRequired { validated = nil }
            throw error
        }
    }
    func signOut() async throws {
        epoch &+= 1
        validated = nil; activeCredential = nil
        // Persist intent first: if Keychain deletion fails, restoration must finish
        // that deletion instead of bringing the account back on retry or relaunch.
        logoutRequested = true
        try store.setLogoutPending(true)
        let credential = try store.read()
        guard try store.replace(expected: credential, with: nil) else { throw ProductError.sessionChanged }
        try store.setLogoutPending(false)
        logoutRequested = false
        guard let credential else { return }
        do { _ = try await api.perform(.logout, credential: credential) }
        catch ProductError.unauthenticated { return }
        catch { throw ProductError.remoteLogoutUnconfirmed }
    }
    func signIn(_ method: SignInMethod) async throws -> SessionSnapshot { throw ProductError.unavailable }
    func linkSOOP() async throws -> SessionSnapshot { throw ProductError.unavailable }
    func deleteAccount() async throws { throw ProductError.unavailable }
    private func currentCredential() throws -> NativeCredential? {
        guard let value = try store.read() else { return nil }
        guard value.isValid, value.environment == environment else { throw ProductError.secureStorage }
        guard value.expiresAt > now() else { try clear(value); return nil }
        return value
    }
    private func requireCurrent(_ ticket: UInt64, _ credential: NativeCredential) throws {
        try Task.checkCancellation()
        guard ticket == epoch, try store.read() == credential, !(try store.logoutPending()) else { throw ProductError.sessionChanged }
        if credential.expiresAt <= now() { try clear(credential); throw ProductError.unauthenticated }
    }
    private func clear(_ credential: NativeCredential) throws {
        let current = try store.read()
        if current != nil {
            guard current == credential, try store.replace(expected: credential, with: nil) else { throw ProductError.sessionChanged }
        }
        activeCredential = nil; validated = nil
    }
    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do { return try JSONDecoder().decode(type, from: data) }
        catch { throw ProductError.invalidResponse }
    }
}
