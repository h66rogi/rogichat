import Foundation

// Distinct from the opaque account generation and local session epoch.
struct PreferenceGeneration: Codable, Equatable, Sendable {
    let value: String
    init(_ value: String) throws {
        guard !value.isEmpty, value.utf8.count <= 20, value.utf8.first != 48,
              value.utf8.allSatisfy({ (48...57).contains($0) }), let number = UInt64(value), number > 0 else { throw ProductError.invalidResponse }
        self.value = value
    }
    init(from decoder: any Decoder) throws { try self.init(decoder.singleValueContainer().decode(String.self)) }
    func encode(to encoder: any Encoder) throws { var c = encoder.singleValueContainer(); try c.encode(value) }
}
struct AccountNotificationPreferences: Decodable, Equatable, Sendable {
    let pushEnabled: Bool
    let generation: PreferenceGeneration
}
struct DisableAccountNotifications: Encodable, Sendable {
    let pushEnabled = false
    let expectedGeneration: PreferenceGeneration
}
struct ReadStateID: Codable, Equatable, Sendable {
    let value: String
    init(_ value: String) throws {
        guard value.utf8.count == 36, value.range(of: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$", options: .regularExpression) != nil else { throw ProductError.invalidResponse }
        self.value = value
    }
    init(from decoder: any Decoder) throws { try self.init(decoder.singleValueContainer().decode(String.self)) }
    func encode(to encoder: any Encoder) throws { var c = encoder.singleValueContainer(); try c.encode(value) }
}
struct OwnReadContext: Codable, Equatable, Sendable {
    let value: String
    init(_ value: String) throws {
        guard value.utf8.count == 43, value.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 }),
              let bytes = Data(base64Encoded: value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + "="), bytes.count == 32,
              bytes.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") == value else { throw ProductError.invalidResponse }
        self.value = value
    }
    init(from decoder: any Decoder) throws { try self.init(decoder.singleValueContainer().decode(String.self)) }
    func encode(to encoder: any Encoder) throws { var c = encoder.singleValueContainer(); try c.encode(value) }
}
struct OwnReadState: Decodable, Equatable, Sendable {
    let messageId: ReadStateID?
    enum CodingKeys: String, CodingKey { case messageId }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard c.contains(.messageId) else { throw ProductError.invalidResponse }
        messageId = try c.decodeIfPresent(ReadStateID.self, forKey: .messageId)
    }
}
struct OwnReadStates: Decodable, Equatable, Sendable {
    let readContext: OwnReadContext
    let items: [OwnReadState]
    enum CodingKeys: String, CodingKey { case readContext, items }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        readContext = try c.decode(OwnReadContext.self, forKey: .readContext)
        items = try c.decode([OwnReadState].self, forKey: .items)
        guard items.count <= 100 else { throw ProductError.invalidResponse }
    }
}
struct ReportOwnReadState: Encodable, Sendable {
    let messageId: ReadStateID
    let readContext: OwnReadContext
}
enum M11Error: Error, LocalizedError, Equatable, Sendable {
    case conflict, unavailable, forbidden, notFound, invalidRequest, superseded
    var errorDescription: String? {
        switch self {
        case .conflict: "다른 곳에서 설정이 변경되었어요. 현재 상태를 다시 확인해 주세요."
        case .unavailable: "지금은 알림 설정을 확인하거나 변경할 수 없어요. 다시 시도해 주세요."
        case .forbidden: "이 설정에 접근할 수 없어요."
        case .notFound: "요청한 정보를 찾을 수 없어요."
        case .invalidRequest: "요청을 처리하지 못했어요. 현재 상태를 다시 확인해 주세요."
        case .superseded: "새로운 요청에서 상태를 확인하고 있어요."
        }
    }
    static func response(_ data: Data, status: Int) -> any Error {
        if status == 401 { return ProductError.unauthenticated }
        struct Failure: Decodable { let error: Detail; struct Detail: Decodable { let code: String } }
        guard let code = try? JSONDecoder().decode(Failure.self, from: data).error.code else { return ProductError.invalidResponse }
        switch (status, code) {
        case (400, "INVALID_REQUEST"): return M11Error.invalidRequest
        case (403, "SOOP_LINK_REQUIRED"): return ProductError.linkRequired
        case (403, "FORBIDDEN"): return M11Error.forbidden
        case (404, "NOT_FOUND"): return M11Error.notFound
        case (409, "CONFLICT"): return M11Error.conflict
        case (503, "AUTH_UNAVAILABLE"): return M11Error.unavailable
        default: return (status == 408 || status == 429 || status >= 500) ? ProductError.connection : ProductError.invalidResponse
        }
    }
}
protocol AccountNotificationsServing: Sendable {
    func loadNotificationPreferences(scope: UUID) async throws -> AccountNotificationPreferences
    func disableAccountNotifications(expected: PreferenceGeneration, scope: UUID) async throws -> AccountNotificationPreferences
}
