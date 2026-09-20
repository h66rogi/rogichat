import Foundation
#if canImport(RogichatRooms)
import RogichatRooms
#endif

// Real native transport and one-shot provider completion; no bootstrap credentials.
actor NativeSessionService: SessionServing, AccountNotificationsServing, RoomsAuthorizing {
    nonisolated let capabilities: SessionCapabilities
    private let auth: (any SOOPAuthenticating)?
    private var authenticating = false
    private let environment: NativeEnvironment
    private let api: any NativeRequesting
    private let store: any NativeCredentialStoring
    private let now: @Sendable () -> Date
    private var clientScope = UUID()
    private var roomsScope: RoomsScope?
    private let purgeRooms: @Sendable () throws -> Void
    private var epoch: UInt64 = 0 { didSet { roomsScope?.invalidate(); roomsScope = nil; clientScope = UUID() } }
    private var validated: SessionSnapshot?
    private var activeCredential: NativeCredential?
    private var writingProfile = false
    private var profileRevision: UInt64 = 0
    private var logoutRequested = false
    private var preferenceRevision: UInt64 = 0
    private var roomCommand: (epoch: UInt64, id: UUID)?
    private var preferenceWrite: (epoch: UInt64, id: UUID)?
    init(environment: NativeEnvironment, api: any NativeRequesting, store: any NativeCredentialStoring,
         now: @escaping @Sendable () -> Date = { Date() }, auth: (any SOOPAuthenticating)? = nil, purgeRooms: @escaping @Sendable () throws -> Void = {}) {
        self.environment = environment; self.api = api; self.store = store; self.now = now; self.auth = auth; self.purgeRooms = purgeRooms
        self.capabilities = SessionCapabilities(signInMethods: auth == nil ? [] : [.soop], canLinkSOOP: auth != nil,
                                               canEditProfile: true, canSignOut: true, canResetLocalSession: store is any SOOPAuthStoring)
    }
    func restore() async throws -> SessionSnapshot {
        let wasAuthenticating = authenticating
        authenticating = false
        epoch &+= 1
        let ticket = epoch
        validated = nil; activeCredential = nil
        if wasAuthenticating { try (store as? any SOOPAuthStoring)?.cancelAuth(id: nil) }
        if wasAuthenticating { await auth?.closeBrowser(); guard ticket == epoch else { throw ProductError.sessionChanged } }
        try Task.checkCancellation()
        if try logoutRequested || store.logoutPending() {
            try store.setLogoutPending(true)
            try store.completePendingLogout()
            try purgeRoomStorage()
            logoutRequested = false
            return SessionSnapshot(access: .signedOut, account: nil,
                                   notice: ProductError.remoteLogoutUnconfirmed.errorDescription)
        }
        let recoveryNotice = try (store as? any SOOPAuthStoring)?.recoverAuth(now: now())
        guard let credential = try currentCredential() else {
            // Completes cache deletion after a crash between Keychain removal and
            // durable SQLite purge intent. No credential never admits old caches.
            try purgeRoomStorage()
            return SessionSnapshot(access: .signedOut, account: nil, notice: recoveryNotice)
        }
        do {
            let data = try await api.perform(.session, credential: credential)
            try requireCurrent(ticket, credential)
            let dto = try decode(NativeSessionDTO.self, data)
            var snapshot = try dto.snapshot(credential: credential, now: now())
            try (store as? any SOOPAuthStoring)?.reconcileAuth(accountID: snapshot.account?.id, serverGeneration: snapshot.serverGeneration)
            snapshot.notice = recoveryNotice
            try attachRooms(&snapshot)
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
                && snapshot.serverGeneration == previous.serverGeneration && snapshot.accountPartition == previous.accountPartition
            if !sameScope {
                try (store as? any SOOPAuthStoring)?.cancelAuth(id: nil)
                epoch &+= 1
            }
            else if revision != profileRevision { snapshot.account = validated?.account }
            try attachRooms(&snapshot)
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
    private func purgeRoomStorage() throws {
        do { try purgeRooms() } catch { throw ProductError.secureStorage }
    }
    private func attachRooms(_ snapshot: inout SessionSnapshot) throws {
        snapshot.clientScope = clientScope
        if snapshot.access == .ready, let partition = snapshot.accountPartition, let expiry = snapshot.expiresAt {
            if roomsScope?.partition != partition { roomsScope?.invalidate(); roomsScope = nil }
            if roomsScope == nil { roomsScope = try RoomsScope(partition: partition, clientScope: clientScope, expiresAt: expiry, now: now) }
            snapshot.roomsScope = roomsScope
        } else { roomsScope?.invalidate(); roomsScope = nil; snapshot.roomsScope = nil }
    }
    func roomsData(_ endpoint: RoomsEndpoint, scope: RoomsScope) async throws -> Data {
        guard scope === roomsScope, scope.clientScope == clientScope, scope.partition == validated?.accountPartition,
              validated?.access == .ready, let credential = activeCredential, let api = api as? any RoomsRequesting else { throw RoomsError.staleScope }
        try scope.check()
        let ticket = epoch
        try requireCurrent(ticket, credential)
        do {
            let data = try await api.performRooms(endpoint, credential: credential, scope: scope)
            try requireCurrent(ticket, credential); try scope.check()
            guard scope === roomsScope else { throw RoomsError.staleScope }
            return data
        } catch {
            guard ticket == epoch, scope === roomsScope else { throw RoomsError.staleScope }
            try requireCurrent(ticket, credential); try scope.check()
            if error as? ProductError == .unauthenticated { try clear(credential) }
            if error as? ProductError == .linkRequired { roomsScope?.invalidate(); roomsScope = nil; validated = nil; try purgeRoomStorage() }
            throw error
        }
    }
    func roomsCommand(_ intent: RoomCommandIntent) async throws -> Data {
        let scope = intent.scope
        guard scope === roomsScope, scope.clientScope == clientScope, scope.partition == validated?.accountPartition,
              validated?.access == .ready, let credential = activeCredential, let api = api as? any RoomsCommandRequesting else { throw RoomsError.staleScope }
        guard roomCommand?.epoch != epoch else { throw RoomCommandError.inProgress }
        try scope.check()
        let ticket = epoch; let operation = UUID()
        try requireCurrent(ticket, credential)
        roomCommand = (ticket, operation)
        defer { if roomCommand?.epoch == ticket, roomCommand?.id == operation { roomCommand = nil } }
        do {
            let data = try await api.performRoomsCommand(RoomsCommandEndpoint(action: intent.action, roomID: intent.roomID), credential: credential, scope: scope)
            try requireCurrent(ticket, credential); try scope.check()
            guard scope === roomsScope else { throw RoomsError.staleScope }
            return data
        } catch {
            guard ticket == epoch, scope === roomsScope else { throw RoomsError.staleScope }
            try requireCurrent(ticket, credential); try scope.check()
            if error as? ProductError == .unauthenticated { try clear(credential) }
            if error as? ProductError == .linkRequired { roomsScope?.invalidate(); roomsScope = nil; validated = nil; try purgeRoomStorage() }
            throw error
        }
    }
    func loadNotificationPreferences(scope: UUID) async throws -> AccountNotificationPreferences {
        guard scope == clientScope else { throw ProductError.sessionChanged }
        guard preferenceWrite?.epoch != epoch else { throw M11Error.superseded }
        let revision = preferenceRevision
        let value = try await preferences(.notificationPreferences, scope: scope)
        guard scope == clientScope else { throw ProductError.sessionChanged }
        guard revision == preferenceRevision else { throw M11Error.superseded }
        return value
    }
    func disableAccountNotifications(expected: PreferenceGeneration, scope: UUID) async throws -> AccountNotificationPreferences {
        guard scope == clientScope else { throw ProductError.sessionChanged }
        guard preferenceWrite?.epoch != epoch else { throw M11Error.superseded }
        let id = UUID()
        preferenceWrite = (epoch, id); preferenceRevision &+= 1
        defer { if preferenceWrite?.id == id { preferenceWrite = nil } }
        return try await preferences(.disableNotifications(DisableAccountNotifications(expectedGeneration: expected)), scope: scope)
    }
    private func preferences(_ endpoint: M11Endpoint, scope: UUID) async throws -> AccountNotificationPreferences {
        let data = try await accountM11(endpoint, scope: scope)
        guard scope == clientScope else { throw ProductError.sessionChanged }
        let value = try decode(AccountNotificationPreferences.self, data)
        if case .disableNotifications = endpoint, value.pushEnabled { throw ProductError.invalidResponse }
        return value
    }
    // Typed transport only. There are no product callers until C05/C06 supplies
    // actual display events and room/context lifetime; no queue/order is inferred.
    func loadOwnReadStates(room: ReadStateID, scope: UUID) async throws -> OwnReadStates {
        guard validated?.access == .ready else { throw ProductError.linkRequired }
        return try decode(OwnReadStates.self, await accountM11(.readState(room: room), scope: scope))
    }
    func reportOwnReadState(room: ReadStateID, input: ReportOwnReadState, scope: UUID) async throws -> OwnReadState {
        guard validated?.access == .ready else { throw ProductError.linkRequired }
        return try decode(OwnReadState.self, await accountM11(.reportReadState(room: room, input: input), scope: scope))
    }
    private func accountM11(_ endpoint: M11Endpoint, scope: UUID) async throws -> Data {
        guard scope == clientScope else { throw ProductError.sessionChanged }
        guard validated?.account != nil, let credential = activeCredential else { throw ProductError.unauthenticated }
        guard let api = api as? any M11Requesting else { throw ProductError.unavailable }
        let ticket = epoch
        try requireCurrent(ticket, credential)
        do {
            let data = try await api.performM11(endpoint, credential: credential)
            try requireCurrent(ticket, credential)
            return data
        } catch {
            guard ticket == epoch else { throw ProductError.sessionChanged }
            try Task.checkCancellation()
            if error as? ProductError == .unauthenticated {
                // requireCurrent may already have removed this expired credential.
                try clear(credential)
                throw ProductError.unauthenticated
            }
            try requireCurrent(ticket, credential)
            if error as? ProductError == .linkRequired { validated = nil }
            throw error
        }
    }
    func signOut() async throws {
        epoch &+= 1; authenticating = false
        validated = nil; activeCredential = nil
        // Persist intent first: if Keychain deletion fails, restoration must finish
        // that deletion instead of bringing the account back on retry or relaunch.
        logoutRequested = true
        try store.setLogoutPending(true)
        let credential = try store.read()
        guard try store.replace(expected: credential, with: nil) else { throw ProductError.sessionChanged }
        try purgeRoomStorage()
        try store.setLogoutPending(false)
        logoutRequested = false
        await auth?.closeBrowser()
        guard let credential else { return }
        do { _ = try await api.perform(.logout, credential: credential) }
        catch ProductError.unauthenticated { return }
        catch { throw ProductError.remoteLogoutUnconfirmed }
    }
    func signIn(_ method: SignInMethod) async throws -> SessionSnapshot { throw SOOPAuthError.consentRequired }
    func signInSOOP(consentVersion: String) async throws -> SessionSnapshot {
        try await authenticate(intent: .login, consentVersion: consentVersion)
    }
    func linkSOOP() async throws -> SessionSnapshot { try await authenticate(intent: .link, consentVersion: nil) }
    func beginSOOP(consentVersion: String, attempt: SessionAttempt) async throws -> SessionSnapshot { try await authenticate(intent: .login, consentVersion: consentVersion, attempt: attempt) }
    func beginLinkSOOP(attempt: SessionAttempt) async throws -> SessionSnapshot { try await authenticate(intent: .link, consentVersion: nil, attempt: attempt) }
    private func authenticate(intent: SOOPIntent, consentVersion: String?, attempt: SessionAttempt = SessionAttempt()) async throws -> SessionSnapshot {
        try attempt.check()
        guard let auth, !authenticating else { throw ProductError.unavailable }
        let original = try store.read()
        if intent == .login { guard original == nil else { throw SOOPAuthError.sessionChanged } }
        else { guard original == activeCredential, let account = validated?.account, account.id.isEmpty == false,
                     validated?.serverGeneration != nil else { throw SOOPAuthError.sessionChanged }
            try requireCurrent(epoch, original!)
        }
        guard let authStore = store as? any SOOPAuthStoring else { throw ProductError.secureStorage }
        guard intent == .login ? consentVersion == "2026-09-20" : consentVersion == nil else { throw SOOPAuthError.consentRequired }
        // All cancellation/logout methods share this actor, so reservation and local
        // epoch advance finish without suspension before the coordinator is entered.
        let pending = try authStore.beginAuth(intent: intent, proof: SOOPProof.generate(), expected: original,
                                              accountID: intent == .link ? validated?.account?.id : nil,
                                              serverGeneration: intent == .link ? validated?.serverGeneration : nil, now: now())
        authenticating = true
        epoch &+= 1; let ticket = epoch
        defer { if ticket == epoch { authenticating = false } }
        do {
            let result = try await auth.authenticate(pending: pending, consentVersion: consentVersion, attempt: attempt)
            guard ticket == epoch, try store.read() == result.credential, !Task.isCancelled else {
                await auth.discard(result); throw ProductError.sessionChanged
            }
            activeCredential = result.credential; validated = result.snapshot
            do { return try publication(result, auth: auth, store: authStore, attempt: attempt) }
            catch { await auth.discard(result); throw error }
        } catch {
            guard ticket == epoch else { throw ProductError.sessionChanged }
            if intent == .link, let original, error as? SOOPAuthError == .unauthenticated {
                try clear(original); epoch &+= 1; authenticating = false
                throw ProductError.unauthenticated
            }
            if intent == .link, error as? SOOPAuthError == .sessionChanged {
                authenticating = false
                var snapshot = try await revalidate()
                snapshot.notice = SOOPAuthError.sessionChanged.errorDescription
                return snapshot
            }
            throw error
        }
    }
    private func publication(_ result: SOOPAuthResult, auth: any SOOPAuthenticating, store: any SOOPAuthStoring, attempt: SessionAttempt = SessionAttempt()) throws -> SessionSnapshot {
        var snapshot = result.snapshot
        try attachRooms(&snapshot)
        validated = snapshot
        let clock = now
        snapshot.publication = SessionPublication(acknowledge: {
            try attempt.check()
            guard result.credential.expiresAt > clock() else { throw ProductError.unauthenticated }
            try store.acknowledgeAuth(id: result.id, credential: result.credential)
        }, discard: { await auth.discard(result) })
        return snapshot
    }
    func acceptAuthCallback(_ url: URL) async throws -> SessionSnapshot? {
        guard let auth, let authStore = store as? any SOOPAuthStoring else { throw ProductError.unavailable }
        let ticket = epoch
        let pending = try authStore.pendingAuth(now: now())
        do {
            guard let result = try await auth.accept(url) else { return nil }
            guard ticket == epoch, try store.read() == result.credential, !Task.isCancelled else {
                await auth.discard(result); throw ProductError.sessionChanged
            }
            epoch &+= 1; activeCredential = result.credential; validated = result.snapshot
            do { return try publication(result, auth: auth, store: authStore) }
            catch { await auth.discard(result); throw error }
        } catch {
            guard ticket == epoch else { throw ProductError.sessionChanged }
            if pending?.intent == .link, let original = pending?.originalCredential,
               error as? SOOPAuthError == .unauthenticated {
                try clear(original); epoch &+= 1
                throw ProductError.unauthenticated
            }
            if pending?.intent == .link, error as? SOOPAuthError == .sessionChanged {
                var snapshot = try await revalidate()
                snapshot.notice = SOOPAuthError.sessionChanged.errorDescription
                return snapshot
            }
            throw error
        }
    }
    func cancelAuthentication() async throws -> SessionSnapshot? {
        epoch &+= 1; authenticating = false
        let ticket = epoch
        try (store as? any SOOPAuthStoring)?.cancelAuth(id: nil)
        let signedOut = try store.read() == nil
        if signedOut { validated = nil; activeCredential = nil }
        await auth?.closeBrowser()
        guard ticket == epoch else { throw ProductError.sessionChanged }
        return signedOut ? .signedOut : nil
    }
    func resetLocalSession() async throws {
        epoch &+= 1; authenticating = false; validated = nil; activeCredential = nil; logoutRequested = true
        guard let authStore = store as? any SOOPAuthStoring else { throw ProductError.unavailable }
        try authStore.resetConfirmed()
        logoutRequested = false
        try purgeRoomStorage()
        await auth?.closeBrowser()
    }
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
        roomsScope?.invalidate(); roomsScope = nil
        activeCredential = nil; validated = nil
        try purgeRoomStorage()
    }
    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do { return try JSONDecoder().decode(type, from: data) }
        catch { throw ProductError.invalidResponse }
    }
}
