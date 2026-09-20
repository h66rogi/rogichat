import Foundation

// Fixture gateway is compiled by the host runner only, never an application target.
actor ControlledSession: SessionServing {
    nonisolated let capabilities = SessionCapabilities(signInMethods: [.apple, .soop], canLinkSOOP: true,
        canEditProfile: true, canSignOut: true, canDeleteAccount: true)
    var snapshot: SessionSnapshot
    var failRestore = false
    private var pendingSave: CheckedContinuation<AccountProfile, any Error>?
    private var saveWaiter: CheckedContinuation<Void, Never>?
    private var suspendRestore = false
    private var pendingRestore: CheckedContinuation<SessionSnapshot, any Error>?
    private var restoreWaiter: CheckedContinuation<Void, Never>?
    init(_ snapshot: SessionSnapshot) { self.snapshot = snapshot }
    func restore() async throws -> SessionSnapshot {
        if failRestore { throw ProductError.connection }
        if suspendRestore {
            return try await withCheckedThrowingContinuation { continuation in
                pendingRestore = continuation
                restoreWaiter?.resume(); restoreWaiter = nil
            }
        }
        return snapshot
    }
    func blockRestore() { suspendRestore = true }
    func waitForRestore() async {
        if pendingRestore != nil { return }
        await withCheckedContinuation { restoreWaiter = $0 }
    }
    func finishRestore() {
        pendingRestore?.resume(returning: snapshot)
        pendingRestore = nil
        suspendRestore = false
    }
    func configure(_ snapshot: SessionSnapshot, fail: Bool = false) { self.snapshot = snapshot; failRestore = fail }
    func signIn(_ method: SignInMethod) async throws -> SessionSnapshot { snapshot }
    func linkSOOP() async throws -> SessionSnapshot { snapshot }
    func loadProfile() async throws -> AccountProfile {
        guard let account = snapshot.account else { throw ProductError.unauthenticated }
        return AccountProfile(id: account.id, displayName: account.displayName)
    }
    func updateProfile(_ update: ProfileUpdate) async throws -> AccountProfile {
        try await withCheckedThrowingContinuation { continuation in
            pendingSave = continuation
            saveWaiter?.resume(); saveWaiter = nil
        }
    }
    func waitForSave() async {
        if pendingSave != nil { return }
        await withCheckedContinuation { saveWaiter = $0 }
    }
    func finishSave(_ profile: AccountProfile) { pendingSave?.resume(returning: profile); pendingSave = nil }
    func signOut() async throws {}
    func deleteAccount() async throws {}
}

