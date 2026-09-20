import Foundation
import Observation
#if canImport(RogichatRooms)
import RogichatRooms
#endif

// The session projection intentionally has no provider or birthday information.
struct AccountSummary: Equatable, Sendable {
    let id: String
    var displayName: String
    let signInMethod: String?
    let soopConnected: Bool
    var avatarAssetID: String? = nil
    var isValid: Bool { !id.isEmpty && ProfileEditor(baseline: displayName).error == nil && ProfileEditor(baseline: displayName).normalized.utf8.elementsEqual(displayName.utf8) }
}
struct AccountProfile: Equatable, Sendable {
    let id: String
    var displayName: String
    var birthday: Birthday? = nil
    var birthdayVisibleToStreamers = false
    var avatarAssetID: String? = nil
    var isValid: Bool { !id.isEmpty && ProfileEditor(baseline: displayName).error == nil && ProfileEditor(baseline: displayName).normalized.utf8.elementsEqual(displayName.utf8) && (birthday?.isValid ?? true) }
}
// An auth result remains unpublished until the main-actor owner accepts it.
// A synchronous acknowledgement closes the service-to-UI cancellation gap.
final class SessionAttempt: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false
    func cancel() { lock.withLock { cancelled = true } }
    func check() throws { try lock.withLock { if cancelled { throw CancellationError() } }; try Task.checkCancellation() }
}
struct SessionPublication: Sendable {
    let acknowledge: @Sendable () throws -> Void
    let discard: @Sendable () async -> Void
}
struct SessionSnapshot: Sendable {
    let access: ShellAccess
    var account: AccountSummary?
    var serverGeneration: String? = nil
    var expiresAt: Date? = nil
    var notice: String? = nil
    var publication: SessionPublication? = nil
    // Opaque local service epoch, unrelated to server generation/partition.
    var clientScope: UUID? = nil
    var accountPartition: String? = nil
    var roomsScope: RoomsScope? = nil
    var deletions: [AccountDeletionPresentation]? = nil
    static let signedOut = SessionSnapshot(access: .signedOut, account: nil)
}
enum SignInMethod: String, Sendable { case apple, soop }
struct SessionCapabilities: Sendable {
    var signInMethods: [SignInMethod] = []
    var canLinkSOOP = false
    var canLinkApple = false
    var canEditProfile = false
    var canSignOut = false
    var canDeleteAccount = false
    var canResetLocalSession = false
}

enum ProductError: Error, LocalizedError, Equatable {
    case notificationPermission, unavailable, sessionChanged, connection, unauthenticated, linkRequired, invalidResponse, secureStorage, remoteLogoutUnconfirmed, accountDeletionPending, deletionHistoryFull
    var errorDescription: String? {
        switch self {
        case .notificationPermission: "이 기기의 알림 허용 상태가 변경되었어요. 설정을 확인한 뒤 다시 선택해 주세요."
        case .accountDeletionPending: "탈퇴 요청의 기기 정리를 먼저 완료해 주세요."
        case .deletionHistoryFull: "기기에 저장된 탈퇴 요청 기록이 가득 찼어요. 새 요청은 보내지 않았어요."
        case .unavailable: "이 기능을 사용할 수 없어요."
        case .sessionChanged: "계정 상태가 변경되었어요. 다시 로그인해 주세요."
        case .connection: "연결을 확인하고 다시 시도해 주세요."
        case .unauthenticated: "로그인이 만료되었어요. 다시 로그인해 주세요."
        case .linkRequired: "SOOP 계정을 연결해 주세요."
        case .invalidResponse: "계정 정보를 확인하지 못했어요. 다시 시도해 주세요."
        case .secureStorage: "이 기기의 로그인 정보를 읽거나 변경하지 못했어요. 기기를 잠금 해제한 뒤 다시 시도해 주세요."
        case .remoteLogoutUnconfirmed: "이 기기에서 로그아웃했어요. 서버의 로그인 종료는 확인하지 못했어요."
        }
    }
}

protocol AccountFeatureAuthorizing: Sendable {
    func accountFeatureData(_ input: ConversationFeatureRequest, scope: RoomsScope) async throws -> Data
}
protocol ConversationAuthorizing: Sendable {
    func conversationData(_ endpoint: ConversationRequest, scope: ConversationScope) async throws -> Data
}

