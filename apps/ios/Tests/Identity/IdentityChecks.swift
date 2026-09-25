import Foundation

@main struct IdentityChecks {
    static func main() throws {
        var attempt = IdentityAttempt()
        let loggedOut = IdentityScope(environment: "qa", sessionEpoch: UUID(), accountID: nil)
        attempt.bind(loggedOut)
        precondition(attempt.begin(.link) == nil)
        let cancelled = attempt.begin(.login)!
        attempt.cancel(); precondition(!attempt.consume(cancelled))
        let first = attempt.begin(.login)!, second = attempt.begin(.login)!
        precondition(!attempt.consume(first) && attempt.consume(second) && !attempt.consume(second))
        let a = IdentityScope(environment: "qa", sessionEpoch: UUID(), accountID: "a")
        attempt.bind(a); precondition(attempt.begin(.login) == nil)
        let link = attempt.begin(.link)!
        attempt.bind(IdentityScope(environment: "qa", sessionEpoch: UUID(), accountID: "b"))
        attempt.bind(IdentityScope(environment: "qa", sessionEpoch: UUID(), accountID: "a"))
        precondition(!attempt.consume(link))
        let proof = Data(repeating: 1, count: 32).base64EncodedString().replacingOccurrences(of: "=", with: "")
        let login = try AppleIdentityStart(intent: .login, codeChallenge: proof, returnState: proof)
        let loginJSON = try JSONSerialization.jsonObject(with: AppleIdentityEndpoint.start(login).body()) as! [String: Any]
        precondition(loginJSON["termsVersion"] == nil && loginJSON["codeChallengeMethod"] == nil)
        let linkBody = try AppleIdentityStart(intent: .link, codeChallenge: proof, returnState: proof)
        let linkJSON = try JSONSerialization.jsonObject(with: AppleIdentityEndpoint.start(linkBody).body()) as! [String: Any]
        precondition(linkJSON["termsVersion"] == nil)
        let response = AppleIdentityStartResponse(transactionId: "00000000-0000-4000-8000-000000000001", state: proof, nonce: proof, authorizeUrl: nil, expiresIn: 600)
        try response.validate()
        let invalid = AppleIdentityStartResponse(transactionId: response.transactionId, state: proof, nonce: proof, authorizeUrl: "https://example.invalid", expiresIn: 600)
        do { try invalid.validate(); preconditionFailure("Unexpected native browser URL") } catch {}
        precondition(!AppleIdentityContract.opaque(String(repeating: "!", count: 43)))
        print("Identity scope and Apple wire checks passed")
    }
}
