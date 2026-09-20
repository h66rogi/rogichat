import Foundation
import CoreFoundation

enum NativeEngineIOAction: Equatable { case opened, ping, packet(String), closed, ignored }
enum NativeEngineIOError: Error { case invalidPacket }

/// Closed Engine.IO 4 websocket subset used by the real Socket.IO SDK engine seam.
/// No HTTP polling, upgrades, binary attachments, or client application packets.
struct NativeEngineIOState {
    private(set) var connected = false
    private(set) var closed = false
    private(set) var sid = ""
    private(set) var heartbeatMilliseconds = 45_000
    mutating func receive(_ message: String) throws -> NativeEngineIOAction {
        guard !closed, !message.isEmpty, message.utf8.count <= 1024 else { throw NativeEngineIOError.invalidPacket }
        switch message.first {
        case "0":
            guard !connected, let body = try JSONSerialization.jsonObject(with: Data(message.dropFirst().utf8)) as? [String: Any],
                  let id = body["sid"] as? String, (1...128).contains(id.utf8.count),
                  id.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 }),
                  let upgrades = body["upgrades"] as? [String], upgrades.isEmpty,
                  let interval = Self.integer(body["pingInterval"]), let timeout = Self.integer(body["pingTimeout"]),
                  (1...60_000).contains(interval), (1...60_000).contains(timeout) else { throw NativeEngineIOError.invalidPacket }
            if let maxPayload = body["maxPayload"] {
                guard let maximum = Self.integer(maxPayload), (1...1024).contains(maximum) else { throw NativeEngineIOError.invalidPacket }
            }
            sid = id; connected = true; heartbeatMilliseconds = interval + timeout
            return .opened
        case "1":
            guard message == "1" else { throw NativeEngineIOError.invalidPacket }
            closed = true; connected = false
            return .closed
        case "2":
            guard connected, message == "2" else { throw NativeEngineIOError.invalidPacket }
            return .ping
        case "4":
            guard connected, message.count > 1 else { throw NativeEngineIOError.invalidPacket }
            return .packet(String(message.dropFirst()))
        case "6":
            guard connected, message == "6" else { throw NativeEngineIOError.invalidPacket }
            return .ignored
        default: throw NativeEngineIOError.invalidPacket
        }
    }
    func permittedSocketWrite(_ message: String) -> Bool {
        guard connected, !closed, message.utf8.count <= 128 else { return false }
        if message == "1" { return true } // Namespace disconnect, not an application event.
        guard message.first == "0",
              let body = try? JSONSerialization.jsonObject(with: Data(message.dropFirst().utf8)) as? [String: Any],
              Set(body.keys) == ["schemaVersion", "transport"], Self.integer(body["schemaVersion"]) == 1,
              body["transport"] as? String == "native" else { return false }
        return true
    }
    private static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite, number.doubleValue == Double(number.intValue) else { return nil }
        return number.intValue
    }
}