protocol RoomsAuthorizing: Sendable {
    func roomsData(_ endpoint: RoomsQuery, scope: RoomsScope) async throws -> Data
    func roomsCommand(_ intent: RoomCommandIntent) async throws -> Data
}
extension RoomsAuthorizing {
    func roomsCommand(_ intent: RoomCommandIntent) async throws -> Data { throw RoomsError.unavailable }
}

// Provider issuance and native credential transport are separate capabilities.
protocol SessionServing: Sendable {
    var capabilities: SessionCapabilities { get }
    func restore() async throws -> SessionSnapshot
    func revalidate() async throws -> SessionSnapshot
    func signIn(_ method: SignInMethod) async throws -> SessionSnapshot
    func linkSOOP() async throws -> SessionSnapshot
    func loadProfile() async throws -> AccountProfile
    func updateProfile(_ update: ProfileUpdate) async throws -> AccountProfile
    func signOut() async throws
    func deleteAccount() async throws
    func signInSOOP(consentVersion: String) async throws -> SessionSnapshot
    func acceptAuthCallback(_ url: URL) async throws -> SessionSnapshot?
    func beginSOOP(consentVersion: String, attempt: SessionAttempt) async throws -> SessionSnapshot
    func beginLinkSOOP(attempt: SessionAttempt) async throws -> SessionSnapshot
    func beginApple(consentVersion: String?, link: Bool, attempt: SessionAttempt) async throws -> SessionSnapshot
    func cancelAuthentication() async throws -> SessionSnapshot?
    func resetLocalSession() async throws
    func resetLocalSession(attempt: SessionAttempt) async throws
}

extension SessionServing {
    func beginApple(consentVersion: String?, link: Bool, attempt: SessionAttempt) async throws -> SessionSnapshot { throw ProductError.unavailable }
    func signInSOOP(consentVersion: String) async throws -> SessionSnapshot { try await signIn(.soop) }
    func acceptAuthCallback(_ url: URL) async throws -> SessionSnapshot? { throw ProductError.unavailable }
    func beginSOOP(consentVersion: String, attempt: SessionAttempt) async throws -> SessionSnapshot { try attempt.check(); return try await signInSOOP(consentVersion: consentVersion) }
    func beginLinkSOOP(attempt: SessionAttempt) async throws -> SessionSnapshot { try attempt.check(); return try await linkSOOP() }
    func cancelAuthentication() async throws -> SessionSnapshot? { nil }
    func resetLocalSession() async throws { throw ProductError.unavailable }
    func resetLocalSession(attempt: SessionAttempt) async throws { try attempt.check(); try await resetLocalSession() }
    func revalidate() async throws -> SessionSnapshot { try await restore() }
}

struct UnavailableNativeSession: SessionServing {
    let capabilities = SessionCapabilities()
    func restore() async throws -> SessionSnapshot { .signedOut }
    func signIn(_ method: SignInMethod) async throws -> SessionSnapshot { throw ProductError.unavailable }
    func linkSOOP() async throws -> SessionSnapshot { throw ProductError.unavailable }
    func loadProfile() async throws -> AccountProfile { throw ProductError.unavailable }
    func updateProfile(_ update: ProfileUpdate) async throws -> AccountProfile { throw ProductError.unavailable }
    func signOut() async throws { throw ProductError.unavailable }
    func deleteAccount() async throws { throw ProductError.unavailable }
}

// Retains AuthManager's main-thread account ownership and async loading/error flow.
// Native contract differences require an injected gateway rather than original singleton APIs.
@MainActor @Observable
final class AppSession {
    private(set) var access: ShellAccess = .restoring
    private(set) var account: AccountSummary?
    private(set) var serverGeneration: String?
    private(set) var expiresAt: Date?
    private(set) var busy = false
    private var savingProfile = false
    private(set) var revalidating = false
    private var profileRevision: UInt64 = 0
    private(set) var roomsScope: RoomsScope?
    private var clientScope: UUID?
    private var accountPartition: String?
    private var deferredAuthCallback: URL?
    private var authAttempt: SessionAttempt?
    @ObservationIgnored private var expirationTask: Task<Void, Never>?
    private(set) var deletions: [AccountDeletionPresentation] = []
    private(set) var deletionError: String?
    var showDeletionHistory = false
    private var currentDeletionID: UUID?
    var visibleDeletions: [AccountDeletionPresentation] {
        if let currentDeletionID { return deletions.filter { $0.id == currentDeletionID } }
        return account == nil ? deletions : []
    }
    @ObservationIgnored private var deletionWork: Task<Void, Never>?
    private(set) var errorMessage: String?
    private var featureAttempt = SessionAttempt()
    private(set) var generation: UInt64 = 0 { didSet { featureAttempt.cancel(); featureAttempt = SessionAttempt(); scopeInvalidated?() } }
    @ObservationIgnored var scopeInvalidated: (@MainActor () -> Void)?
    private let service: any SessionServing
    var capabilities: SessionCapabilities { service.capabilities }
    init(service: any SessionServing = UnavailableNativeSession()) { self.service = service }

