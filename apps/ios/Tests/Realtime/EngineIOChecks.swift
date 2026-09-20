import Foundation

@main struct EngineIOChecks {
    static func main() throws {
        let open = #"0{"sid":"test_only_session","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1024}"#
        var state = NativeEngineIOState()
        do { _ = try state.receive("2"); preconditionFailure("ping before open") } catch {}
        let action = try state.receive(open)
        precondition(action == .opened && state.connected && state.heartbeatMilliseconds == 45_000)
        precondition(state.permittedSocketWrite(#"0{"schemaVersion":1,"transport":"native"}"#))
        precondition(state.permittedSocketWrite("1"))
        for invalid in [#"2["join",{}]"#, #"0{"schemaVersion":1,"transport":"native","token":"test"}"#, #"0{"schemaVersion":true,"transport":"native"}"#] {
            precondition(!state.permittedSocketWrite(invalid))
        }
        let ping = try state.receive("2")
        precondition(ping == .ping)
        let packet = try state.receive(#"42["sync.required",{"schemaVersion":1}]"#)
        precondition(packet == .packet(#"2["sync.required",{"schemaVersion":1}]"#))
        do { _ = try state.receive(open); preconditionFailure("duplicate open") } catch {}
        do { _ = try state.receive("4" + String(repeating: "x", count: 1024)); preconditionFailure("oversize") } catch {}
        _ = try state.receive("1")
        precondition(state.closed && !state.permittedSocketWrite("1"))
        do { _ = try state.receive("2"); preconditionFailure("late ping") } catch {}
        for invalid in [#"0{"sid":"x","upgrades":["polling"],"pingInterval":1,"pingTimeout":1}"#,
                        #"0{"sid":"x","upgrades":[],"pingInterval":true,"pingTimeout":1}"#,
                        #"0{"sid":"x","upgrades":[],"pingInterval":1,"pingTimeout":1,"maxPayload":99999}"#] {
            var fresh = NativeEngineIOState()
            do { _ = try fresh.receive(invalid); preconditionFailure("invalid open") } catch {}
        }
        let headers = ["Authorization": "Bearer " + String(repeating: "A", count: 43), "X-Rogi-Client": "ios"]
        let request = try RealtimeWebSocketRequest.make(origin: URL(string: "https://api.qa.rogi.chat")!, headers: headers)
        precondition(request.url?.absoluteString == "wss://api.qa.rogi.chat/v1/realtime/?EIO=4&transport=websocket")
        precondition(!request.httpShouldHandleCookies && request.value(forHTTPHeaderField: "Origin") == nil && request.value(forHTTPHeaderField: "Cookie") == nil)
        let config = RealtimeWebSocketRequest.configuration()
        precondition(config.httpCookieStorage == nil && config.urlCredentialStorage == nil && config.urlCache == nil && !config.httpShouldSetCookies)
        for host in ["http://api.qa.rogi.chat", "https://rogi.chat", "https://api.qa.rogi.chat/redirect"] {
            do { _ = try RealtimeWebSocketRequest.make(origin: URL(string: host)!, headers: headers); preconditionFailure("unapproved endpoint") } catch {}
        }
        var unsafeHeaders = headers; unsafeHeaders["Cookie"] = "test-only"
        do { _ = try RealtimeWebSocketRequest.make(origin: URL(string: "https://api.qa.rogi.chat")!, headers: unsafeHeaders); preconditionFailure("cookie accepted") } catch {}
        print("Engine.IO bounds, closed writes and credential-isolated requests passed")
    }
}
