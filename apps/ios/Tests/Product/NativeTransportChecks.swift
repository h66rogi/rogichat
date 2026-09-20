import Foundation

// Deterministic adapters compile only in this standalone test executable.
final class MemoryCredentialBytes: CredentialBytesStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var data: Data?
    private var readFailure = false
    private var deleteFailure = false
    func setReadFailure(_ value: Bool) { lock.withLock { readFailure = value } }
    func setDeleteFailure(_ value: Bool) { lock.withLock { deleteFailure = value } }
    func read() throws -> Data? { try lock.withLock { if readFailure { throw ProductError.secureStorage }; return data } }
    func write(_ value: Data) throws { lock.withLock { data = value } }
    func remove() throws { try lock.withLock { if deleteFailure { throw ProductError.secureStorage }; data = nil } }
}
final class FailingIntentStore: NativeCredentialStoring, @unchecked Sendable {
    let base: NativeCredentialStore
    private let lock = NSLock()
    private var failing = true
    init(_ base: NativeCredentialStore) { self.base = base }
    func allowWrites() { lock.withLock { failing = false } }
    func read() throws -> NativeCredential? { try base.read() }
    func replace(expected: NativeCredential?, with value: NativeCredential?) throws -> Bool { try base.replace(expected: expected, with: value) }
    func logoutPending() throws -> Bool { try base.logoutPending() }
    func setLogoutPending(_ pending: Bool) throws {
        guard !lock.withLock({ failing }) else { throw ProductError.secureStorage }
        try base.setLogoutPending(pending)
    }
    func completePendingLogout() throws { try base.completePendingLogout() }
}
final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Date
    init(_ value: Date) { self.value = value }
    func read() -> Date { lock.withLock { value } }
    func set(_ value: Date) { lock.withLock { self.value = value } }
}
final class RedirectProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var called = false
    func receive(_ request: URLRequest?) { precondition(request == nil); lock.withLock { called = true } }
    var completed: Bool { lock.withLock { called } }
}
actor ControlledNativeAPI: NativeRequesting {
    private var reply: Result<Data, ProductError> = .success(Data())
    private var blocked = false
    private var pending: CheckedContinuation<Data, any Error>?
    private var waiter: CheckedContinuation<Void, Never>?
    private(set) var count = 0
    private(set) var paths: [String] = []
    func configure(_ value: Result<Data, ProductError>, blocked: Bool = false) { reply = value; self.blocked = blocked }
    func perform(_ endpoint: NativeEndpoint, credential: NativeCredential) async throws -> Data {
        count += 1; paths.append(endpoint.path)
        if blocked {
            blocked = false
            return try await withCheckedThrowingContinuation { continuation in
                pending = continuation; waiter?.resume(); waiter = nil
            }
        }
        return try reply.get()
    }
    func wait() async { if pending != nil { return }; await withCheckedContinuation { waiter = $0 } }
    func finish(_ value: Result<Data, ProductError>) { pending?.resume(with: value.mapError { $0 as any Error }); pending = nil }
}