    func restore() async {
        guard !busy else { return }
        let ticket = beginRestoration()
        await finishRestoration(ticket: ticket)
    }
    private func beginRestoration() -> UInt64 {
        busy = true
        errorMessage = nil
        generation &+= 1
        let ticket = generation
        account = nil
        roomsScope?.invalidate(); roomsScope = nil; clientScope = nil; accountPartition = nil
        serverGeneration = nil
        expiresAt = nil
        access = .restoring
        return ticket
    }
    private func finishRestoration(ticket: UInt64) async {
        guard ticket == generation, !Task.isCancelled else { return }
        defer { if ticket == generation { busy = false } }
        do {
            let snapshot = try await service.restore()
            guard ticket == generation, !Task.isCancelled else { return }
            apply(snapshot)
            if let url = deferredAuthCallback { deferredAuthCallback = nil; await acceptAuthCallback(url) }
        } catch {
            guard ticket == generation, !Task.isCancelled else { return }
            generation &+= 1
            busy = false
            account = nil
            roomsScope?.invalidate(); roomsScope = nil; clientScope = nil; accountPartition = nil
            serverGeneration = nil
            expiresAt = nil
            access = .retryableFailure
            errorMessage = (error as? ProductError)?.errorDescription ?? "계정 정보를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요."
        }
    }
    func expire(expected: Date, now: Date = Date()) async {
        guard expiresAt == expected, now >= expected else { return }
        authAttempt?.cancel(); authAttempt = nil
        // Invalidate private scope synchronously, including a busy LINK operation.
        let ticket = beginRestoration()
        // SwiftUI cancels its timer when expiresAt clears. The session owns completion;
        // the captured ticket prevents a queued old timer from restoring a newer scope.
        let operation = Task { await self.finishRestoration(ticket: ticket) }
        expirationTask = operation
        await operation.value
    }
    // Foreground checks retain the current navigation/draft until the server
    // reports a different authorization scope; public settings need no auth IO.
    func revalidate() async {
        guard account != nil, !busy, !revalidating else { return }
        revalidating = true
        defer { revalidating = false }
        let ticket = generation
        let revision = profileRevision
        do {
            var snapshot = try await service.revalidate()
            guard ticket == generation, !Task.isCancelled else { return }
            if revision != profileRevision, snapshot.account?.id == account?.id,
               snapshot.serverGeneration == serverGeneration, snapshot.access == access {
                snapshot.account?.displayName = account!.displayName
                snapshot.account?.avatarAssetID = account?.avatarAssetID
            }
            apply(snapshot)
        } catch {
            guard ticket == generation, !Task.isCancelled else { return }
            await handleAccountError(error, ticket: ticket)
            if ticket == generation {
                errorMessage = (error as? ProductError)?.errorDescription ?? ProductError.connection.errorDescription
            }
        }
    }
    func signIn(_ method: SignInMethod, consent: Bool = false) async {
        guard access == .signedOut, capabilities.signInMethods.contains(method), !busy else { return }
        guard consent else { errorMessage = "이용 안내를 확인하고 동의해 주세요."; return }
        let attempt = SessionAttempt(); authAttempt = attempt
        if method == .soop { await transition { try await self.service.beginSOOP(consentVersion: "2026-09-20", attempt: attempt) } }
        else { await transition { try await self.service.beginApple(consentVersion: "2026-09-20", link: false, attempt: attempt) } }
    }
    func linkApple() async {
        guard capabilities.canLinkApple, account != nil, [.ready, .linkRequired].contains(access), !busy else { return }
        let attempt = SessionAttempt(); authAttempt = attempt
        await transition { try await self.service.beginApple(consentVersion: nil, link: true, attempt: attempt) }
    }

