import Foundation

@main struct PushChecks {
    static func main() throws {
        let install = UUID()
        func scope(_ account: String) -> PushScope {
            PushScope(environment: "qa", accountID: account, accountGeneration: "generation",
                      sessionEpoch: UUID(), installationEpoch: install)
        }
        let a = scope("a"), b = scope("b"), aAgain = scope("a")
        let token = try DevicePushToken("test-only-provider-value")
        var model = PushLifecycle()
        model.bind(scope: a, permission: .authorized, serverRegistrationAvailable: false)
        precondition(model.state == .unavailable && model.beginTokenFetch() == nil)
        model.bind(scope: a, permission: .denied, serverRegistrationAvailable: true)
        precondition(model.beginTokenFetch() == nil)
        model.bind(scope: a, permission: .unknown, serverRegistrationAvailable: true)
        precondition(model.beginTokenFetch() == nil)
        model.bind(scope: a, permission: .authorized, serverRegistrationAvailable: true)
        let old = model.beginTokenFetch()!, rotated = model.beginTokenFetch()!
        precondition(!model.tokenReceived(old, value: token))
        precondition(model.tokenReceived(rotated, value: token))
        precondition(!model.registered(old))
        precondition(model.failed(rotated) && model.state == .retryRequired)
        precondition(!model.registered(rotated))
        let retry = model.beginTokenFetch()!
        precondition(model.tokenReceived(retry, value: token))
        precondition(model.registered(retry) && model.state == .registered)
        precondition(!model.registered(retry))
        let late = model.beginTokenFetch()!
        model.bind(scope: b, permission: .authorized, serverRegistrationAvailable: true)
        model.bind(scope: aAgain, permission: .authorized, serverRegistrationAvailable: true)
        precondition(!model.tokenReceived(late, value: token))
        let logout = model.beginTokenFetch()!
        precondition(model.tokenReceived(logout, value: token))
        model.bind(scope: nil, permission: .authorized, serverRegistrationAvailable: true)
        precondition(!model.registered(logout) && model.registrationToken(logout) == nil)
        precondition(token.description == "DevicePushToken([redacted])")
        let installation = try NativePushInstallation(installationID: "00000000-0000-4000-8000-000000000001",
            bindingSecret: Data(repeating: 1, count: 32).base64EncodedString().replacingOccurrences(of: "=", with: ""))
        let providerToken = try NativePushContract.apnsToken(Data(repeating: 42, count: 32))
        let body = try JSONSerialization.jsonObject(with: NativePushContract.register(installation: installation, token: providerToken, generation: nil)) as! [String: Any]
        precondition(body["provider"] as? String == "APNS" && body["generation"] == nil)
        precondition(body["token"] as? String == String(repeating: "2a", count: 32))
        let missingBinding = try NativePushContract.binding(Data("{\"binding\":null}".utf8))
        precondition(missingBinding == nil)
        for invalid in ["{}", "{\"binding\":{}}", "{\"binding\":{\"id\":\"bad\",\"generation\":\"1\",\"revoked\":false}}"] {
            do { _ = try NativePushContract.binding(Data(invalid.utf8)); preconditionFailure("accepted invalid binding") } catch {}
        }
        for invalid in ["0", "01", "-1", "18446744073709551616"] {
            do { _ = try NativePushGeneration(invalid); preconditionFailure("accepted invalid generation") } catch {}
        }
        _ = try NativePushGeneration("18446744073709551615")
        precondition(NativePushWake.accepts(["aps": ["content-available": 1], "type": "sync_required", "version": 1]))
        let visibleAlert: [String: Any] = ["aps": ["content-available": 1, "sound": "default", "alert": ["title": "로기챗", "body": "확인할 내용이 있는지 로기챗에서 확인해 주세요."]], "type": "sync_required", "version": 1]
        precondition(NativePushWake.accepts(visibleAlert))
        precondition(!NativePushWake.accepts(["aps": ["content-available": 1, "sound": "default", "alert": ["title": "다른 앱", "body": "확인할 내용이 있는지 로기챗에서 확인해 주세요."]], "type": "sync_required", "version": 1]))
        precondition(!NativePushWake.accepts(["aps": ["content-available": 1], "type": "sync_required", "version": "1"]))
        precondition(!NativePushWake.accepts(["aps": ["content-available": 1], "type": "sync_required", "version": true]))
        precondition(!NativePushWake.accepts(["aps": ["content-available": 1], "type": "sync_required", "version": 1, "url": "https://qa.rogi.chat/rooms/one"]))

        var gate = PushRouteGate(parser: ContentRouteParser(allowedHost: "qa.rogi.chat", roomPathPrefix: "/rooms/"))
        gate.bind(a)
        precondition(!gate.offer(url: "https://rogi.chat/rooms/one", eventID: "event", expected: a, now: 0))
        precondition(gate.offer(url: "https://qa.rogi.chat/rooms/one", eventID: "event", expected: a, now: 0))
        let cold = gate.begin(now: 1)!
        precondition(gate.authorized(cold, expected: a, roomID: "different", now: 2) == nil)
        gate.bind(b); gate.bind(aAgain)
        precondition(gate.authorized(cold, expected: a, roomID: "one", now: 3) == nil)
        precondition(gate.offer(url: "https://qa.rogi.chat/rooms/one", eventID: "event", expected: aAgain, now: 4))
        let warm = gate.begin(now: 5)!
        precondition(gate.authorized(warm, expected: aAgain, roomID: "one", now: 6)?.roomID == "one")
        precondition(gate.authorized(warm, expected: aAgain, roomID: "one", now: 7) == nil)
        precondition(!gate.offer(url: "https://qa.rogi.chat/rooms/one", eventID: "event", expected: aAgain, now: 8))
        precondition(gate.offer(url: "https://qa.rogi.chat/rooms/one", eventID: "expired", expected: aAgain, now: 9))
        let expired = gate.begin(now: 10)!
        precondition(gate.authorized(expired, expected: aAgain, roomID: "one", now: 300_009) == nil)
        print("Push lifecycle and launch reauthorization checks passed")
    }
}