@main struct NativeTransportChecks {
    static func check(_ value: Bool) { precondition(value) }
    static let accountID = "a149a16c-d780-455f-a35e-519e5647a7e2"
    static let now = Date(timeIntervalSince1970: 2_000_000_000)
    static let expiry = now.addingTimeInterval(7 * 24 * 60 * 60)
    static let credential = NativeCredential(token: String(repeating: "a", count: 43), expiresAt: expiry, environment: .qa)
    static func sessionData(generation: String = String(repeating: "g", count: 43), linked: Bool = true) throws -> Data {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return try JSONSerialization.data(withJSONObject: [
            "authenticated": true, "account": ["userId": accountID, "nickname": "로기", "avatarAssetId": NSNull()],
            "soopLinkStatus": linked ? "VERIFIED" : "REQUIRED", "onboardingState": linked ? "READY" : "SOOP_LINK_REQUIRED",
            "expiresAt": formatter.string(from: expiry), "accountGeneration": generation, "capabilities": ["chat": linked]])
    }
    static func profileData(id: String = accountID, birthday: Any = NSNull()) throws -> Data {
        try JSONSerialization.data(withJSONObject: ["id": id, "nickname": "변경한 이름", "avatar": NSNull(), "birthday": birthday,
                                                    "birthdayVisibleToStreamers": true])
    }
    static func expect(_ expected: ProductError, line: UInt = #line, _ action: () throws -> Void) {
        do { try action(); preconditionFailure("expected a typed failure at test line \(line)") }
        catch { check(error as? ProductError == expected) }
    }
    @MainActor static func expectAsync(_ expected: ProductError, line: UInt = #line, _ action: () async throws -> Void) async {
        do { try await action(); preconditionFailure("expected a typed failure at test line \(line)") }
        catch { check(error as? ProductError == expected) }
    }
    static func fixture() throws -> (NativeCredentialStore, MemoryCredentialBytes, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("rogichat-native-check-\(UUID().uuidString)")
        let bytes = MemoryCredentialBytes()
        let store = NativeCredentialStore(environment: .qa, directory: directory, bytes: bytes)
        check(try !store.logoutPending())
        check(try store.replace(expected: nil, with: credential))
        return (store, bytes, directory)
    }
    @MainActor static func main() async throws {
        try checkHTTPAndDTO()
        try checkStore()
        try await checkResponseBound()
        try await checkLifecycle()
        try await checkRaces()
        print("iOS native transport: request isolation, exact DTOs, durable install/logout intent, credential CAS, expiry/401, truthful logout, cancellation and stale-response fences passed")
    }
    static func checkHTTPAndDTO() throws {
        let selfAvatar = try ConversationFeatureRequest(method: "POST", path: "me/provider-avatar/access", body: nil, expectedStatus: 200)
        let selfAvatarRequest = try selfAvatar.accountRequest(environment: .qa, credential: credential)
        check(selfAvatarRequest.httpBody == nil && selfAvatarRequest.httpMethod == "POST")
        let actorAvatar = try ConversationFeatureRequest(method: "POST", path: "rooms/\(accountID)/actors/\(accountID)/provider-avatar/access", body: nil, expectedStatus: 200)
        try actorAvatar.validate(room: accountID)
        let invalidAvatar = try ConversationFeatureRequest(method: "GET", path: "me/provider-avatar/access", body: nil, expectedStatus: 200)
        expect(.invalidResponse) { _ = try invalidAvatar.accountRequest(environment: .qa, credential: credential) }
        let request = try NativeEndpoint.updateProfile(ProfileUpdate(birthdayChanged: true)).request(environment: .qa, credential: credential)
        check(request.url?.absoluteString == "https://api.qa.rogi.chat/v1/me/profile")
        check(request.httpMethod == "PATCH" && request.value(forHTTPHeaderField: "X-Rogi-Client") == "ios")
        check(request.value(forHTTPHeaderField: "Authorization") == "Bearer " + credential.token)
        for field in ["Cookie", "Origin", "X-CSRF-Token"] { check(request.value(forHTTPHeaderField: field) == nil) }
        check(!request.httpShouldHandleCookies)
        let patch = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
        check(patch["birthday"] is NSNull && patch["nickname"] == nil)
        expect(.secureStorage) { _ = try NativeEndpoint.session.request(environment: .prod, credential: credential) }
        let config = NativeAPIClient.configuration()
        check(config.httpCookieStorage == nil && config.urlCache == nil && config.urlCredentialStorage == nil && !config.httpShouldSetCookies)
        let redirectSession = URLSession(configuration: .ephemeral)
        defer { redirectSession.invalidateAndCancel() }
        let redirectTask = redirectSession.dataTask(with: request)
        let probe = RedirectProbe()
        NativeSessionDelegate().urlSession(redirectSession, task: redirectTask,
            willPerformHTTPRedirection: HTTPURLResponse(url: request.url!, statusCode: 302, httpVersion: nil, headerFields: nil)!,
            newRequest: URLRequest(url: URL(string: "https://example.invalid/")!), completionHandler: { probe.receive($0) })
        check(probe.completed)
        expect(.unauthenticated) { _ = try NativeAPIClient.validated(Data(), status: 401, expected: 200) }
        expect(.linkRequired) { _ = try NativeAPIClient.validated(Data(#"{"error":{"code":"SOOP_LINK_REQUIRED"}}"#.utf8), status: 403, expected: 200) }
        expect(.unavailable) { _ = try NativeAPIClient.validated(Data(#"{"error":{"code":"FORBIDDEN"}}"#.utf8), status: 403, expected: 200) }
        expect(.invalidResponse) { _ = try NativeAPIClient.validated(Data(), status: 302, expected: 200) }
        expect(.connection) { _ = try NativeAPIClient.validated(Data(), status: 503, expected: 200) }
        let dto = try JSONDecoder().decode(NativeSessionDTO.self, from: sessionData())
        let value = try dto.snapshot(credential: credential, now: now)
        check(value.account?.signInMethod == nil && value.access == .ready && value.expiresAt == expiry)
        let restricted = try JSONDecoder().decode(NativeSessionDTO.self, from: sessionData(linked: false)).snapshot(credential: credential, now: now)
        check(restricted.access == .linkRequired)
        expect(.unauthenticated) { _ = try dto.snapshot(credential: credential, now: expiry) }
        var malformed = try JSONSerialization.jsonObject(with: sessionData()) as! [String: Any]
        malformed["capabilities"] = ["chat": false]
        let bad = try JSONDecoder().decode(NativeSessionDTO.self, from: JSONSerialization.data(withJSONObject: malformed))
        expect(.invalidResponse) { _ = try bad.snapshot(credential: credential, now: now) }
        var noncanonical = try JSONSerialization.jsonObject(with: profileData()) as! [String: Any]
        for name in [" 로기 ", "\u{1100}\u{1161}"] {
            noncanonical["nickname"] = name
            let profile = try JSONDecoder().decode(NativeProfileDTO.self, from: JSONSerialization.data(withJSONObject: noncanonical))
            expect(.invalidResponse) { _ = try profile.profile(expectedID: accountID) }
        }
        for month in [0, 13] {
            let profile = try JSONDecoder().decode(NativeProfileDTO.self, from: profileData(birthday: ["month": month, "day": 1]))
            expect(.invalidResponse) { _ = try profile.profile(expectedID: accountID) }
        }
        let profile = try JSONDecoder().decode(NativeProfileDTO.self, from: profileData(birthday: ["month": 2, "day": 29])).profile(expectedID: accountID)
        check(profile.birthday == Birthday(month: 2, day: 29) && profile.birthdayVisibleToStreamers)
        var augmented = try JSONSerialization.jsonObject(with: profileData()) as! [String: Any]
        augmented["soop"] = ["displayId": "provider_id"]
        augmented["providerAvatarUrl"] = "https://profile.img.sooplive.co.kr/LOGO/pr/provider_id/provider_id.jpg"
        let imported = try JSONDecoder().decode(NativeProfileDTO.self, from: JSONSerialization.data(withJSONObject: augmented)).profile(expectedID: accountID)
        check(imported.id == accountID && imported.soopDisplayID == "provider_id" && imported.providerAvatarURL != nil)
        augmented["providerAvatarUrl"] = NSNull(); augmented["soop"] = NSNull()
        let cleared = try JSONDecoder().decode(NativeProfileDTO.self, from: JSONSerialization.data(withJSONObject: augmented)).profile(expectedID: accountID)
        check(cleared.providerAvatarURL == nil && cleared.soopDisplayID == nil)
        check(profile.soopDisplayID == nil && profile.providerAvatarURL == nil)
        var partial = try JSONSerialization.jsonObject(with: profileData()) as! [String: Any]
        partial.removeValue(forKey: "birthday")
        expect(.invalidResponse) { _ = try JSONDecoder().decode(NativeProfileDTO.self, from: JSONSerialization.data(withJSONObject: partial)) }
        check(!String(describing: credential).contains(credential.token) && !String(reflecting: credential).contains(credential.token))
    }
    @MainActor static func checkResponseBound() async throws {
        func stream(_ count: Int) -> AsyncStream<UInt8> {
            AsyncStream { continuation in
                for _ in 0..<count { continuation.yield(65) }
                continuation.finish()
            }
        }
        let probe = RedirectProbe()
        let exact = try await NativeAPIClient.readBody(stream(4), limit: 4, cancel: { probe.receive(nil) })
        check(exact.count == 4 && !probe.completed)
        await expectAsync(.invalidResponse) { _ = try await NativeAPIClient.readBody(stream(5), limit: 4, cancel: { probe.receive(nil) }) }
        check(probe.completed)
    }
    static func checkStore() throws {
        let (store, bytes, directory) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        let other = NativeCredential(token: String(repeating: "b", count: 43), expiresAt: expiry, environment: .qa)
        check(try !store.replace(expected: other, with: nil))
        check(try store.read() == credential)
        try store.setLogoutPending(true)
        let reopened = NativeCredentialStore(environment: .qa, directory: directory, bytes: bytes)
        check(try reopened.logoutPending())
        expect(.secureStorage) { _ = try reopened.replace(expected: credential, with: other) }
        bytes.setDeleteFailure(true)
        expect(.secureStorage) { _ = try reopened.replace(expected: credential, with: nil) }
        check(try reopened.logoutPending())
        bytes.setDeleteFailure(false)
        check(try reopened.replace(expected: credential, with: nil))
        try reopened.setLogoutPending(false)
        try bytes.write(Data("invalid credential".utf8))
        expect(.secureStorage) { _ = try reopened.read() }
        try reopened.setLogoutPending(true)
        // Schema3 may contain a protected receipt. Automatic logout recovery
        // cannot decode-free erase an unknown/corrupt journal; explicit reset can.
        expect(.secureStorage) { try reopened.completePendingLogout() }
        try reopened.resetConfirmed()
        check(try reopened.read() == nil)
        try bytes.write(Data("retained corrupt credential".utf8))
        // A new install cannot restore Keychain data retained from the previous install.
        try FileManager.default.removeItem(at: directory)
        check(try reopened.read() == nil)
        check(try reopened.replace(expected: nil, with: credential))
        bytes.setReadFailure(true)
        expect(.secureStorage) { _ = try reopened.read() }
        bytes.setReadFailure(false)
        let values = try directory.resourceValues(forKeys: [.isExcludedFromBackupKey])
        check(values.isExcludedFromBackup == true)
    }
    @MainActor static func checkLifecycle() async throws {
        let (store, bytes, directory) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        let api = ControlledNativeAPI()
        let service = NativeSessionService(environment: .qa, api: api, store: store, now: { now })
        await api.configure(.success(try sessionData()))
        let app = AppSession(service: service)
        await app.restore()
        check(app.access == .ready && app.account?.signInMethod == nil && app.serverGeneration != nil)
        await api.configure(.success(try profileData(birthday: ["month": 2, "day": 29])))
        let profile = try await app.loadProfile()
        check(profile.birthday?.day == 29)
        let beforeSave = app.generation
        await api.configure(.success(try sessionData()))
        await app.revalidate()
        check(app.generation == beforeSave)
        await api.configure(.success(try profileData(birthday: ["month": 2, "day": 29])))
        try await app.saveProfile(ProfileUpdate(nickname: "변경한 이름"))
        check(app.account?.displayName == "변경한 이름" && app.generation == beforeSave)
        bytes.setReadFailure(true)
        await app.restore()
        check(app.access == .retryableFailure && app.errorMessage == ProductError.secureStorage.errorDescription)
        bytes.setReadFailure(false)
        await api.configure(.success(Data("malformed response".utf8)))
        await app.restore()
        check(try app.access == .retryableFailure && store.read() == credential)
        await api.configure(.failure(.connection))
        await app.restore()
        check(try app.access == .retryableFailure && app.account == nil && store.read() == credential)
        await api.configure(.success(try sessionData(generation: String(repeating: "h", count: 43))))
        await app.restore()
        check(app.serverGeneration == String(repeating: "h", count: 43) && app.generation > beforeSave)
        await api.configure(.failure(.unauthenticated))
        await expectAsync(.unauthenticated) { _ = try await app.loadProfile() }
        check(try app.access == .signedOut && store.read() == nil)
        check(try store.replace(expected: nil, with: credential))
        await api.configure(.success(try sessionData(linked: false)))
        await app.restore()
        check(app.access == .linkRequired)
        await api.configure(.success(try profileData()))
        _ = try await app.loadProfile()
        await api.configure(.failure(.connection))
        try await app.signOut()
        check(app.access == .signedOut && app.errorMessage == ProductError.remoteLogoutUnconfirmed.errorDescription)
        check(try store.read() == nil)
        // Delete failure survives both service recreation and a subsequent restore.
        check(try store.replace(expected: nil, with: credential))
        bytes.setDeleteFailure(true)
        await expectAsync(.secureStorage) { try await service.signOut() }
        check(try store.logoutPending())
        await expectAsync(.secureStorage) { _ = try await service.restore() }
        bytes.setDeleteFailure(false)
        let restored = try await service.restore()
        check(try restored.access == .signedOut && restored.notice != nil && store.read() == nil)
        let expired = NativeCredential(token: credential.token, expiresAt: now, environment: .qa)
        check(try store.replace(expected: nil, with: expired))
        let requestCount = await api.count
        let signedOut = try await service.restore()
        check(try signedOut.access == .signedOut && store.read() == nil)
        check(await api.count == requestCount)
        // Failure before the durable marker write also blocks same-process restore.
        check(try store.replace(expected: nil, with: credential))
        let failingIntent = FailingIntentStore(store)
        let intentService = NativeSessionService(environment: .qa, api: api, store: failingIntent, now: { now })
        await expectAsync(.secureStorage) { try await intentService.signOut() }
        await expectAsync(.secureStorage) { _ = try await intentService.restore() }
        check(try store.read() == credential)
        failingIntent.allowWrites()
        let removed = try await intentService.restore()
        check(try removed.access == .signedOut && store.read() == nil)
        check(await api.count == requestCount)
    }
    @MainActor static func checkRaces() async throws {
        let (store, _, directory) = try fixture()
        defer { try? FileManager.default.removeItem(at: directory) }
        let api = ControlledNativeAPI()
        let service = NativeSessionService(environment: .qa, api: api, store: store, now: { now })
        await api.configure(.success(try sessionData()), blocked: true)
        let oldRestore = Task { try await service.restore() }
        await api.wait()
        let replacement = NativeCredential(token: String(repeating: "b", count: 43), expiresAt: expiry, environment: .qa)
        check(try store.replace(expected: credential, with: replacement))
        await api.configure(.success(try sessionData(generation: String(repeating: "h", count: 43))))
        _ = try await service.restore()
        await api.finish(.failure(.unauthenticated))
        await expectAsync(.sessionChanged) { _ = try await oldRestore.value }
        check(try store.read() == replacement)
        await api.configure(.success(try profileData()), blocked: true)
        let profile = Task { try await service.loadProfile() }
        await api.wait()
        await api.configure(.success(Data()))
        try await service.signOut()
        await api.finish(.success(try profileData()))
        await expectAsync(.sessionChanged) { _ = try await profile.value }
        check(try store.read() == nil)
        check(try store.replace(expected: nil, with: credential))
        await api.configure(.success(try sessionData()), blocked: true)
        let cancelled = Task { try await service.restore() }
        await api.wait(); cancelled.cancel()
        await api.finish(.failure(.unauthenticated))
        do { _ = try await cancelled.value; preconditionFailure("cancel must not clear credentials") } catch is CancellationError {}
        check(try store.read() == credential)
        // Benign revalidation cannot overwrite a newer profile save.
        await api.configure(.success(try sessionData()))
        let app = AppSession(service: service)
        await app.restore()
        let epoch = app.generation
        await api.configure(.success(try sessionData()), blocked: true)
        let foreground = Task { await app.revalidate() }
        await api.wait()
        await api.configure(.success(try profileData()))
        try await app.saveProfile(ProfileUpdate(nickname: "변경한 이름"))
        await api.finish(.success(try sessionData()))
        await foreground.value
        check(app.account?.displayName == "변경한 이름" && app.generation == epoch)
        await api.configure(.success(try sessionData(generation: String(repeating: "z", count: 43))))
        await app.revalidate()
        check(app.generation > epoch && app.serverGeneration == String(repeating: "z", count: 43))
        // Expiry during IO removes only this credential and settles signed out.
        let clock = TestClock(now)
        let expiringService = NativeSessionService(environment: .qa, api: api, store: store, now: { clock.read() })
        await api.configure(.success(try sessionData()), blocked: true)
        let expiring = Task { try await expiringService.restore() }
        await api.wait()
        clock.set(expiry)
        await api.finish(.success(try sessionData()))
        let expired = try await expiring.value
        check(try expired.access == .signedOut && store.read() == nil)
        // A new protected record cannot leave the previous account visible.
        check(try store.replace(expected: nil, with: credential))
        await api.configure(.success(try sessionData()))
        await app.restore()
        await api.configure(.success(try profileData()), blocked: true)
        let changedCredentialProfile = Task { try await app.loadProfile() }
        await api.wait()
        check(try store.replace(expected: credential, with: replacement))
        await api.finish(.success(try profileData()))
        await expectAsync(.sessionChanged) { _ = try await changedCredentialProfile.value }
        check(try app.account == nil && app.access == .retryableFailure && store.read() == replacement)
    }
}