    func linkSOOP() async {
        guard capabilities.canLinkSOOP, access == .linkRequired, !busy else { return }
        let attempt = SessionAttempt(); authAttempt = attempt
        await transition { try await self.service.beginLinkSOOP(attempt: attempt) }
    }
    private func transition(_ operation: () async throws -> SessionSnapshot) async {
        // A fresh user operation supersedes a cold callback still awaiting IO.
        roomsScope?.invalidate(); roomsScope = nil
        generation &+= 1
        busy = true
        errorMessage = nil
        let ticket = generation
        defer { if ticket == generation { busy = false } }
        do {
            let snapshot = try await operation()
            guard ticket == generation, !Task.isCancelled else { await snapshot.publication?.discard(); return }
            do { try snapshot.publication?.acknowledge() }
            catch { await snapshot.publication?.discard(); throw error }
            apply(snapshot)
        } catch is CancellationError {
            return
        } catch {
            guard ticket == generation, !Task.isCancelled else { return }
            await handleAccountError(error, ticket: ticket)
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "로그인을 완료하지 못했어요. 다시 시도해 주세요."
        }
    }
    func acceptAuthCallback(_ url: URL) async {
        guard deletionWork == nil else { return }
        if busy && access == .restoring { deferredAuthCallback = url; return }
        let ticket = generation
        do {
            if let snapshot = try await service.acceptAuthCallback(url) {
                guard ticket == generation, !Task.isCancelled else { await snapshot.publication?.discard(); return }
                do { try snapshot.publication?.acknowledge() }
                catch { await snapshot.publication?.discard(); throw error }
                apply(snapshot)
            }
        } catch {
            guard ticket == generation, !Task.isCancelled else { return }
            await handleAccountError(error, ticket: ticket)
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "로그인을 완료하지 못했어요. 다시 시작해 주세요."
        }
    }
    func cancelAuthentication() async {
        guard deletionWork == nil else { return }
        authAttempt?.cancel(); authAttempt = nil
        roomsScope?.invalidate(); roomsScope = nil
        generation &+= 1; busy = false; deferredAuthCallback = nil
        let ticket = generation
        do {
            let snapshot = try await service.cancelAuthentication()
            guard ticket == generation else { return }
            if let snapshot { apply(snapshot) }; errorMessage = nil
        } catch {
            guard ticket == generation else { return }
            account = nil; roomsScope?.invalidate(); roomsScope = nil; clientScope = nil; accountPartition = nil; serverGeneration = nil; expiresAt = nil; access = .retryableFailure
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "취소를 확인하지 못했어요. 다시 시도해 주세요."
        }
    }
    func resetLocalSession(expectedGeneration: UInt64? = nil) async {
        guard deletionWork == nil, expectedGeneration == nil || expectedGeneration == generation else { return }
        authAttempt?.cancel()
        let attempt = SessionAttempt(); authAttempt = attempt
        generation &+= 1; account = nil; roomsScope?.invalidate(); roomsScope = nil; clientScope = nil; accountPartition = nil; serverGeneration = nil; expiresAt = nil; access = .restoring; busy = true; deferredAuthCallback = nil
        let ticket = generation
        do {
            try await service.resetLocalSession(attempt: attempt)
            guard ticket == generation else { return }
            deferredAuthCallback = nil // Returns received during destructive reset do not resume old proof.
            deletions = []; deletionError = nil; showDeletionHistory = false; currentDeletionID = nil
            reset(); errorMessage = "이 기기의 로그인 정보와 접수 기록을 지웠어요. 서버 요청의 취소나 접수 확인은 하지 않았어요."
        } catch {
            guard ticket == generation else { return }
            deferredAuthCallback = nil
            busy = false; access = .retryableFailure; errorMessage = ProductError.secureStorage.errorDescription
        }
    }
    func accountFeatureData(_ input: ConversationFeatureRequest, scope: RoomsScope) async throws -> Data {
        guard !busy, access == .ready, roomsScope === scope, let service = service as? any AccountFeatureAuthorizing else { throw ProductError.sessionChanged }
        let ticket = generation
        do {
            let data = try await service.accountFeatureData(input, scope: scope)
            guard ticket == generation, roomsScope === scope else { throw ProductError.sessionChanged }; try scope.check(); return data
        } catch { await handleAccountError(error, ticket: ticket); throw error }
    }
    func conversationData(_ endpoint: ConversationRequest, scope: ConversationScope) async throws -> Data {
        guard !busy, access == .ready, roomsScope === scope.account, let service = service as? any ConversationAuthorizing else { throw ConversationError.staleScope }
        let ticket = generation
        do {
            try scope.check()
            let data = try await service.conversationData(endpoint, scope: scope)
            guard ticket == generation, roomsScope === scope.account else { throw ConversationError.staleScope }
            try scope.check(); return data
        } catch {
            await handleAccountError(error, ticket: ticket)
            throw error
        }
    }
    func roomsData(_ endpoint: RoomsQuery, scope: RoomsScope) async throws -> Data {
        guard !busy, access == .ready, roomsScope === scope, let service = service as? any RoomsAuthorizing else { throw RoomsError.staleScope }
        let ticket = generation
        do {
            try scope.check()
            let data = try await service.roomsData(endpoint, scope: scope)
            guard ticket == generation, roomsScope === scope else { throw RoomsError.staleScope }
            try scope.check()
            return data
        } catch {
            await handleAccountError(error, ticket: ticket)
            throw error
        }
    }
    func roomsCommand(_ intent: RoomCommandIntent) async throws -> Data {
        guard !busy, access == .ready, roomsScope === intent.scope, let service = service as? any RoomsAuthorizing else { throw RoomsError.staleScope }
        let ticket = generation
        do {
            try intent.scope.check()
            let data = try await service.roomsCommand(intent)
            guard ticket == generation, roomsScope === intent.scope else { throw RoomsError.staleScope }
            try intent.scope.check()
            return data
        } catch {
            await handleAccountError(error, ticket: ticket)
            throw error
        }
    }
    func realtimeOffer() async throws -> NativeRealtimeOffer {
        guard !busy, access == .ready, let clientScope, let service = service as? any NativeRealtimeServing else { throw ProductError.sessionChanged }
        let ticket = generation
        let offer = try await service.realtimeOffer(scope: clientScope)
        guard ticket == generation, self.clientScope == clientScope, !busy, access == .ready else { throw ProductError.sessionChanged }
        return offer
    }
    func pushCapabilities(scope: UInt64) async throws -> NativePushCapabilities {
        guard scope == generation, !busy, access == .ready, let clientScope, let service = service as? any NativePushServing else { throw ProductError.sessionChanged }
        do {
            let value = try await service.pushCapabilities(scope: clientScope)
            guard scope == generation, self.clientScope == clientScope, !busy else { throw ProductError.sessionChanged }
            return value
        } catch { await handleAccountError(error, ticket: scope); throw error }
    }
    func enablePush(token: DevicePushToken, scope: UInt64, permission: @escaping @Sendable () async -> PushPermission) async throws -> AccountNotificationPreferences {
        guard scope == generation, !busy, access == .ready, let clientScope, let service = service as? any NativePushServing else { throw ProductError.sessionChanged }
        let original = featureAttempt
        do {
            let value = try await service.enablePush(token: token, scope: clientScope, permission: permission, original: { try original.check() })
            guard scope == generation, self.clientScope == clientScope else { throw ProductError.sessionChanged }; return value
        } catch { await handleAccountError(error, ticket: scope); throw error }
    }
    func loadNotificationPreferences(scope: UInt64) async throws -> AccountNotificationPreferences {
        try await notificationPreferences(scope: scope) { try await $0.loadNotificationPreferences(scope: $1) }
    }
    func disableAccountNotifications(expected: PreferenceGeneration, scope: UInt64) async throws -> AccountNotificationPreferences {
        try await notificationPreferences(scope: scope) { try await $0.disableAccountNotifications(expected: expected, scope: $1) }
    }
    private func notificationPreferences(scope: UInt64, operation: (any AccountNotificationsServing, UUID) async throws -> AccountNotificationPreferences) async throws -> AccountNotificationPreferences {
        guard scope == generation, account != nil, access == .ready || access == .linkRequired else { throw ProductError.sessionChanged }
        guard !busy, let clientScope, let preferences = service as? any AccountNotificationsServing else { throw ProductError.unavailable }
        let ticket = generation
        do {
            let value = try await operation(preferences, clientScope)
            guard ticket == generation, !Task.isCancelled else { throw ProductError.sessionChanged }
            return value
        } catch {
            await handleAccountError(error, ticket: ticket)
            throw error
        }
    }
    func loadProfile() async throws -> AccountProfile {
        guard let id = account?.id, access == .ready || access == .linkRequired, !busy else { throw ProductError.unavailable }
        let ticket = generation
        do {
            let profile = try await service.loadProfile()
            guard ticket == generation, account?.id == id, !Task.isCancelled else { throw ProductError.sessionChanged }
            guard profile.id == id, profile.isValid else { throw ProductError.invalidResponse }
            return profile
        } catch {
            await handleAccountError(error, ticket: ticket)
            throw error
        }
    }
    func saveProfile(_ update: ProfileUpdate) async throws {
        guard capabilities.canEditProfile, access == .ready || access == .linkRequired,
              let id = account?.id, !savingProfile, !busy, !update.isEmpty else { throw ProductError.unavailable }
        savingProfile = true
        defer { savingProfile = false }
        let ticket = generation
        do {
            let updated = try await service.updateProfile(update)
            guard ticket == generation, account?.id == id, updated.id == id, !Task.isCancelled else { throw ProductError.sessionChanged }
            guard updated.isValid else { throw ProductError.invalidResponse }
            // A profile response never replaces authorization metadata or the server generation.
            account?.displayName = updated.displayName
            account?.avatarAssetID = updated.avatarAssetID
            profileRevision &+= 1
        } catch {
            await handleAccountError(error, ticket: ticket)
            throw error
        }
    }
    private func handleAccountError(_ error: any Error, ticket: UInt64) async {
        guard ticket == generation, !Task.isCancelled else { return }
        if error as? ProductError == .unauthenticated { reset() }
        else if error as? ProductError == .linkRequired { await restore() }
        else if error as? ProductError == .secureStorage || error as? ProductError == .sessionChanged {
            generation &+= 1; account = nil; roomsScope?.invalidate(); roomsScope = nil; clientScope = nil; accountPartition = nil; serverGeneration = nil; expiresAt = nil
            access = .retryableFailure; errorMessage = (error as? ProductError)?.errorDescription
        }
    }
    func signOut() async throws {
        guard capabilities.canSignOut, account != nil else { throw ProductError.unavailable }
        try await endAccount { try await self.service.signOut() }
    }
    func deleteAccount() async throws {
        guard capabilities.canDeleteAccount, account != nil, !busy else { throw ProductError.unavailable }
        try await endAccount { try await self.service.deleteAccount() }
    }
    private func endAccount(_ operation: () async throws -> Void) async throws {
        authAttempt?.cancel(); authAttempt = nil
        generation &+= 1
        let ticket = generation
        account = nil
        roomsScope?.invalidate(); roomsScope = nil; clientScope = nil; accountPartition = nil
        serverGeneration = nil
        expiresAt = nil
        access = .restoring
        busy = true
        errorMessage = nil
        do {
            try await operation()
            guard ticket == generation else { throw ProductError.sessionChanged }
            reset()
        } catch ProductError.remoteLogoutUnconfirmed {
            guard ticket == generation else { throw ProductError.sessionChanged }
            reset()
            errorMessage = ProductError.remoteLogoutUnconfirmed.errorDescription
        } catch {
            guard ticket == generation else { throw ProductError.sessionChanged }
            busy = false
            access = .retryableFailure
            errorMessage = (error as? ProductError)?.errorDescription ?? "계정 상태를 확인하지 못했어요. 다시 확인해 주세요."
            throw ProductError.connection
        }
    }
    private func reset() {
        generation &+= 1
        account = nil
        roomsScope?.invalidate(); roomsScope = nil; clientScope = nil; accountPartition = nil
        serverGeneration = nil
        expiresAt = nil
        access = .signedOut
        busy = false
        errorMessage = nil
    }
    private func apply(_ snapshot: SessionSnapshot) {
        if let records = snapshot.deletions { deletions = records }
        if snapshot.account != nil { currentDeletionID = nil; showDeletionHistory = false; deletionError = nil }
        let hasAccount = snapshot.account != nil
        let needsAccount = snapshot.access == .ready || snapshot.access == .linkRequired
        guard !needsAccount || hasAccount,
              snapshot.account?.isValid != false,
              snapshot.access != .ready || snapshot.account?.soopConnected == true else {
            generation &+= 1
            account = nil
            roomsScope?.invalidate(); roomsScope = nil; clientScope = nil; accountPartition = nil
            serverGeneration = nil
            expiresAt = nil
            access = .retryableFailure
            busy = false
            errorMessage = "계정 정보를 확인하지 못했어요. 다시 시도해 주세요."
            return
        }
        if account?.id != snapshot.account?.id || access != snapshot.access || serverGeneration != snapshot.serverGeneration || clientScope != snapshot.clientScope || accountPartition != snapshot.accountPartition { generation &+= 1 }
        if roomsScope !== snapshot.roomsScope { roomsScope?.invalidate() }
        roomsScope = snapshot.access == .ready ? snapshot.roomsScope : nil
        clientScope = needsAccount ? snapshot.clientScope : nil
        accountPartition = needsAccount ? snapshot.accountPartition : nil
        account = needsAccount ? snapshot.account : nil
        serverGeneration = needsAccount ? snapshot.serverGeneration : nil
        expiresAt = needsAccount ? snapshot.expiresAt : nil
        access = snapshot.access
        errorMessage = snapshot.notice
        busy = false
    }
}


