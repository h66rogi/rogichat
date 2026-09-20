import Foundation
import CoreFoundation

enum NativePushWake {
    // APNs custom fields use numeric version, with the vendor aps envelope allowed.
    // Caller resumes current authorized manifest/sync; never navigate from payload.
    static func accepts(_ data: [AnyHashable: Any]) -> Bool {
        let keys = Set(data.keys.compactMap { $0 as? String })
        guard keys.count == data.count, keys == ["type", "version", "aps"],
              data["type"] as? String == "sync_required", let version = data["version"] as? NSNumber,
              CFGetTypeID(version) != CFBooleanGetTypeID(), version == 1,
              let aps = data["aps"] as? [String: Any], aps.count == 1,
              let content = aps["content-available"] as? NSNumber,
              CFGetTypeID(content) != CFBooleanGetTypeID(), content == 1 else { return false }
        return true
    }
}
