import Foundation

struct NativeSessionDTO: Decodable, Sendable {
    struct Account: Decodable, Sendable {
        let userId: String
        let nickname: String
        let avatarAssetId: String?
        enum CodingKeys: String, CodingKey { case userId, nickname, avatarAssetId }
        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            guard c.contains(.avatarAssetId) else { throw ProductError.invalidResponse }
            userId = try c.decode(String.self, forKey: .userId)
            nickname = try c.decode(String.self, forKey: .nickname)
            avatarAssetId = try c.decodeIfPresent(String.self, forKey: .avatarAssetId)
        }
    }
    struct Capabilities: Decodable, Sendable { let chat: Bool }
    let authenticated: Bool
    let account: Account
    let soopLinkStatus: String
    let onboardingState: String
    let expiresAt: String
    let accountGeneration: String
    let accountPartition: String?
    let capabilities: Capabilities
    enum CodingKeys: String, CodingKey { case authenticated, account, soopLinkStatus, onboardingState, expiresAt, accountGeneration, accountPartition, capabilities }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        authenticated = try c.decode(Bool.self, forKey: .authenticated)
        account = try c.decode(Account.self, forKey: .account)
        soopLinkStatus = try c.decode(String.self, forKey: .soopLinkStatus)
        onboardingState = try c.decode(String.self, forKey: .onboardingState)
        expiresAt = try c.decode(String.self, forKey: .expiresAt)
        accountGeneration = try c.decode(String.self, forKey: .accountGeneration)
        capabilities = try c.decode(Capabilities.self, forKey: .capabilities)
        accountPartition = try c.decodeIfPresent(String.self, forKey: .accountPartition)
        guard !c.contains(.accountPartition) || accountPartition != nil else { throw ProductError.invalidResponse }
    }
    static func validPartition(_ value: String) -> Bool {
        guard NativeCredential.isOpaque(value), let data = Data(base64Encoded: value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + "="), data.count == 32 else { return false }
        return data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") == value
    }
    func snapshot(credential: NativeCredential, now: Date) throws -> SessionSnapshot {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var expiry = formatter.date(from: expiresAt)
        if expiry == nil { formatter.formatOptions = [.withInternetDateTime]; expiry = formatter.date(from: expiresAt) }
        guard authenticated, UUID(uuidString: account.userId) != nil,
              account.avatarAssetId == nil || UUID(uuidString: account.avatarAssetId!) != nil,
              NativeCredential.isOpaque(accountGeneration), accountPartition.map(Self.validPartition) ?? true, let expiry,
              abs(expiry.timeIntervalSince(credential.expiresAt)) < 0.001 else { throw ProductError.invalidResponse }
        guard expiry > now else { throw ProductError.unauthenticated }
        let ready = soopLinkStatus == "VERIFIED" && onboardingState == "READY" && capabilities.chat
        let restricted = soopLinkStatus == "REQUIRED" && onboardingState == "SOOP_LINK_REQUIRED" && !capabilities.chat
        guard ready || restricted else { throw ProductError.invalidResponse }
        let summary = AccountSummary(id: account.userId, displayName: account.nickname, signInMethod: nil,
                                     soopConnected: ready, avatarAssetID: account.avatarAssetId)
        guard summary.isValid else { throw ProductError.invalidResponse }
        return SessionSnapshot(access: ready ? .ready : .linkRequired, account: summary,
                               serverGeneration: accountGeneration, expiresAt: expiry, accountPartition: accountPartition)
    }
}
struct NativeProfileDTO: Decodable, Sendable {
    struct Avatar: Decodable, Sendable { let assetId: String }
    struct SOOP: Decodable, Sendable { let displayId: String }
    let id: String
    let nickname: String
    let avatar: Avatar?
    let birthday: Birthday?
    let birthdayVisibleToStreamers: Bool
    let soop: SOOP?
    let providerAvatarUrl: String?
    enum CodingKeys: String, CodingKey { case id, nickname, avatar, birthday, birthdayVisibleToStreamers, soop, providerAvatarUrl }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard c.contains(.avatar), c.contains(.birthday) else { throw ProductError.invalidResponse }
        id = try c.decode(String.self, forKey: .id)
        nickname = try c.decode(String.self, forKey: .nickname)
        avatar = try c.decodeIfPresent(Avatar.self, forKey: .avatar)
        birthday = try c.decodeIfPresent(Birthday.self, forKey: .birthday)
        birthdayVisibleToStreamers = try c.decode(Bool.self, forKey: .birthdayVisibleToStreamers)
        soop = try c.decodeIfPresent(SOOP.self, forKey: .soop)
        providerAvatarUrl = try c.decodeIfPresent(String.self, forKey: .providerAvatarUrl)
        if let providerAvatarUrl {
            guard let url = URL(string: providerAvatarUrl), url.scheme == "https", url.host != nil,
                  url.user == nil, url.password == nil, url.fragment == nil else { throw ProductError.invalidResponse }
        }
    }
    func profile(expectedID: String) throws -> AccountProfile {
        let profile = AccountProfile(id: id, displayName: nickname, birthday: birthday,
                                     birthdayVisibleToStreamers: birthdayVisibleToStreamers, avatarAssetID: avatar?.assetId,
                                     soopDisplayID: soop?.displayId, providerAvatarURL: providerAvatarUrl)
        guard id == expectedID, UUID(uuidString: id) != nil, profile.isValid,
              soop == nil || !soop!.displayId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              avatar == nil || UUID(uuidString: avatar!.assetId) != nil else { throw ProductError.invalidResponse }
        return profile
    }
}
