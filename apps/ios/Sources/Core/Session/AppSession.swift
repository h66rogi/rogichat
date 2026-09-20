import Foundation
import Observation

struct AccountProfile: Equatable, Sendable {
    let id: String
    var displayName: String
    let signInMethod: String
    let soopConnected: Bool
    var birthday: Birthday? = nil
    var birthdayVisibleToStreamers = false
    var isValid: Bool { !id.isEmpty && ProfileEditor(baseline: displayName).error == nil && (birthday?.isValid ?? true) }
}
struct SessionSnapshot: Sendable {
    let access: ShellAccess
    let account: AccountProfile?
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
    case unavailable, sessionChanged, connection
    var errorDescription: String? {
        switch self {
        case .unavailable: "이 기능을 사용할 수 없어요."
        case .sessionChanged: "계정 상태가 변경되었어요. 다시 로그인해 주세요."
        case .connection: "연결을 확인하고 다시 시도해 주세요."
        }
    }
}

// A native transport can be connected only after C01/C02 contracts exist.
// Cookie-based web endpoints are deliberately not treated as native credentials.
protocol SessionServing: Sendable {
    var capabilities: SessionCapabilities { get }
    func restore() async throws -> SessionSnapshot
    func signIn(_ method: SignInMethod) async throws -> SessionSnapshot
    func linkSOOP() async throws -> SessionSnapshot
    func updateProfile(_ update: ProfileUpdate) async throws -> AccountProfile
    func signOut() async throws
    func deleteAccount() async throws
}

struct UnavailableNativeSession: SessionServing {
    let capabilities = SessionCapabilities()
    func restore() async throws -> SessionSnapshot { .signedOut }
    func signIn(_ method: SignInMethod) async throws -> SessionSnapshot { throw ProductError.unavailable }
    func linkSOOP() async throws -> SessionSnapshot { throw ProductError.unavailable }
    func updateProfile(_ update: ProfileUpdate) async throws -> AccountProfile { throw ProductError.unavailable }
    func signOut() async throws { throw ProductError.unavailable }
    func deleteAccount() async throws { throw ProductError.unavailable }
}

// Retains AuthManager's main-thread account ownership and async loading/error flow.
// Native contract differences require an injected gateway rather than original singleton APIs.
@MainActor @Observable
final class AppSession {
    private(set) var access: ShellAccess = .restoring
    private(set) var account: AccountProfile?
    private(set) var busy = false
    private var savingProfile = false
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
            access = .retryableFailure
            errorMessage = "계정 정보를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요."
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
    func saveProfile(_ update: ProfileUpdate) async throws {
        guard capabilities.canEditProfile, access == .ready, let id = account?.id, !savingProfile, !update.isEmpty else { throw ProductError.unavailable }
        savingProfile = true
        defer { savingProfile = false }
        let ticket = generation
        let updated = try await service.updateProfile(update)
        guard ticket == generation, account?.id == id, updated.id == id, !Task.isCancelled else { throw ProductError.sessionChanged }
        guard updated.isValid else { throw ProductError.connection }
        // Profile responses may update editable fields only, never authentication metadata.
        account?.displayName = updated.displayName
        account?.birthday = updated.birthday
        account?.birthdayVisibleToStreamers = updated.birthdayVisibleToStreamers
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
        access = .restoring
        busy = true
        errorMessage = nil
        do {
            try await operation()
            guard ticket == generation else { throw ProductError.sessionChanged }
            reset()
        } catch {
            guard ticket == generation else { throw ProductError.sessionChanged }
            busy = false
            access = .retryableFailure
            errorMessage = "계정 상태를 확인하지 못했어요. 다시 확인해 주세요."
            throw ProductError.connection
        }
    }
    private func reset() {
        generation &+= 1
        account = nil
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
            access = .retryableFailure
            busy = false
            errorMessage = "계정 정보를 확인하지 못했어요. 다시 시도해 주세요."
            return
        }
        if account?.id != snapshot.account?.id || access != snapshot.access { generation &+= 1 }
        account = needsAccount ? snapshot.account : nil
        access = snapshot.access
        errorMessage = nil
        busy = false
    }
}
