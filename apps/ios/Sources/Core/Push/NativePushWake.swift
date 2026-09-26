import Foundation
import CoreFoundation

enum NativePushWake {
    // APNs custom fields use numeric version, with the vendor aps envelope allowed.
    // Opaque tap targets are checked against the current manifest and message ACL.
    static func target(_ data: [AnyHashable: Any]) -> (roomId: String, messageId: String)? {
        guard accepts(data), let roomId = data["roomId"] as? String,
              let messageId = data["messageId"] as? String else { return nil }
        return (roomId, messageId)
    }
    static func accepts(_ data: [AnyHashable: Any]) -> Bool {
        let keys = Set(data.keys.compactMap { $0 as? String })
        guard keys.count == data.count,
              (keys == ["type", "version", "aps"] || keys == ["type", "version", "aps", "roomId", "messageId"]),
              data["type"] as? String == "sync_required", let version = data["version"] as? NSNumber,
              CFGetTypeID(version) != CFBooleanGetTypeID(), version == 1,
              let aps = data["aps"] as? [String: Any],
              let content = aps["content-available"] as? NSNumber,
              CFGetTypeID(content) != CFBooleanGetTypeID(), content == 1 else { return false }
        if keys.count == 5 {
            guard let roomId = data["roomId"] as? String, let messageId = data["messageId"] as? String,
                  NativePushContract.uuid(roomId), NativePushContract.uuid(messageId) else { return false }
        }
        if aps.count == 1 { return true } // An in-flight background wake from the previous release.
        guard aps.count == 3, aps["sound"] as? String == "default",
              let alert = aps["alert"] as? [String: String], alert.count == 2,
              alert["title"] == "로기챗",
              alert["body"] == "확인할 내용이 있는지 로기챗에서 확인해 주세요." else { return false }
        return true
    }
}
