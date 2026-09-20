import Foundation

enum NativePushContractError: Error { case invalid }
enum NativePushProvider: String, Codable, Sendable { case apns = "APNS", fcm = "FCM" }
struct NativePushGeneration: Codable, Equatable, Sendable {
    let value: String
    init(_ value: String) throws {
        guard !value.isEmpty, value.utf8.count <= 20, value.first != "0",
              value.utf8.allSatisfy({ (48...57).contains($0) }), let number = UInt64(value), number > 0 else { throw NativePushContractError.invalid }
        self.value = value
    }
    init(from decoder: any Decoder) throws { try self.init(decoder.singleValueContainer().decode(String.self)) }
    func encode(to encoder: any Encoder) throws { var c = encoder.singleValueContainer(); try c.encode(value) }
}
/// Created once per installation/environment by the protected store owner BEFORE HTTP.
/// Retained across logout/account changes. Never derive from account or hardware IDs.
struct NativePushInstallation: Sendable, CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    let installationID: String
    let bindingSecret: String
    init(installationID: String, bindingSecret: String) throws {
        guard NativePushContract.uuid(installationID), NativePushContract.opaque(bindingSecret) else { throw NativePushContractError.invalid }
        self.installationID = installationID; self.bindingSecret = bindingSecret
    }
    var description: String { "NativePushInstallation([redacted])" }
    var debugDescription: String { description }
    var customMirror: Mirror { Mirror(self, children: ["installation": "[redacted]"]) }
}
struct NativePushBinding: Decodable, Equatable, Sendable {
    let id: String
    let generation: NativePushGeneration
    let revoked: Bool
}
struct NativePushRegistration: Decodable, Equatable, Sendable {
    let id: String
    let generation: NativePushGeneration
}
struct NativePushCapabilities: Decodable, Sendable { let available: Bool; let provider: NativePushProvider }
enum NativePushContract {
    static func uuid(_ value: String) -> Bool {
        value.utf8.count == 36 && value.range(of: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$", options: .regularExpression) != nil
    }
    static func opaque(_ value: String) -> Bool {
        guard value.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              let bytes = Data(base64Encoded: value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + "=") else { return false }
        return bytes.count == 32 && bytes.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") == value
    }
    static func apnsToken(_ bytes: Data) throws -> DevicePushToken {
        guard (16...128).contains(bytes.count) else { throw NativePushContractError.invalid }
        return try DevicePushToken(bytes.map { String(format: "%02x", $0) }.joined())
    }
    static func register(installation: NativePushInstallation, token: DevicePushToken, generation: NativePushGeneration?) throws -> Data {
        guard token.value.range(of: "^(?:[a-f0-9]{2}){16,128}$", options: .regularExpression) != nil else { throw NativePushContractError.invalid }
        struct Body: Encodable {
            let provider = "APNS"
            let token: String
            let installationId: String
            let bindingSecret: String
            let generation: NativePushGeneration?
        }
        return try JSONEncoder().encode(Body(token: token.value, installationId: installation.installationID, bindingSecret: installation.bindingSecret, generation: generation))
    }
    static func resolve(installation: NativePushInstallation) throws -> Data {
        struct Body: Encodable { let installationId: String; let bindingSecret: String }
        return try JSONEncoder().encode(Body(installationId: installation.installationID, bindingSecret: installation.bindingSecret))
    }
    static func remove(installation: NativePushInstallation, generation: NativePushGeneration) throws -> Data {
        struct Body: Encodable { let generation: NativePushGeneration; let bindingSecret: String }
        return try JSONEncoder().encode(Body(generation: generation, bindingSecret: installation.bindingSecret))
    }
    static func registration(_ data: Data) throws -> NativePushRegistration {
        let value = try JSONDecoder().decode(NativePushRegistration.self, from: data)
        guard uuid(value.id) else { throw NativePushContractError.invalid }
        return value
    }
    static func binding(_ data: Data) throws -> NativePushBinding? {
        struct Body: Decodable {
            let binding: NativePushBinding?
            enum CodingKeys: CodingKey { case binding }
            init(from decoder: any Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                guard c.contains(.binding) else { throw NativePushContractError.invalid }
                binding = try c.decodeIfPresent(NativePushBinding.self, forKey: .binding)
            }
        }
        let value = try JSONDecoder().decode(Body.self, from: data).binding
        guard value == nil || uuid(value!.id) else { throw NativePushContractError.invalid }
        return value
    }
    static func capabilities(_ data: Data) throws -> NativePushCapabilities {
        let value = try JSONDecoder().decode(NativePushCapabilities.self, from: data)
        guard value.provider == .apns else { throw NativePushContractError.invalid }
        return value
    }
}
