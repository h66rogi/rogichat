import Foundation

final class M11Store: NativeCredentialStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var credential: NativeCredential?
    private var pending = false
    init(_ credential: NativeCredential?) { self.credential = credential }
    func read() throws -> NativeCredential? { lock.withLock { credential } }
    func replace(expected: NativeCredential?, with value: NativeCredential?) throws -> Bool {
        lock.withLock { guard credential == expected else { return false }; credential = value; return true }
    }
    func logoutPending() throws -> Bool { lock.withLock { pending } }
    func setLogoutPending(_ pending: Bool) throws { lock.withLock { self.pending = pending } }
    func completePendingLogout() throws { lock.withLock { credential = nil; pending = false } }
}
final class M11Clock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Date
    init(_ value: Date) { self.value = value }
    func read() -> Date { lock.withLock { value } }
    func set(_ value: Date) { lock.withLock { self.value = value } }
}
actor M11API: NativeRequesting, M11Requesting {
    private(set) var requests: [M11Endpoint] = []
    private var continuations: [Int: CheckedContinuation<Data, any Error>] = [:]
    private var waiters: [(Int, CheckedContinuation<Void, Never>)] = []
    var restricted = false
    func setRestricted(_ restricted: Bool) { self.restricted = restricted }
    func perform(_ endpoint: NativeEndpoint, credential: NativeCredential) async throws -> Data {
        if case .logout = endpoint { return Data() }
        let date = ISO8601DateFormatter(); date.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return try JSONSerialization.data(withJSONObject: ["authenticated":true,
            "account":["userId":credential.token == M11Checks.a.token ? M11Checks.accountA : M11Checks.accountB,"nickname":"로기","avatarAssetId":NSNull()],
            "soopLinkStatus":restricted ? "REQUIRED":"VERIFIED", "onboardingState":restricted ? "SOOP_LINK_REQUIRED":"READY",
            "expiresAt":date.string(from:credential.expiresAt), "accountGeneration":String(repeating:"g",count:43), "capabilities":["chat":!restricted]])
    }
    func performM11(_ endpoint: M11Endpoint, credential: NativeCredential) async throws -> Data {
        let id = requests.count; requests.append(endpoint)
        return try await withCheckedThrowingContinuation { c in
            continuations[id] = c
            let ready = waiters.filter { requests.count >= $0.0 }; waiters.removeAll { requests.count >= $0.0 }
            ready.forEach { $0.1.resume() }
        }
    }
    func wait(_ count: Int) async {
        if requests.count >= count { return }
        await withCheckedContinuation { waiters.append((count,$0)) }
    }
    func finish(_ id: Int, _ result: Result<Data, any Error>) { continuations.removeValue(forKey:id)?.resume(with:result) }
}
@MainActor final class M11ModelAPI {
    private(set) var gets = 0
    private(set) var puts: [PreferenceGeneration] = []
    private var reads: [Int: CheckedContinuation<AccountNotificationPreferences, any Error>] = [:]
    private var writes: [Int: CheckedContinuation<AccountNotificationPreferences, any Error>] = [:]
    func get() async throws -> AccountNotificationPreferences {
        let id = gets; gets += 1
        return try await withCheckedThrowingContinuation { reads[id] = $0 }
    }
    func put(_ expected: PreferenceGeneration) async throws -> AccountNotificationPreferences {
        let id = puts.count; puts.append(expected)
        return try await withCheckedThrowingContinuation { writes[id] = $0 }
    }
    func read(_ id: Int, _ result: Result<AccountNotificationPreferences, any Error>) { reads.removeValue(forKey:id)?.resume(with:result) }
    func write(_ id: Int, _ result: Result<AccountNotificationPreferences, any Error>) { writes.removeValue(forKey:id)?.resume(with:result) }
}
actor DelayedM11Service: SessionServing, AccountNotificationsServing {
    nonisolated let capabilities: SessionCapabilities
    private let wrapped: NativeSessionService
    private var entered = false
    private var gate: CheckedContinuation<Void, Never>?
    private var waiter: CheckedContinuation<Void, Never>?
    init(_ wrapped: NativeSessionService) { self.wrapped = wrapped; capabilities = wrapped.capabilities }
    func wait() async { if entered { return }; await withCheckedContinuation { waiter = $0 } }
    func release() { gate?.resume(); gate = nil }
    func restore() async throws -> SessionSnapshot { try await wrapped.restore() }
    func signIn(_ method: SignInMethod) async throws -> SessionSnapshot { throw ProductError.unavailable }
    func linkSOOP() async throws -> SessionSnapshot { throw ProductError.unavailable }
    func loadProfile() async throws -> AccountProfile { throw ProductError.unavailable }
    func updateProfile(_ update: ProfileUpdate) async throws -> AccountProfile { throw ProductError.unavailable }
    func signOut() async throws { try await wrapped.signOut() }
    func deleteAccount() async throws { throw ProductError.unavailable }
    func loadNotificationPreferences(scope: UUID) async throws -> AccountNotificationPreferences { try await wrapped.loadNotificationPreferences(scope:scope) }
    func disableAccountNotifications(expected: PreferenceGeneration, scope: UUID) async throws -> AccountNotificationPreferences {
        await withCheckedContinuation { gate = $0; entered = true; waiter?.resume(); waiter = nil }
        return try await wrapped.disableAccountNotifications(expected:expected,scope:scope)
    }
}
@main struct M11Checks {
    static let now = Date(timeIntervalSince1970:2_000_000_000)
    static let a = NativeCredential(token:String(repeating:"a",count:43),expiresAt:now.addingTimeInterval(3600),environment:.qa)
    static let b = NativeCredential(token:String(repeating:"b",count:43),expiresAt:a.expiresAt,environment:.qa)
    static let accountA = "a149a16c-d780-455f-a35e-519e5647a7e2"
    static let accountB = "b149a16c-d780-455f-a35e-519e5647a7e2"
    static func check(_ value: Bool, line: UInt = #line) { precondition(value,"test line \(line)") }
    static func prefs(_ enabled: Bool, _ generation: String = "1") throws -> AccountNotificationPreferences {
        AccountNotificationPreferences(pushEnabled:enabled,generation:try PreferenceGeneration(generation))
    }
    static func json(_ enabled: Bool, _ generation: String = "1") -> Data { Data("{\"pushEnabled\":\(enabled),\"generation\":\"\(generation)\"}".utf8) }
    static func rejects(_ body: () throws -> Void) { do { try body(); preconditionFailure("expected invalid input") } catch {} }
    @MainActor static func until(_ predicate: () -> Bool) async { while !predicate() { await Task.yield() } }
    @MainActor static func main() async throws {
        try contract(); try await model(); try await service(); try await mutationHop()
        print("iOS M11: strict DTO/closed routes, disable-only CAS, reconcile without replay, reverse replies, LINK_REQUIRED, expiry/current-401 and A→B→A fences passed")
    }
    static func contract() throws {
        for value in ["1","18446744073709551615"] { check(try PreferenceGeneration(value).value == value) }
        for value in ["0","01","-1","+1","1.0"," 1","١","18446744073709551616",""] { rejects { _ = try PreferenceGeneration(value) } }
        for raw in [#"{"pushEnabled":false}"#,#"{"generation":"1"}"#,#"{"pushEnabled":null,"generation":"1"}"#,#"{"pushEnabled":0,"generation":"1"}"#,#"{"pushEnabled":false,"generation":1}"#] {
            rejects { _ = try JSONDecoder().decode(AccountNotificationPreferences.self,from:Data(raw.utf8)) }
        }
        let generation = try PreferenceGeneration("18446744073709551615")
        let put = try M11Endpoint.disableNotifications(DisableAccountNotifications(expectedGeneration:generation)).request(environment:.qa,credential:a)
        let body = try JSONSerialization.jsonObject(with:put.httpBody!) as! [String:Any]
        check(body.count == 2 && body["pushEnabled"] as? Bool == false && body["expectedGeneration"] as? String == generation.value)
        check(put.httpMethod == "PUT" && put.url?.absoluteString == "https://api.qa.rogi.chat/v1/me/notification-preferences")
        check(put.value(forHTTPHeaderField:"X-Rogi-Client") == "ios" && put.value(forHTTPHeaderField:"Authorization") == "Bearer " + a.token)
        for field in ["Cookie","Origin","X-CSRF-Token"] { check(put.value(forHTTPHeaderField:field) == nil) }
        let get = try M11Endpoint.notificationPreferences.request(environment:.qa,credential:a)
        check(get.httpMethod == "GET" && get.httpBody == nil && !get.httpShouldHandleCookies)
        rejects { _ = try M11Endpoint.notificationPreferences.request(environment:.prod,credential:a) }
        let room = try ReadStateID(accountA); let context = try OwnReadContext(String(repeating:"A",count:43))
        for id in [accountA + "\n",accountA.uppercased(),accountA.replacingOccurrences(of:"455f",with:"155f"),"../me",""] { rejects { _ = try ReadStateID(id) } }
        for value in [String(repeating:"A",count:42)+"B",String(repeating:"A",count:44),"_"] { rejects { _ = try OwnReadContext(value) } }
        let empty = try JSONDecoder().decode(OwnReadStates.self,from:JSONSerialization.data(withJSONObject:["readContext":context.value,"items":[]]))
        check(empty.items.isEmpty)
        for count in [1,100] {
            let values = Array(repeating:["messageId":NSNull()],count:count)
            let result = try JSONDecoder().decode(OwnReadStates.self,from:JSONSerialization.data(withJSONObject:["readContext":context.value,"items":values]))
            check(result.items.count == count && result.items[0].messageId == nil)
        }
        rejects { _ = try JSONDecoder().decode(OwnReadStates.self,from:JSONSerialization.data(withJSONObject:["readContext":context.value,"items":Array(repeating:["messageId":NSNull()],count:101)])) }
        rejects { _ = try JSONDecoder().decode(OwnReadState.self,from:Data("{}".utf8)) }
        let report = try M11Endpoint.reportReadState(room:room,input:ReportOwnReadState(messageId:room,readContext:context)).request(environment:.qa,credential:a)
        check(report.url?.path == "/v1/rooms/\(accountA)/read-state" && report.httpMethod == "PUT")
        let input = try JSONSerialization.jsonObject(with:report.httpBody!) as! [String:Any]
        check(input.count == 2 && input["messageId"] as? String == accountA && input["readContext"] as? String == context.value)
        for (status,code,expected) in [(409,"CONFLICT",M11Error.conflict),(503,"AUTH_UNAVAILABLE",.unavailable),(404,"NOT_FOUND",.notFound),(400,"INVALID_REQUEST",.invalidRequest)] {
            let error = M11Error.response(Data("{\"error\":{\"code\":\"\(code)\"}}".utf8),status:status)
            check(error as? M11Error == expected)
        }
        check(M11Error.response(Data(),status:401) as? ProductError == .unauthenticated)
        check(M11Error.response(Data(#"{"error":{"code":"CONFLICT"}}"#.utf8),status:400) as? M11Error != .conflict)
    }
    @MainActor static func model() async throws {
        let api = M11ModelAPI(); let model = AccountNotificationModel(fetch:{try await api.get()},disable:{try await api.put($0)})
        check(model.confirmed == nil && !model.canDisable)
        let initial = Task { await model.load() }; await until { api.gets == 1 }
        api.read(0,.success(try prefs(false))); await initial.value
        await model.disableForAccount(); check(api.puts.isEmpty && model.confirmed?.pushEnabled == false)
        let load = Task { await model.load() }; await until { api.gets == 2 }
        api.read(1,.success(try prefs(true))); await load.value
        let put = Task { await model.disableForAccount() }; await until { api.puts.count == 1 }
        await model.disableForAccount(); await model.load(); check(api.puts.count == 1 && api.gets == 2)
        api.write(0,.failure(M11Error.conflict)); await until { api.gets == 3 }
        check(!model.canDisable && model.loading)
        api.read(2,.success(try prefs(true,"2"))); await put.value
        check(model.canDisable && model.errorMessage != nil && api.puts.count == 1)
        let next = Task { await model.disableForAccount() }; await until { api.puts.count == 2 }
        check(api.puts[1].value == "2")
        api.write(1,.failure(ProductError.connection)); await until { api.gets == 4 }
        api.read(3,.success(try prefs(false,"3"))); await next.value
        check(!model.canDisable && model.confirmed?.pushEnabled == false && model.errorMessage != nil && api.puts.count == 2)
        // A newer GET wins even if an older GET completes afterwards.
        let older = Task { await model.load() }; await until { api.gets == 5 }
        let newer = Task { await model.load() }; await until { api.gets == 6 }
        api.read(5,.success(try prefs(false,"4"))); await newer.value
        api.read(4,.success(try prefs(true,"3"))); await older.value
        check(model.confirmed?.generation.value == "4")
        let cancelled = Task { await model.load() }; await until { api.gets == 7 }
        model.cancel(); api.read(6,.success(try prefs(true,"5"))); await cancelled.value
        check(model.confirmed == nil && !model.canDisable)
        let failure = Task { await model.load() }; await until { api.gets == 8 }
        api.read(7,.failure(M11Error.unavailable)); await failure.value
        check(model.confirmed == nil && !model.fresh && model.errorMessage != nil)
        let recovered = Task { await model.load() }; await until { api.gets == 9 }
        api.read(8,.success(try prefs(true,"7"))); await recovered.value
        let disabled = Task { await model.disableForAccount() }; await until { api.puts.count == 3 }
        api.write(2,.success(try prefs(false,"8"))); await disabled.value
        check(model.fresh && model.confirmed?.pushEnabled == false && model.errorMessage == nil && !model.canDisable)
    }
    @MainActor static func service() async throws {
        let clock = M11Clock(now); let store = M11Store(a); let api = M11API()
        let service = NativeSessionService(environment:.qa,api:api,store:store,now:{clock.read()})
        await api.setRestricted(true)
        let restored = try await service.restore(); var bound = restored.clientScope!
        check(restored.access == .linkRequired)
        check(try await service.revalidate().clientScope == bound)
        let oldGet = Task { try await service.loadNotificationPreferences(scope:bound) }; await api.wait(1)
        let put = Task { try await service.disableAccountNotifications(expected:PreferenceGeneration("1"),scope:bound) }; await api.wait(2)
        do { _ = try await service.disableAccountNotifications(expected:PreferenceGeneration("1"),scope:bound); preconditionFailure("duplicate write") } catch M11Error.superseded {}
        await api.finish(1,.success(json(false,"2"))); check(try await put.value.pushEnabled == false)
        await api.finish(0,.success(json(true))); do { _ = try await oldGet.value; preconditionFailure("old GET") } catch M11Error.superseded {}
        // A→B→A reuses the first token deliberately: the local epoch must still reject old 401.
        let old401 = Task { try await service.loadNotificationPreferences(scope:bound) }; await api.wait(3)
        _ = try store.replace(expected:a,with:b); bound = try await service.restore().clientScope!
        _ = try store.replace(expected:b,with:a); bound = try await service.restore().clientScope!
        await api.finish(2,.failure(ProductError.unauthenticated))
        do { _ = try await old401.value; preconditionFailure("old account error") } catch ProductError.sessionChanged {}
        check(try store.read() == a)
        let expiring = Task { try await service.disableAccountNotifications(expected:PreferenceGeneration("2"),scope:bound) }; await api.wait(4)
        clock.set(a.expiresAt); await api.finish(3,.success(json(false,"3")))
        do { _ = try await expiring.value; preconditionFailure("expired response") } catch ProductError.unauthenticated {}
        check(try store.read() == nil)
        clock.set(now); _ = try store.replace(expected:nil,with:a); bound = try await service.restore().clientScope!
        let current401 = Task { try await service.loadNotificationPreferences(scope:bound) }; await api.wait(5)
        await api.finish(4,.failure(ProductError.unauthenticated))
        do { _ = try await current401.value; preconditionFailure("current 401") } catch ProductError.unauthenticated {}
        check(try store.read() == nil)
        // Stale view closures cannot issue a write against a newly restored scope.
        _ = try store.replace(expected:nil,with:a); let session = AppSession(service:service); await session.restore()
        let scope = session.generation; await session.restore()
        do { _ = try await session.disableAccountNotifications(expected:PreferenceGeneration("1"),scope:scope); preconditionFailure("stale view closure") } catch ProductError.sessionChanged {}
        check(await api.requests.count == 5)
        // Read-state is a typed transport surface; no UI/reporting calls are installed.
        await api.setRestricted(false); bound = try await service.restore().clientScope!
        let read = Task { try await service.loadOwnReadStates(room:ReadStateID(accountA),scope:bound) }; await api.wait(6)
        await api.finish(5,.success(Data("{\"readContext\":\"\(String(repeating:"A",count:43))\",\"items\":[]}".utf8)))
        check(try await read.value.items.isEmpty)
        let room = try ReadStateID(accountA); let context = try OwnReadContext(String(repeating:"A",count:43))
        let report = Task { try await service.reportOwnReadState(room:room,input:ReportOwnReadState(messageId:room,readContext:context),scope:bound) }; await api.wait(7)
        await api.finish(6,.success(Data(#"{"messageId":null}"#.utf8)))
        check(try await report.value.messageId == nil)
        let stale = Task { try await service.reportOwnReadState(room:room,input:ReportOwnReadState(messageId:room,readContext:context),scope:bound) }; await api.wait(8)
        await api.finish(7,.failure(M11Error.conflict))
        do { _ = try await stale.value; preconditionFailure("stale read context") } catch M11Error.conflict {}
        check(await api.requests.count == 8) // No replay or synthetic new context.
    }
    @MainActor static func mutationHop() async throws {
        for backToA in [false,true] {
            let store = M11Store(a); let api = M11API()
            let native = NativeSessionService(environment:.qa,api:api,store:store,now:{now})
            let delayed = DelayedM11Service(native); let session = AppSession(service:delayed)
            await session.restore(); let oldScope = session.generation
            let mutation = Task { try await session.disableAccountNotifications(expected:PreferenceGeneration("1"),scope:oldScope) }
            await delayed.wait() // MainActor scope check completed; service HTTP entry has not.
            _ = try store.replace(expected:a,with:b); await session.restore()
            if backToA { _ = try store.replace(expected:b,with:a); await session.restore() }
            await delayed.release()
            do { _ = try await mutation.value; preconditionFailure("old UI mutation") } catch ProductError.sessionChanged {}
            check(await api.requests.isEmpty)
            check(session.account?.id == (backToA ? accountA : accountB))
        }
    }

}
