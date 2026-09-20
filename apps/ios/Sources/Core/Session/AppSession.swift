import Foundation
import Observation

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
struct SessionSnapshot: Sendable {
    let access: ShellAccess
    var account: AccountSummary?
    var serverGeneration: String? = nil
    var expiresAt: Date? = nil
    var notice: String? = nil
    static let signedOut = SessionSnapshot(access: .signedOut, account: nil)
}
enum SignInMethod: String, Sendable { case apple, soop }
struct SessionCapabilities: Sendable {
    var signInMethods: [SignInMethod] = []
    var canLinkSOOP = false
    var canEditProfile = false
    var canSignOut = false
    var canDeleteAccount = false
}

enum ProductError: Error, LocalizedError, Equatable {
    case unavailable, sessionChanged, connection, unauthenticated, linkRequired, invalidResponse, secureStorage, remoteLogoutUnconfirmed
    var errorDescription: String? {
        switch self {
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
}

extension SessionServing {
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
    private(set) var errorMessage: String?
    private(set) var generation: UInt64 = 0
    private let service: any SessionServing
    var capabilities: SessionCapabilities { service.capabilities }
    init(service: any SessionServing = UnavailableNativeSession()) { self.service = service }

    func restore() async {
        guard !busy else { return }
        busy = true
        errorMessage = nil
        generation &+= 1
        let ticket = generation
        account = nil
        serverGeneration = nil
        expiresAt = nil
        access = .restoring
        defer { if ticket == generation { busy = false } }
        do {
            let snapshot = try await service.restore()
            guard ticket == generation, !Task.isCancelled else { return }
            apply(snapshot)
        } catch {
            guard ticket == generation, !Task.isCancelled else { return }
            generation &+= 1
            busy = false
            account = nil
            serverGeneration = nil
            expiresAt = nil
            access = .retryableFailure
            errorMessage = (error as? ProductError)?.errorDescription ?? "계정 정보를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요."
        }
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
    func signIn(_ method: SignInMethod) async {
        guard access == .signedOut, capabilities.signInMethods.contains(method), !busy else { return }
        await transition { try await self.service.signIn(method) }
    }
    func linkSOOP() async {
        guard capabilities.canLinkSOOP, access == .linkRequired, !busy else { return }
        await transition { try await self.service.linkSOOP() }
    }
    private func transition(_ operation: () async throws -> SessionSnapshot) async {
        busy = true
        errorMessage = nil
        let ticket = generation
        defer { if ticket == generation { busy = false } }
        do {
            let snapshot = try await operation()
            guard ticket == generation, !Task.isCancelled else { return }
            apply(snapshot)
        } catch is CancellationError {
            return
        } catch {
            guard ticket == generation, !Task.isCancelled else { return }
            errorMessage = "로그인을 완료하지 못했어요. 다시 시도해 주세요."
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
            generation &+= 1; account = nil; serverGeneration = nil; expiresAt = nil
            access = .retryableFailure; errorMessage = (error as? ProductError)?.errorDescription
        }
    }
    func signOut() async throws {
        guard capabilities.canSignOut, account != nil, !busy else { throw ProductError.unavailable }
        try await endAccount { try await self.service.signOut() }
    }
    func deleteAccount() async throws {
        guard capabilities.canDeleteAccount, account != nil, !busy else { throw ProductError.unavailable }
        try await endAccount { try await self.service.deleteAccount() }
    }
    private func endAccount(_ operation: () async throws -> Void) async throws {
        generation &+= 1
        let ticket = generation
        account = nil
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
        serverGeneration = nil
        expiresAt = nil
        access = .signedOut
        busy = false
        errorMessage = nil
    }
    private func apply(_ snapshot: SessionSnapshot) {
        let hasAccount = snapshot.account != nil
        let needsAccount = snapshot.access == .ready || snapshot.access == .linkRequired
        guard !needsAccount || hasAccount,
              snapshot.account?.isValid != false,
              snapshot.access != .ready || snapshot.account?.soopConnected == true else {
            generation &+= 1
            account = nil
            serverGeneration = nil
            expiresAt = nil
            access = .retryableFailure
            busy = false
            errorMessage = "계정 정보를 확인하지 못했어요. 다시 시도해 주세요."
            return
        }
        if account?.id != snapshot.account?.id || access != snapshot.access || serverGeneration != snapshot.serverGeneration { generation &+= 1 }
        account = needsAccount ? snapshot.account : nil
        serverGeneration = needsAccount ? snapshot.serverGeneration : nil
        expiresAt = needsAccount ? snapshot.expiresAt : nil
        access = snapshot.access
        errorMessage = snapshot.notice
        busy = false
    }
}
