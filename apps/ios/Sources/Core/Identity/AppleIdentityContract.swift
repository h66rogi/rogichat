import Foundation

enum AppleIdentityError: Error { case invalidResponse, invalidRequest }
struct AppleIdentityStart: Encodable, Sendable {
    let clientId = "ios"
    let intent: String
    let codeChallenge: String
    let returnState: String
    init(intent: IdentityIntent, codeChallenge: String, returnState: String) throws {
        guard AppleIdentityContract.opaque(codeChallenge), AppleIdentityContract.opaque(returnState) else { throw AppleIdentityError.invalidRequest }
        self.intent = intent == .login ? "login" : "link"
        self.codeChallenge = codeChallenge; self.returnState = returnState
    }
}
struct AppleIdentityStartResponse: Decodable, Sendable, CustomStringConvertible {
    let transactionId: String
    let state: String
    let nonce: String
    let authorizeUrl: String?
    let expiresIn: Int
    enum CodingKeys: CodingKey { case transactionId, state, nonce, authorizeUrl, expiresIn }
    init(transactionId: String, state: String, nonce: String, authorizeUrl: String?, expiresIn: Int) {
        self.transactionId = transactionId; self.state = state; self.nonce = nonce
        self.authorizeUrl = authorizeUrl; self.expiresIn = expiresIn
    }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard c.contains(.authorizeUrl) else { throw AppleIdentityError.invalidResponse }
        transactionId = try c.decode(String.self, forKey: .transactionId)
        state = try c.decode(String.self, forKey: .state); nonce = try c.decode(String.self, forKey: .nonce)
        authorizeUrl = try c.decodeIfPresent(String.self, forKey: .authorizeUrl)
        expiresIn = try c.decode(Int.self, forKey: .expiresIn)
    }
    var description: String { "AppleIdentityStartResponse([redacted])" }
    func validate() throws {
        guard AppleIdentityContract.uuid(transactionId), AppleIdentityContract.opaque(state),
              AppleIdentityContract.opaque(nonce), authorizeUrl == nil, expiresIn == 600 else { throw AppleIdentityError.invalidResponse }
    }
}
struct AppleIdentityComplete: Encodable, Sendable, CustomStringConvertible {
    let transactionId: String
    let state: String
    let authorizationCode: String
    let identityToken: String
    let codeVerifier: String
    var description: String { "AppleIdentityComplete([redacted])" }
}
struct AppleIdentityExchange: Encodable, Sendable, CustomStringConvertible {
    let clientId = "ios"
    let transactionId: String
    let code: String
    let codeVerifier: String
    var description: String { "AppleIdentityExchange([redacted])" }
}
enum AppleIdentityEndpoint: Sendable {
    case start(AppleIdentityStart), complete(AppleIdentityComplete), exchange(AppleIdentityExchange)
    var path: String {
        switch self {
        case .start: "auth/apple/start"
        case .complete: "auth/apple/native/complete"
        case .exchange: "auth/apple/exchange"
        }
    }
    func body() throws -> Data {
        switch self {
        case .start(let value): return try JSONEncoder().encode(value)
        case .complete(let value):
            guard AppleIdentityContract.uuid(value.transactionId), AppleIdentityContract.opaque(value.state),
                  AppleIdentityContract.bounded(value.authorizationCode, maximum: 4096),
                  AppleIdentityContract.bounded(value.identityToken, maximum: 16384),
                  AppleIdentityContract.verifier(value.codeVerifier) else { throw AppleIdentityError.invalidRequest }
            return try JSONEncoder().encode(value)
        case .exchange(let value):
            guard AppleIdentityContract.uuid(value.transactionId), AppleIdentityContract.opaque(value.code),
                  AppleIdentityContract.verifier(value.codeVerifier) else { throw AppleIdentityError.invalidRequest }
            return try JSONEncoder().encode(value)
        }
    }
}
enum AppleIdentityContract {
    static func opaque(_ value: String) -> Bool {
        guard value.utf8.count == 43, value.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              let bytes = Data(base64Encoded: value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + "=") else { return false }
        return bytes.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") == value
    }
    static func uuid(_ value: String) -> Bool {
        value.utf8.count == 36 && value.range(of: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$", options: .regularExpression) != nil
    }
    static func verifier(_ value: String) -> Bool {
        (43...128).contains(value.utf8.count) && value.utf8.allSatisfy {
            (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || [45, 46, 95, 126].contains($0)
        }
    }
    static func bounded(_ value: String, maximum: Int) -> Bool {
        !value.isEmpty && value.utf8.count <= maximum && !value.unicodeScalars.contains {
            CharacterSet.whitespacesAndNewlines.union(.controlCharacters).contains($0)
        }
    }
    static func completion(_ data: Data) throws -> String {
        struct Completion: Decodable { let code: String }
        let result = try JSONDecoder().decode(Completion.self, from: data)
        guard opaque(result.code) else { throw AppleIdentityError.invalidResponse }
        return result.code
    }
}
