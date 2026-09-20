import Foundation

private final class PushBytes: CredentialBytesStoring, @unchecked Sendable {
    private let lock = NSLock(); private var value: Data?
    func read() throws -> Data? { lock.withLock { value } }
    func write(_ data: Data) throws { lock.withLock { value = data } }
    func remove() throws { lock.withLock { value = nil } }
}
private actor PushCompositionAPI: NativeRequesting, NativePushRequesting, M11Requesting {
    enum Gate: Sendable { case none, resolve, register, enable }
    var gate: Gate = .none
    private var pending: CheckedContinuation<Void, Never>?
    private var waiter: CheckedContinuation<Void, Never>?
    private var entered = false
    private(set) var counts = [0,0,0,0] // capabilities, resolve, registration, ON
    var loseRegistration = false
    func configure(_ gate: Gate, lose: Bool = false) { self.gate = gate; loseRegistration = lose; entered = false }
    func wait() async { if entered { return }; await withCheckedContinuation { waiter = $0 } }
    func release() { pending?.resume(); pending = nil }
    private func pause(_ at: Gate) async { if gate == at { await withCheckedContinuation { pending = $0; entered = true; waiter?.resume(); waiter = nil } } }
    func perform(_ endpoint: NativeEndpoint, credential: NativeCredential) async throws -> Data {
        if case .logout = endpoint { return Data() }
        let format = ISO8601DateFormatter(); format.formatOptions = [.withInternetDateTime,.withFractionalSeconds]
        return try JSONSerialization.data(withJSONObject: ["authenticated":true,"account":["userId":PushCompositionChecks.accountID,"nickname":"로기","avatarAssetId":NSNull()],"soopLinkStatus":"VERIFIED","onboardingState":"READY","expiresAt":format.string(from:credential.expiresAt),"accountGeneration":String(repeating:"g",count:43),"accountPartition":String(repeating:"A",count:43),"capabilities":["chat":true]])
    }
    func performNativePush(_ endpoint: NativePushEndpoint, credential: NativeCredential) async throws -> Data {
        try await performNativePush(endpoint, credential: credential, admission: NativeRequestAdmission(check: {}))
    }
    func performNativePush(_ endpoint: NativePushEndpoint, credential: NativeCredential, admission: NativeRequestAdmission) async throws -> Data {
        switch endpoint {
        case .capabilities: try await admission.validate(); counts[0] += 1; return Data("{\"available\":true,\"provider\":\"APNS\"}".utf8)
        case .resolve: await pause(.resolve); try await admission.validate(); counts[1] += 1; return Data("{\"binding\":null}".utf8)
        case .register:
            await pause(.register); try await admission.validate(); counts[2] += 1
            if loseRegistration { throw ProductError.connection }
            return Data(("{\"id\":\"" + PushCompositionChecks.bindingID + "\",\"generation\":\"9007199254740993\"}").utf8)
        case .remove: return Data()
        }
    }
    func performM11(_ endpoint: M11Endpoint, credential: NativeCredential) async throws -> Data {
        try await performM11(endpoint, credential: credential, admission: NativeRequestAdmission(check: {}))
    }
    func performM11(_ endpoint: M11Endpoint, credential: NativeCredential, admission: NativeRequestAdmission) async throws -> Data {
        if case .enableNotifications(let expected) = endpoint {
            precondition(expected.value == "9007199254740993")
            await pause(.enable); try await admission.validate(); counts[3] += 1
            return Data("{\"pushEnabled\":true,\"generation\":\"9007199254740994\"}".utf8)
        }
        try await admission.validate(); return Data("{\"pushEnabled\":false,\"generation\":\"9007199254740993\"}".utf8)
    }
}
private final class PermissionState: @unchecked Sendable {
    private let lock = NSLock(); private var value = PushPermission.authorized
    func current() -> PushPermission { lock.withLock { value } }
    func deny() { lock.withLock { value = .denied } }
}
@main struct PushCompositionChecks {
    static let accountID = "00000000-0000-4000-8000-000000000001"
    static let bindingID = "00000000-0000-4000-8000-000000000002"
    static let now = Date(timeIntervalSince1970:2_000_000_000)
    static let credential = NativeCredential(token:String(repeating:"a",count:43),expiresAt:now.addingTimeInterval(604800),environment:.qa)
    static func check(_ value: Bool) { precondition(value) }
    static func main() async throws {
        let token = try DevicePushToken(String(repeating:"ab", count:32))
        for gate in [PushCompositionAPI.Gate.resolve,.register,.enable] {
            for logout in [false,true] {
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent("push-composition-" + UUID().uuidString)
                defer { try? FileManager.default.removeItem(at: directory) }
                let bytes = PushBytes(); let store = NativeCredentialStore(environment:.qa,directory:directory,bytes:bytes)
                check(try store.replace(expected:nil,with:credential))
                let api = PushCompositionAPI(); let service = NativeSessionService(environment:.qa,api:api,store:store,now:{now})
                let scope = try await service.restore().clientScope!
                let permission = PermissionState(); await api.configure(gate)
                let task = Task { try await service.enablePush(token:token,scope:scope,permission:{permission.current()}) }
                await api.wait()
                if logout { try await service.signOut() } else { permission.deny() }
                await api.release()
                do { _ = try await task.value; preconditionFailure("stale permission/credential registered") } catch {}
                let counts = await api.counts
                check(counts[2] == (gate == .enable ? 1 : 0) && counts[3] == 0)
            }
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("push-recovery-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let bytes = PushBytes(); let store = NativeCredentialStore(environment:.qa,directory:directory,bytes:bytes)
        check(try store.replace(expected:nil,with:credential))
        let api = PushCompositionAPI(); let service = NativeSessionService(environment:.qa,api:api,store:store,now:{now})
        let scope = try await service.restore().clientScope!
        await api.configure(.none,lose:true)
        do { _ = try await service.enablePush(token:token,scope:scope,permission:{.authorized}); preconditionFailure() } catch {}
        let original = try store.pushInstallation(expected:credential); check(original.unknown)
        let reopenedStore = NativeCredentialStore(environment:.qa,directory:directory,bytes:bytes)
        let cold = NativeSessionService(environment:.qa,api:api,store:reopenedStore,now:{now})
        let coldScope = try await cold.restore().clientScope!
        check(await api.counts == [1,1,1,0]) // restore never registers or enables.
        let reopened = try reopenedStore.pushInstallation(expected:credential)
        check(reopened.unknown && reopened.installationID == original.installationID && reopened.bindingSecret == original.bindingSecret)
        await api.configure(.none)
        let enabled = try await cold.enablePush(token:token,scope:coldScope,permission:{.authorized})
        let counts = await api.counts; check(enabled.pushEnabled && counts == [2,2,2,1])
        let saved = try reopenedStore.pushInstallation(expected:credential)
        check(!saved.unknown && saved.generation?.value == "9007199254740993")
        print("Protected push composition checks passed")
    }
}
