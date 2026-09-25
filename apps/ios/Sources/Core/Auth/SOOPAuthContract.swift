import Foundation
import CryptoKit
import Security

enum SOOPIntent: String, Codable, Sendable { case login, link }
enum SOOPAuthError: String, Error, LocalizedError, Sendable, Hashable {
    case invalidRequest = "INVALID_REQUEST", forbidden = "FORBIDDEN", unauthenticated = "UNAUTHENTICATED"
    case recentAuth = "RECENT_AUTH_REQUIRED", terms = "TERMS_REQUIRED", sessionChanged = "LINK_SESSION_CHANGED"
    case conflict = "SOOP_LINK_CONFLICT", failed = "NATIVE_CALLBACK_FAILED", unavailable = "AUTH_UNAVAILABLE", rateLimited = "RATE_LIMITED"
    case expired, cancelled, exchangeUncertain, consentRequired, browserUnavailable
    var errorDescription: String? {
        switch self {
        case .recentAuth: "다시 로그인한 뒤 SOOP 계정을 연결해 주세요. 계정 관리에서 로그아웃할 수 있어요."
        case .terms, .consentRequired: "로그인 상태를 확인하지 못했어요. 다시 로그인해 주세요."
        case .sessionChanged: "로그인 상태가 변경되어 계정 연결을 중단했어요."
        case .conflict: "이미 다른 계정에 연결된 SOOP 계정이에요. 현재 계정은 변경하지 않았어요."
        case .unavailable: "지금은 SOOP 로그인에 연결할 수 없어요. 다시 시도해 주세요."
        case .rateLimited: "요청이 많아요. 잠시 기다린 뒤 다시 시작해 주세요."
        case .expired: "로그인 시간이 지났어요. 다시 시작해 주세요."
        case .cancelled: "로그인을 취소했어요."
        case .exchangeUncertain: "로그인 완료를 확인하지 못했어요. 다시 시작해 주세요."
        case .browserUnavailable: "인증 화면을 열지 못했어요. 다시 시도해 주세요."
        default: "로그인을 완료하지 못했어요. 다시 시작해 주세요."
        }
    }
    static let callbackErrors: Set<String> = [failed.rawValue, recentAuth.rawValue, terms.rawValue, sessionChanged.rawValue, conflict.rawValue, unavailable.rawValue]
    static func response(_ data: Data, status: Int) -> any Error {
        struct Failure: Decodable { let error: Detail; struct Detail: Decodable { let code: String } }
        if let body = try? JSONDecoder().decode(Failure.self, from: data), let code = SOOPAuthError(rawValue: body.error.code) {
            let expected: [SOOPAuthError: Int] = [.invalidRequest:400, .forbidden:403, .unauthenticated:401, .recentAuth:403, .terms:403, .sessionChanged:401, .conflict:409, .failed:400, .unavailable:503, .rateLimited:429]
            if expected[code] == status { return code }
        }
        if status == 404 || status >= 500 { return SOOPAuthError.unavailable }
        if status == 429 { return SOOPAuthError.rateLimited }
        return ProductError.invalidResponse
    }
}
struct SOOPProof: Codable, Equatable, Sendable, CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    var description: String { "SOOPProof(<redacted>)" }
    var debugDescription: String { description }
    var customMirror: Mirror { Mirror(self, children: ["proof": "<redacted>"]) }
    let verifier: String
    let state: String
    var challenge: String { Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncoded }
    var valid: Bool { NativeCredential.isOpaque(verifier) && NativeCredential.isOpaque(state) && verifier != state }
    static func generate() throws -> SOOPProof {
        func random() throws -> String {
            var bytes = [UInt8](repeating: 0, count: 32)
            guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw ProductError.secureStorage }
            return Data(bytes).base64URLEncoded
        }
        return try SOOPProof(verifier: random(), state: random())
    }
}
private extension Data {
    var base64URLEncoded: String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
}
extension NativeEnvironment {
    var webHost: String { self == .qa ? "qa.rogi.chat" : "rogi.chat" }
    var rulesURL: URL { URL(string: "https://\(webHost)/rules")! }
}
struct SOOPStart: Encodable, Sendable {
    let clientId = "ios"
    let intent: SOOPIntent
    let codeChallenge: String
    let codeChallengeMethod = "S256"
    let returnState: String
    let termsVersion: String?
}
struct SOOPExchange: Encodable, Sendable {
    let clientId = "ios"
    let transactionId: String
    let code: String
    let codeVerifier: String
}
struct SOOPStartResponse: Decodable, Sendable {
    let transactionId: String
    let authorizeUrl: URL
    let expiresIn: Int
    func validate(environment: NativeEnvironment) throws {
        guard Self.validTransaction(transactionId), expiresIn == 600,
              let c = URLComponents(url: authorizeUrl, resolvingAgainstBaseURL: false),
              c.scheme == "https", c.host == environment.baseURL.host, c.port == nil, c.user == nil, c.password == nil, c.fragment == nil,
              c.percentEncodedPath == "/v1/auth/native/soop/launch", c.queryItems?.count == 1,
              c.queryItems?.first?.name == "request", let value = c.queryItems?.first?.value, NativeCredential.isOpaque(value) else { throw ProductError.invalidResponse }
    }
    static func validTransaction(_ value: String) -> Bool {
        value.range(of: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$", options: .regularExpression) != nil
    }
}
struct SOOPIssuedCredential: Decodable, Sendable {
    let tokenType: String
    let accessToken: String
    let expiresAt: String
    func credential(environment: NativeEnvironment, now: Date) throws -> NativeCredential {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var expiry = formatter.date(from: expiresAt)
        if expiry == nil { formatter.formatOptions = [.withInternetDateTime]; expiry = formatter.date(from: expiresAt) }
        guard tokenType == "Bearer", NativeCredential.isOpaque(accessToken), let expiry, expiry > now,
              expiry.timeIntervalSince(now) <= 7 * 24 * 60 * 60 + 60 else { throw ProductError.invalidResponse }
        return NativeCredential(token: accessToken, expiresAt: expiry, environment: environment)
    }
}
struct SOOPExchangeResponse: Decodable, Sendable {
    let tokenType: String
    let accessToken: String
    let expiresAt: String
    let session: NativeSessionDTO
    func credential(environment: NativeEnvironment, now: Date) throws -> NativeCredential {
        try SOOPIssuedCredential(tokenType: tokenType, accessToken: accessToken, expiresAt: expiresAt).credential(environment: environment, now: now)
    }
    func validated(environment: NativeEnvironment, now: Date) throws -> (NativeCredential, SessionSnapshot) {
        let credential = try credential(environment: environment, now: now)
        guard expiresAt == session.expiresAt else { throw ProductError.invalidResponse }
        return try (credential, session.snapshot(credential: credential, now: now))
    }
}
enum SOOPCallback: Equatable, Sendable {
    case completion(String), failure(SOOPAuthError)
    static func parse(_ url: URL, environment: NativeEnvironment, expectedState: String) throws -> SOOPCallback {
        guard let c = URLComponents(url: url, resolvingAgainstBaseURL: false), c.scheme == "https", c.host == environment.webHost,
              c.port == nil, c.user == nil, c.password == nil, c.fragment == nil,
              c.percentEncodedPath == "/mobile/auth/complete", let items = c.queryItems, items.count == 2,
              Set(items.map(\.name)).count == 2, items.first(where: { $0.name == "state" })?.value == expectedState,
              NativeCredential.isOpaque(expectedState) else { throw ProductError.invalidResponse }
        if let code = items.first(where: { $0.name == "code" })?.value, NativeCredential.isOpaque(code) { return .completion(code) }
        if let value = items.first(where: { $0.name == "error" })?.value, SOOPAuthError.callbackErrors.contains(value), let error = SOOPAuthError(rawValue: value) { return .failure(error) }
        throw ProductError.invalidResponse
    }
}
