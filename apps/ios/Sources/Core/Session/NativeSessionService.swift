import Foundation
#if canImport(RogichatRooms)
import RogichatRooms
#endif

// Real native transport and one-shot provider completion; no bootstrap credentials.
actor NativeSessionService: AccountFeatureAuthorizing, NativeRealtimeServing, NativePushServing, SessionServing, AccountNotificationsServing, RoomsAuthorizing, AccountDeletionServing, ConversationAuthorizing {
    nonisolated let capabilities: SessionCapabilities
    private let auth: (any SOOPAuthenticating)?
    private var deletionTask: Task<AccountDeletionUpdate, any Error>?
    private var observedDeletion: (record: AccountDeletionRecord, response: AccountDeletionResponse, persisted: Bool)?
    private var deletionPermit: AccountDeletionPermit?
    private var authenticating = false
    private let environment: NativeEnvironment
    private let api: any NativeRequesting
    private let store: any NativeCredentialStoring
    private let now: @Sendable () -> Date
    private var admittedText: Set<String> = []
    private var clientScope = UUID()
    private var roomsScope: RoomsScope?
    private let purgeRooms: @Sendable () throws -> Void
    private var requestAttempt = SessionAttempt()
    private var epoch: UInt64 = 0 { didSet { requestAttempt.cancel(); requestAttempt = SessionAttempt(); admittedText = []; roomsScope?.invalidate(); roomsScope = nil; clientScope = UUID() } }
    private var validated: SessionSnapshot?
    private var activeCredential: NativeCredential?
    private var writingProfile = false
    private var profileRevision: UInt64 = 0
    private var logoutRequested = false
    private var preferenceRevision: UInt64 = 0
    private var roomCommand: (epoch: UInt64, id: UUID)?
    private var pushWriting: (epoch: UInt64, id: UUID)?
    private var preferenceWrite: (epoch: UInt64, id: UUID)?
    init(environment: NativeEnvironment, api: any NativeRequesting, store: any NativeCredentialStoring,
         now: @escaping @Sendable () -> Date = { Date() }, auth: (any SOOPAuthenticating)? = nil, appleEnabled: Bool = false, purgeRooms: @escaping @Sendable () throws -> Void = {}) {
        self.environment = environment; self.api = api; self.store = store; self.now = now; self.auth = auth; self.purgeRooms = purgeRooms
        self.capabilities = SessionCapabilities(signInMethods: auth == nil ? [] : (appleEnabled ? [.apple, .soop] : [.soop]), canLinkSOOP: auth != nil, canLinkApple: appleEnabled,
                                               canEditProfile: true, canSignOut: true, canDeleteAccount: store is any AccountDeletionStoring && api is any AccountDeletionRequesting, canResetLocalSession: store is any SOOPAuthStoring)
    }
    func restore() async throws -> SessionSnapshot {
        if deletionTask != nil { return try deletionSnapshot(access: .accountClosing) }
        if let recovered = try recoverDeletionOnStart() { return recovered }
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
            return SessionSnapshot(access: .signedOut, account: nil, notice: recoveryNotice, deletions: try deletionPresentations())
        }
        do {
            let data = try await api.perform(.session, credential: credential)
            try requireCurrent(ticket, credential)
            let dto = try decode(NativeSessionDTO.self, data)
            var snapshot = try dto.snapshot(credential: credential, now: now())
            try (store as? any SOOPAuthStoring)?.reconcileAuth(accountID: snapshot.account?.id, serverGeneration: snapshot.serverGeneration)
            snapshot.notice = recoveryNotice
            try attachRooms(&snapshot)
            snapshot.deletions = try deletionPresentations()
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
        if deletionTask != nil { return try deletionSnapshot(access: .accountClosing) }
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
    func accountFeatureData(_ input: ConversationFeatureRequest, scope: RoomsScope) async throws -> Data {
        guard scope === roomsScope, scope.clientScope == clientScope, validated?.access == .ready,
              let credential = activeCredential, let api = api as? any AccountFeatureRequesting else { throw ProductError.sessionChanged }
        try scope.check(); let ticket = epoch; try requireCurrent(ticket, credential)
        let changingAvatar = input.path == "me/profile" && input.method == "PATCH"
        let accountID = validated?.account?.id
        if changingAvatar { guard !writingProfile else { throw ProductError.unavailable }; writingProfile = true; profileRevision &+= 1 }
        defer { if changingAvatar { writingProfile = false } }
        do {
            let data = try await api.performAccountFeature(input, credential: credential, scope: scope)
            try requireCurrent(ticket, credential); try scope.check()
            if changingAvatar {
                guard let accountID else { throw ProductError.sessionChanged }
                let profile = try decode(NativeProfileDTO.self, data).profile(expectedID: accountID)
                validated?.account?.displayName = profile.displayName; validated?.account?.avatarAssetID = profile.avatarAssetID
                profileRevision &+= 1
            }
            return data
        } catch {
            try requireCurrent(ticket, credential); try scope.check()
            if error as? ProductError == .unauthenticated { try clear(credential) }
            throw error
        }
    }
    func conversationData(_ endpoint: ConversationEndpoint, scope: ConversationScope) async throws -> Data {
        guard scope.account === roomsScope, scope.account.clientScope == clientScope, scope.account.partition == validated?.accountPartition,
              validated?.access == .ready, let credential = activeCredential, let api = api as? any ConversationRequesting else { throw ConversationError.staleScope }
        try scope.check()
        let ticket = epoch
        try requireCurrent(ticket, credential)
        if case .send(let command) = endpoint {
            guard admittedText.insert(command.roomID + ":" + command.id).inserted else { throw ConversationError.busy }
        }
        do {
            let data = try await api.performConversation(endpoint, credential: credential, scope: scope)
            try requireCurrent(ticket, credential); try scope.check()
            guard scope.account === roomsScope else { throw ConversationError.staleScope }
            return data
        } catch {
            guard ticket == epoch, scope.account === roomsScope else { throw ConversationError.staleScope }
            try requireCurrent(ticket, credential); try scope.check()
            if error as? ProductError == .unauthenticated { try clear(credential) }
            if error as? ProductError == .linkRequired { roomsScope?.invalidate(); roomsScope = nil; validated = nil; try purgeRoomStorage() }
            throw error
        }
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
    func realtimeOffer(scope: UUID) throws -> NativeRealtimeOffer {
        guard scope == clientScope, validated?.access == .ready, let credential = activeCredential,
              let account = validated?.account, let generation = validated?.serverGeneration,
              let store = store as? any NativeSessionEpochReading else { throw ProductError.sessionChanged }
        try requireCurrent(epoch, credential)
        return NativeRealtimeOffer(scope: RealtimeScope(environment: environment.rawValue, accountID: account.id,
            accountGeneration: generation, sessionEpoch: try store.sessionEpoch(expected: credential)), bearer: credential.token)
    }
    func pushCapabilities(scope: UUID) async throws -> NativePushCapabilities {
        guard scope == clientScope, validated?.access == .ready, let credential = activeCredential,
              let api = api as? any NativePushRequesting else { throw ProductError.linkRequired }
        let ticket = epoch; try requireCurrent(ticket, credential)
        do {
            let value = try NativePushContract.capabilities(await api.performNativePush(.capabilities, credential: credential, admission: admission(credential)))
            try requireCurrent(ticket, credential); return value
        } catch {
            try requireCurrent(ticket, credential)
            if error as? ProductError == .unauthenticated { try clear(credential) }
            throw error
        }
    }
    func enablePush(token: DevicePushToken, scope: UUID, permission: @escaping @Sendable () async -> PushPermission, original: @escaping @Sendable () throws -> Void = {}) async throws -> AccountNotificationPreferences {
        try original()
        guard scope == clientScope, validated?.access == .ready, let credential = activeCredential,
              let api = api as? any NativePushRequesting, let store = store as? any NativePushStoring,
              pushWriting?.epoch != epoch, preferenceWrite?.epoch != epoch else { throw ProductError.sessionChanged }
        let ticket = epoch; try requireCurrent(ticket, credential)
        let id = UUID(); pushWriting = (ticket, id); preferenceWrite = (ticket, id); preferenceRevision &+= 1
        defer { if pushWriting?.id == id { pushWriting = nil }; if preferenceWrite?.id == id { preferenceWrite = nil } }
        do {
            let capabilities = try NativePushContract.capabilities(await api.performNativePush(.capabilities, credential: credential, admission: admission(credential, original: original)))
            try requireCurrent(ticket, credential)
            guard capabilities.available else { throw ProductError.unavailable }
            var protected = try store.pushInstallation(expected: credential)
            let installation = try protected.validated()
            // Always resolve before a new explicit attempt, including cold or unknown registration.
            let existing = try NativePushContract.binding(await api.performNativePush(.resolve(installation), credential: credential, admission: admission(credential, original: original)))
            try requireCurrent(ticket, credential)
            protected.generation = existing?.generation; protected.bindingID = existing?.id; protected.unknown = false
            try store.updatePushInstallation(protected, expected: credential)
            protected.unknown = true; try store.updatePushInstallation(protected, expected: credential)
            let registered = try NativePushContract.registration(await api.performNativePush(.register(installation, token, protected.generation), credential: credential, admission: admission(credential, permission: permission, original: original)))
            try requireCurrent(ticket, credential)
            protected.generation = registered.generation; protected.bindingID = registered.id; protected.unknown = false
            try store.updatePushInstallation(protected, expected: credential)
            let latest = try await preferences(.notificationPreferences, scope: scope, original: original)
            try requireCurrent(ticket, credential)
            let enabled = try await preferences(.enableNotifications(latest.generation), scope: scope, permission: permission, original: original)
            guard enabled.pushEnabled else { throw ProductError.invalidResponse }
            return enabled
        } catch {
            try requireCurrent(ticket, credential)
            if error as? ProductError == .unauthenticated { try clear(credential) }
            throw error // No register or ON replay. A fresh explicit choice begins with resolve/GET.
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
    private func preferences(_ endpoint: M11Endpoint, scope: UUID, permission: (@Sendable () async -> PushPermission)? = nil, original: @escaping @Sendable () throws -> Void = {}) async throws -> AccountNotificationPreferences {
        let data = try await accountM11(endpoint, scope: scope, permission: permission, original: original)
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
    private func accountM11(_ endpoint: M11Endpoint, scope: UUID, permission: (@Sendable () async -> PushPermission)? = nil, original: @escaping @Sendable () throws -> Void = {}) async throws -> Data {
        guard scope == clientScope else { throw ProductError.sessionChanged }
        guard validated?.account != nil, let credential = activeCredential else { throw ProductError.unauthenticated }
        guard let api = api as? any M11Requesting else { throw ProductError.unavailable }
        let ticket = epoch
        try requireCurrent(ticket, credential)
        do {
            let data = try await api.performM11(endpoint, credential: credential, admission: admission(credential, permission: permission, original: original))
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
        guard deletionTask == nil else { throw ProductError.accountDeletionPending }
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
    func beginApple(consentVersion: String?, link: Bool, attempt: SessionAttempt) async throws -> SessionSnapshot {
        guard capabilities.signInMethods.contains(.apple) else { throw ProductError.unavailable }
        return try await authenticate(intent: link ? .link : .login, consentVersion: consentVersion, attempt: attempt, apple: true)
    }
    private func authenticate(intent: SOOPIntent, consentVersion: String?, attempt: SessionAttempt = SessionAttempt(), apple: Bool = false) async throws -> SessionSnapshot {
        try attempt.check()
        guard deletionTask == nil, !logoutRequested else { throw ProductError.accountDeletionPending }
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
        let pending: SOOPPending
        if apple {
            guard let appleStore = authStore as? any AppleAuthStoring else { throw ProductError.secureStorage }
            pending = try appleStore.beginApple(intent: intent, proof: SOOPProof.generate(), expected: original,
                accountID: intent == .link ? validated?.account?.id : nil, serverGeneration: intent == .link ? validated?.serverGeneration : nil, now: now())
        } else {
            pending = try authStore.beginAuth(intent: intent, proof: SOOPProof.generate(), expected: original,
                accountID: intent == .link ? validated?.account?.id : nil, serverGeneration: intent == .link ? validated?.serverGeneration : nil, now: now())
        }
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
        guard deletionTask == nil, !logoutRequested else { throw ProductError.accountDeletionPending }
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
        guard deletionTask == nil else { throw ProductError.accountDeletionPending }
        epoch &+= 1; authenticating = false
        let ticket = epoch
        try (store as? any SOOPAuthStoring)?.cancelAuth(id: nil)
        let signedOut = try store.read() == nil
        if signedOut { validated = nil; activeCredential = nil }
        await auth?.closeBrowser()
        guard ticket == epoch else { throw ProductError.sessionChanged }
        return signedOut ? .signedOut : nil
    }
    func resetLocalSession() async throws { try await resetLocalSession(attempt: SessionAttempt()) }
    func resetLocalSession(attempt: SessionAttempt) async throws {
        try attempt.check()
        guard deletionTask == nil else { throw ProductError.accountDeletionPending }
        deletionPermit?.cancel(); deletionPermit = nil
        epoch &+= 1; authenticating = false; validated = nil; activeCredential = nil; logoutRequested = true
        guard let authStore = store as? any SOOPAuthStoring else { throw ProductError.unavailable }
        try purgeRoomStorage() // Do not erase protected evidence before local cleanup succeeds.
        try authStore.resetConfirmed()
        observedDeletion = nil; logoutRequested = false
        await auth?.closeBrowser()
    }
    func deleteAccount() async throws { throw ProductError.unavailable }
    private func currentCredential() throws -> NativeCredential? {
        guard let value = try store.read() else { return nil }
        guard value.isValid, value.environment == environment else { throw ProductError.secureStorage }
        guard value.expiresAt > now() else { try clear(value); return nil }
        return value
    }
    private func admission(_ credential: NativeCredential, permission: (@Sendable () async -> PushPermission)? = nil, original: @escaping @Sendable () throws -> Void = {}) -> NativeRequestAdmission {
        let attempt = requestAttempt, store = store, now = now
        return NativeRequestAdmission(check: {
            try original(); try attempt.check()
            guard try store.read() == credential, !(try store.logoutPending()) else { throw ProductError.sessionChanged }
            guard credential.expiresAt > now() else { throw ProductError.unauthenticated }
        }, permission: permission)
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
        requestAttempt.cancel(); requestAttempt = SessionAttempt()
        roomsScope?.invalidate(); roomsScope = nil
        activeCredential = nil; validated = nil
        try purgeRoomStorage()
    }
    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do { return try JSONDecoder().decode(type, from: data) }
        catch { throw ProductError.invalidResponse }
    }
}

extension NativeSessionService {
    private func deletionPresentations() throws -> [AccountDeletionPresentation] {
        try (store as? any AccountDeletionStoring)?.deletionRecords().map(\.presentation) ?? []
    }
    private func deletionSnapshot(access: ShellAccess = .signedOut) throws -> SessionSnapshot {
        SessionSnapshot(access: access, account: nil, deletions: try deletionPresentations())
    }
    // A pending protected record blocks every credential writer. Combined with
    // the service actor, this admits the existing synchronous purge only for its
    // original owner, never an old callback after B has installed a credential.
    private func cleanupDeletion(_ record: AccountDeletionRecord, store: any AccountDeletionStoring) throws -> AccountDeletionRecord {
        guard activeCredential == nil, validated == nil else { throw ProductError.sessionChanged }
        try store.verifyDeletionCleanup(record)
        try purgeRoomStorage()
        return try store.finishDeletion(record)
    }
    private func recoverDeletionOnStart() throws -> SessionSnapshot? {
        guard let store = store as? any AccountDeletionStoring else { return nil }
        if let observed = observedDeletion, !observed.persisted {
            let saved = try store.classifyDeletion(observed.record, response: observed.response)
            observedDeletion = (saved, observed.response, true)
        }
        let records = try store.deletionRecords()
        let pending = records.filter { $0.cleanupPending || $0.phase != .finished || $0.released }
        guard !pending.isEmpty else { return nil }
        var retiredOriginal = false
        for record in pending {
            // A cleaned A's historical released flag is not authority to close B.
            let originalCurrent: Bool
            if record.cleanupPending || record.phase != .finished { originalCurrent = true }
            else {
                let current = try store.read()
                originalCurrent = current.map { AccountDeletionRecord.fingerprint($0) == record.fingerprint } ?? false
            }
            if originalCurrent && !retiredOriginal { epoch &+= 1; validated = nil; activeCredential = nil; retiredOriginal = true }
            let recovered = try store.recoverDeletion(record)
            if recovered.cleanupPending { _ = try cleanupDeletion(recovered, store: store) }
        }
        if retiredOriginal, try store.read() == nil {
            let snapshot = try deletionSnapshot(); observedDeletion = nil; return snapshot
        }
        observedDeletion = nil
        return nil
    }
    func admitDeletion(_ intent: AccountDeletionIntent) async throws -> AccountDeletionUpdate {
        guard deletionTask == nil, !authenticating, intent.clientScope == clientScope,
              validated?.account?.id == intent.accountID, let credential = activeCredential,
              let store = store as? any AccountDeletionStoring, let api = api as? any AccountDeletionRequesting else { throw ProductError.sessionChanged }
        try requireCurrent(epoch, credential)
        let record = try store.reserveDeletion(intent, expected: credential)
        epoch &+= 1; let ticket = epoch
        validated = nil; activeCredential = nil
        let permit = AccountDeletionPermit(expiresAt: credential.expiresAt, now: now); deletionPermit = permit
        // Reserve protected proof and local epoch before the first actor suspension.
        let owned = Task { try await self.runDeletion(record, credential: credential, ticket: ticket, permit: permit, store: store, api: api) }
        deletionTask = owned
        defer { if ticket == epoch { deletionTask = nil; deletionPermit = nil } }
        return try await owned.value
    }
    private func runDeletion(_ original: AccountDeletionRecord, credential: NativeCredential, ticket: UInt64,
                             permit: AccountDeletionPermit, store: any AccountDeletionStoring, api: any AccountDeletionRequesting) async throws -> AccountDeletionUpdate {
        var record = original
        do {
            guard ticket == epoch else { throw ProductError.sessionChanged }
            try store.verifyDeletionCleanup(record)
            try purgeRoomStorage() // Durable close/delete and marker success before dispatch.
            record = try store.claimDeletion(record)
        } catch {
            // No HTTP yet. Persist conservative recovery if possible, never replay.
            permit.cancel()
            throw error
        }
        await auth?.closeBrowser()
        guard ticket == epoch else { permit.cancel(); throw ProductError.sessionChanged }
        let response: AccountDeletionResponse
        do { response = try await api.performAccountDeletion(credential: credential, permit: permit) }
        catch { response = .unknown }
        guard ticket == epoch else {
            // Even in a future lifecycle which allows a later completion, only
            // the old protected record is eligible for update.
            _ = try? store.classifyDeletion(record, response: response)
            throw ProductError.sessionChanged
        }
        observedDeletion = (record, response, false)
        record = try store.classifyDeletion(record, response: response)
        observedDeletion = (record, response, true)
        if response == .recentAuth {
            do {
                let restored = try store.releaseDeletion(record, now: now())
                let data = try await self.api.perform(.session, credential: restored)
                try requireCurrent(ticket, restored)
                var snapshot = try decode(NativeSessionDTO.self, data).snapshot(credential: restored, now: now())
                guard snapshot.account?.id == record.accountID else { throw ProductError.sessionChanged }
                try attachRooms(&snapshot)
                snapshot.deletions = try deletionPresentations()
                validated = snapshot; activeCredential = restored
                let result = AccountDeletionUpdate(presentation: snapshot.deletions!.first(where: { $0.id == record.id })!, snapshot: snapshot)
                observedDeletion = nil
                return result
            } catch {
                // Never present a locally restored account when real revalidation
                // failed. Cold/retry recovery removes only this original token.
                throw error
            }
        }
        record = try cleanupDeletion(record, store: store)
        let result = AccountDeletionUpdate(presentation: record.presentation, snapshot: try deletionSnapshot())
        observedDeletion = nil
        return result
    }
    func deletionStatus(id: UUID) async throws -> AccountDeletionPresentation {
        if let observed = observedDeletion, observed.record.id == id {
            return AccountDeletionPresentation(id: id, outcome: observed.response.outcome, requestID: observed.response.receipt?.requestId, cleanupPending: true, accountID: observed.record.accountID)
        }
        guard let store = store as? any AccountDeletionStoring,
              let record = try store.deletionRecords().first(where: { $0.id == id }) else { throw ProductError.sessionChanged }
        return record.presentation
    }
    func retryDeletionCleanup(id: UUID) async throws -> AccountDeletionUpdate {
        guard deletionTask == nil, let store = store as? any AccountDeletionStoring else { throw ProductError.accountDeletionPending }
        if let observed = observedDeletion, observed.record.id == id, !observed.persisted {
            let saved = try store.classifyDeletion(observed.record, response: observed.response)
            observedDeletion = (saved, observed.response, true)
        }
        guard let record = try store.deletionRecords().first(where: { $0.id == id }) else { throw ProductError.sessionChanged }
        if !record.cleanupPending && !record.released && record.phase == .finished {
            if observedDeletion?.record.id == id { observedDeletion = nil }
            return AccountDeletionUpdate(presentation: record.presentation) // Never touch B's session/cache.
        }
        guard activeCredential == nil, validated == nil else { throw ProductError.sessionChanged }
        let recovered = try store.recoverDeletion(record)
        let done = recovered.cleanupPending ? try cleanupDeletion(recovered, store: store) : recovered
        let result = AccountDeletionUpdate(presentation: done.presentation, snapshot: try deletionSnapshot())
        observedDeletion = nil
        return result
    }
}