@main
struct ProductStateChecks {
    @MainActor static func main() async throws {
        try checkProfilePatch()
        let profile = AccountProfile(id: "account-a", displayName: "Initial")
        let summary = AccountSummary(id: "account-a", displayName: "Initial", signInMethod: "Apple", soopConnected: true)
        let service = ControlledSession(SessionSnapshot(access: .ready, account: summary))
        let session = AppSession(service: service)
        await session.restore()
        precondition(session.access == .ready && session.account?.id == "account-a" && !session.busy)

        var foregroundNavigation = ShellNavigation()
        foregroundNavigation.setAccess(session.access)
        foregroundNavigation.selectTab(.settings)
        foregroundNavigation.open(.profile)
        let foregroundEpoch = session.generation
        await session.revalidate()
        if foregroundEpoch != session.generation { foregroundNavigation.setAccess(session.access) }
        precondition(session.generation == foregroundEpoch && foregroundNavigation.page == .profile && foregroundNavigation.tab == .settings)

        let firstSave = Task { try await session.saveProfile(ProfileUpdate(nickname: "First")) }
        await service.waitForSave()
        await session.revalidate()
        precondition(session.generation == foregroundEpoch)
        do {
            try await session.saveProfile(ProfileUpdate(nickname: "Second"))
            preconditionFailure("concurrent writes must not pass")
        } catch ProductError.unavailable {}
        let forged = AccountProfile(id: "account-a", displayName: "Saved")
        let restricted = AccountSummary(id: "account-a", displayName: "Saved", signInMethod: nil, soopConnected: false)
        await service.finishSave(forged)
        try await firstSave.value
        precondition(session.account?.displayName == "Saved")
        precondition(session.account?.signInMethod == "Apple" && session.account?.soopConnected == true && session.access == .ready)

        let lateSave = Task { try await session.saveProfile(ProfileUpdate(nickname: "Late")) }
        await service.waitForSave()
        let oldGeneration = session.generation
        try await session.signOut()
        precondition(session.generation > oldGeneration && session.account == nil && session.access == .signedOut)
        await service.finishSave(profile)
        do { try await lateSave.value; preconditionFailure("late save must be rejected") }
        catch ProductError.sessionChanged {}
        precondition(session.account == nil && session.access == .signedOut)

        await session.restore()
        let beforeFailure = session.generation
        await service.configure(.signedOut, fail: true)
        await session.restore()
        precondition(session.account == nil && session.access == .retryableFailure && session.generation > beforeFailure && !session.busy)
        precondition(session.errorMessage != nil)
        await service.configure(SessionSnapshot(access: .ready, account: nil))
        let beforeInvalid = session.generation
        await session.restore()
        precondition(session.account == nil && session.access == .retryableFailure && session.generation > beforeInvalid && !session.busy)
        await service.configure(SessionSnapshot(access: .ready, account: restricted))
        await session.restore()
        precondition(session.access == .ready && session.account?.soopConnected == false)

        await service.configure(SessionSnapshot(access: .linkRequired, account: restricted))
        await session.restore()
        precondition(session.access == .linkRequired && session.account?.id == "account-a")
        let unlinkedProfile = try await session.loadProfile()
        precondition(unlinkedProfile.id == "account-a")
        await service.configure(SessionSnapshot(access: .ready, account: summary))
        await session.linkSOOP()
        precondition(session.access == .ready)
        try await session.deleteAccount()
        precondition(session.account == nil && session.access == .signedOut)

        // Revalidation hides the previous account and fences older writes before IO completes.
        await session.restore()
        let restoringSave = Task { try await session.saveProfile(ProfileUpdate(nickname: "Stale")) }
        await service.waitForSave()
        await service.blockRestore()
        let revalidation = Task { await session.restore() }
        await service.waitForRestore()
        precondition(session.account == nil && session.access == .restoring && session.busy)
        await service.finishSave(profile)
        do { try await restoringSave.value; preconditionFailure("revalidation must fence earlier writes") }
        catch ProductError.sessionChanged {}
        await service.finishRestore()
        await revalidation.value
        precondition(session.access == .ready && !session.busy)

        // Cancellation releases the busy gate; a later view task can resume restoration.
        await service.blockRestore()
        let cancelledRestore = Task { await session.restore() }
        await service.waitForRestore()
        cancelledRestore.cancel()
        await service.finishRestore()
        await cancelledRestore.value
        precondition(session.account == nil && !session.busy)
        await session.restore()
        precondition(session.access == .ready)

        for month in [0, 13] {
            var malformed = profile
            malformed.birthday = Birthday(month: month, day: 1)
            let badSave = Task { try await session.saveProfile(ProfileUpdate(nickname: "Invalid response")) }
            await service.waitForSave()
            await service.finishSave(malformed)
            do { try await badSave.value; preconditionFailure("malformed birthday must not enter current profile") }
            catch ProductError.invalidResponse {}
            precondition(session.account?.displayName == profile.displayName)
        }
        let emptyID = AccountSummary(id: "", displayName: "Name", signInMethod: "Apple", soopConnected: true)
        let invalidName = AccountSummary(id: "x", displayName: "invalid\u{200d}", signInMethod: "Apple", soopConnected: true)
        for malformed in [emptyID, invalidName] {
            await service.configure(SessionSnapshot(access: .ready, account: malformed))
            await session.restore()
            precondition(session.account == nil && session.access == .retryableFailure)
        }

        let unavailable = AppSession()
        await unavailable.restore()
        await unavailable.signIn(.apple)
        precondition(unavailable.account == nil && unavailable.access == .signedOut && unavailable.capabilities.signInMethods.isEmpty)
        print("iOS product: PATCH absence/null, birthday policy, serialized profile writes, immutable auth metadata, teardown races, invalid-session fencing, SOOP gate and unavailable login checks passed")
    }
    static func checkProfilePatch() throws {
        func object(_ update: ProfileUpdate) throws -> [String: Any] {
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(update)) as! [String: Any]
        }
        let unchanged = try object(ProfileUpdate())
        precondition(unchanged.isEmpty)
        let cleared = try object(ProfileUpdate(birthdayChanged: true))
        precondition(cleared["birthday"] is NSNull && cleared["nickname"] == nil)
        let assigned = try object(ProfileUpdate(birthday: Birthday(month: 2, day: 29), birthdayChanged: true, birthdayVisibleToStreamers: false))
        precondition((assigned["birthday"] as? [String: Int]) == ["month": 2, "day": 29])
        precondition(assigned["birthdayVisibleToStreamers"] as? Bool == false)
        precondition(Birthday(month: 2, day: 29).isValid && !Birthday(month: 2, day: 30).isValid)
        precondition(!Birthday(month: 0, day: 1).isValid && !Birthday(month: 13, day: 1).isValid)
        var draft = ProfileDraft(profile: AccountProfile(id: "profile", displayName: "가"))
        draft.name.edit(" \u{1100}\u{1161} ")
        precondition(draft.changed && !draft.canSave && draft.update.isEmpty)
        draft.birthday = Birthday(month: 1, day: 31)
        precondition(draft.canSave && draft.update.birthdayChanged)
        draft.birthday = Birthday(month: 4, day: 31)
        precondition(!draft.canSave)
    }
}
