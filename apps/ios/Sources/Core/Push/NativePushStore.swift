import Foundation

// Part of the same protected installation envelope as authentication. No device token is stored.
struct StoredPushInstallation: Codable, Sendable, CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    let installationID: String
    let bindingSecret: String
    let installationEpoch: UUID
    var generation: NativePushGeneration?
    var bindingID: String?
    var unknown = false
    var description: String { "StoredPushInstallation([redacted])" }
    var debugDescription: String { description }
    var customMirror: Mirror { Mirror(self, children: ["installation": "[redacted]"]) }
    func validated() throws -> NativePushInstallation {
        guard bindingID == nil || NativePushContract.uuid(bindingID!), (generation == nil) == (bindingID == nil) else { throw ProductError.secureStorage }
        return try NativePushInstallation(installationID: installationID, bindingSecret: bindingSecret)
    }
}
protocol NativePushStoring: NativeCredentialStoring {
    func pushInstallation(expected: NativeCredential) throws -> StoredPushInstallation
    func updatePushInstallation(_ value: StoredPushInstallation, expected: NativeCredential) throws
}