extension AppSession {
    func deletionIntent(expectedGeneration: UInt64) -> AccountDeletionIntent? {
        guard expectedGeneration == generation, !busy, capabilities.canDeleteAccount,
              let account, let clientScope, service is any AccountDeletionServing else { return nil }
        return AccountDeletionIntent(id: UUID(), accountID: account.id, accountName: account.displayName, clientScope: clientScope, generation: generation)
    }
    func startDeletion(_ intent: AccountDeletionIntent) {
        // An old alert must not even close the newer account's private UI.
        guard intent.generation == generation, intent.clientScope == clientScope, intent.accountID == account?.id,
              !busy, deletionWork == nil, let deleting = service as? any AccountDeletionServing else { return }
        authAttempt?.cancel(); authAttempt = nil; deferredAuthCallback = nil
        generation &+= 1; let ticket = generation
        account = nil; roomsScope?.invalidate(); roomsScope = nil; clientScope = nil; accountPartition = nil; serverGeneration = nil; expiresAt = nil
        access = .accountClosing; busy = true; errorMessage = nil; deletionError = nil; showDeletionHistory = true; currentDeletionID = intent.id
        putDeletion(AccountDeletionPresentation(id: intent.id, outcome: .preparing, requestID: nil, cleanupPending: true, working: true, accountID: intent.accountID))
        deletionWork = Task {
            defer { if self.generation == ticket { self.busy = false }; self.deletionWork = nil }
            do {
                let result = try await deleting.admitDeletion(intent)
                guard self.generation == ticket else { return }
                if let snapshot = result.snapshot { self.apply(snapshot) }
                self.putDeletion(result.presentation)
                self.currentDeletionID = intent.id; self.showDeletionHistory = true
            } catch {
                guard self.generation == ticket else { return }
                let status = try? await deleting.deletionStatus(id: intent.id)
                guard self.generation == ticket else { return }
                let noAdmission = error as? ProductError == .deletionHistoryFull
                self.putDeletion(status ?? AccountDeletionPresentation(id: intent.id, outcome: noAdmission ? .notSent : .unknown, requestID: nil, cleanupPending: !noAdmission, accountID: intent.accountID))
                self.access = .retryableFailure; self.busy = false
                self.deletionError = (error as? LocalizedError)?.errorDescription ?? ProductError.secureStorage.errorDescription
                self.errorMessage = self.deletionError
            }
        }
    }
    func retryDeletionCleanup(id: UUID) async {
        guard deletionWork == nil, !busy, let deleting = service as? any AccountDeletionServing else { return }
        let ticket = generation; busy = true; deletionError = nil
        defer { if generation == ticket { busy = false } }
        do {
            let result = try await deleting.retryDeletionCleanup(id: id)
            guard generation == ticket else { return }
            if let snapshot = result.snapshot { apply(snapshot) }
            putDeletion(result.presentation)
        } catch {
            guard generation == ticket else { return }
            deletionError = (error as? LocalizedError)?.errorDescription ?? ProductError.secureStorage.errorDescription
        }
    }
    private func putDeletion(_ value: AccountDeletionPresentation) {
        if let index = deletions.firstIndex(where: { $0.id == value.id }) { deletions[index] = value }
        else { deletions.append(value) }
    }
}

extension AppSession {
    func dismissDeletionPresentation() { showDeletionHistory = false; currentDeletionID = nil; deletionError = nil }
}
