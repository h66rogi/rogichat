import Foundation

private final class RequestCount: @unchecked Sendable {
    let lock = NSLock(); private var value = 0
    func reset() { lock.withLock { value = 0 } }
    func record(_ request: URLRequest) {
        precondition(request.value(forHTTPHeaderField: "Cookie") == nil && request.value(forHTTPHeaderField: "Origin") == nil)
        lock.withLock { value += 1 }
    }
    var count: Int { lock.withLock { value } }
}
private final class ProbeProtocol: URLProtocol, @unchecked Sendable {
    static let requests = RequestCount()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.record(request)
        let status = request.url!.path.hasSuffix("native-push-subscriptions") ? 201 : 200
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type":"application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{}".utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
private actor AdmissionGate {
    private var pending: CheckedContinuation<Void, Never>?
    private var waiter: CheckedContinuation<Void, Never>?
    private var entered = false
    var permission = PushPermission.authorized
    func pause() async { await withCheckedContinuation { pending = $0; entered = true; waiter?.resume(); waiter = nil } }
    func wait() async { if entered { return }; await withCheckedContinuation { waiter = $0 } }
    func release(permission: PushPermission = .authorized) { self.permission = permission; pending?.resume(); pending = nil }
    func current() async -> PushPermission { await pause(); return permission }
}
@main struct NativeFeatureAdmissionChecks {
    static func check(_ value: Bool) { precondition(value) }
    static let room = "00000000-0000-4000-8000-000000000001"
    static let actor = "00000000-0000-4000-8000-000000000002"
    static let message = "00000000-0000-4000-8000-000000000003"
    static let opaque = String(repeating: "A", count: 43)
    static let credential = NativeCredential(token: String(repeating: "a", count: 43), expiresAt: Date().addingTimeInterval(600), environment: .qa)
    static func scope() throws -> ConversationScope {
        let account = try RoomsScope(partition: opaque, clientScope: UUID(), expiresAt: credential.expiresAt)
        let data = try JSONSerialization.data(withJSONObject: ["roomId":room,"name":"대화","mode":"GROUP","actorId":actor,"role":"MEMBER","membershipScope":opaque,"authorizationRevision":opaque])
        return ConversationScope(account: account, room: try JSONDecoder().decode(MembershipRoom.self, from: data), deviceID: room, cycle: room)
    }
    static func main() async throws {
        let config = NativeAPIClient.configuration(); config.protocolClasses = [ProbeProtocol.self]
        let api = NativeAPIClient(environment: .qa, configuration: config)
        // Actual URLSession positive control; all following denied admissions must remain zero.
        _ = try await api.performConversation(.read(.snapshot), credential: credential, scope: scope())
        check(ProbeProtocol.requests.count == 1)
        for accountChanged in [false, true] {
            for lane in 0..<4 {
                ProbeProtocol.requests.reset(); let original = try scope(); let gate = AdmissionGate()
                let request: ConversationEndpoint
                switch lane {
                case 0: request = .send(try TextCommand(roomID: room, membershipScope: opaque, text: "원래 요청"))
                case 1: request = .send(try TextCommand(roomID: room, membershipScope: opaque, attachment: OutgoingAttachment(type: "PHOTO", assetIds: [message])))
                case 2: request = .feature(try ConversationFeatureRequest(method: "POST", path: "rooms/\(room)/messages/\(message)/delete", body: Data("{}".utf8), expectedStatus: 200))
                default: request = .feature(try ConversationFeatureRequest(method: "PUT", path: "rooms/\(room)/read-state", body: Data("{}".utf8), expectedStatus: 200))
                }
                let queued = Task { await gate.pause(); return try await api.performConversation(request, credential: credential, scope: original) }
                await gate.wait()
                if accountChanged { original.account.invalidate() } else { original.invalidate() }
                await gate.release()
                do { _ = try await queued.value; preconditionFailure("retired scope reached HTTP") } catch {}
                check(ProbeProtocol.requests.count == 0)
            }
        }
        let installation = try NativePushInstallation(installationID: room, bindingSecret: opaque)
        let token = try DevicePushToken(String(repeating:"ab", count:32))
        for enabling in [false, true] {
            for accountChanged in [false, true] {
                ProbeProtocol.requests.reset(); let gate = AdmissionGate(); let attempt = SessionAttempt()
                let admission = NativeRequestAdmission(check: { try attempt.check() }, permission: { await gate.current() })
                let queued = Task {
                    if enabling { return try await api.performM11(.enableNotifications(PreferenceGeneration("1")), credential: credential, admission: admission) }
                    return try await api.performNativePush(.register(installation, token, nil), credential: credential, admission: admission)
                }
                await gate.wait(); if accountChanged { attempt.cancel() }
                await gate.release(permission: accountChanged ? .authorized : .denied)
                do { _ = try await queued.value; preconditionFailure("permission/account change reached HTTP") } catch {}
                check(ProbeProtocol.requests.count == 0)
            }
        }
        // Resolve and GET remain available without permission; they never imply opt-in.
        _ = try await api.performNativePush(.resolve(installation), credential: credential, admission: NativeRequestAdmission(check: {}))
        check(ProbeProtocol.requests.count == 1)
        print("Native feature actual URLSession admission checks passed")
    }
}
