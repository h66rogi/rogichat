import Foundation

struct Birthday: Codable, Equatable, Sendable {
    let month: Int
    let day: Int
    var isValid: Bool { (1...12).contains(month) && (1...Self.days(in: month)).contains(day) }
    static func days(in month: Int) -> Int {
        guard (1...12).contains(month) else { return 0 }
        return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
    }
}

// PATCH distinguishes unchanged, explicit deletion and a newly assigned value.
// Mirrors modules/users/dto/update-profile.dto.ts, without an invented birth year.
struct ProfileUpdate: Encodable, Sendable {
    var nickname: String?
    var birthday: Birthday?
    var birthdayChanged = false
    var birthdayVisibleToStreamers: Bool?
    var isEmpty: Bool { nickname == nil && !birthdayChanged && birthdayVisibleToStreamers == nil }
    var isValid: Bool {
        !isEmpty && (nickname.map { ProfileEditor(baseline: $0).error == nil && ProfileEditor(baseline: $0).normalized.utf8.elementsEqual($0.utf8) } ?? true)
            && (!birthdayChanged || birthday?.isValid != false)
    }
    private enum CodingKeys: String, CodingKey { case nickname, birthday, birthdayVisibleToStreamers }
    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(nickname, forKey: .nickname)
        if birthdayChanged {
            if let birthday { try container.encode(birthday, forKey: .birthday) }
            else { try container.encodeNil(forKey: .birthday) }
        }
        try container.encodeIfPresent(birthdayVisibleToStreamers, forKey: .birthdayVisibleToStreamers)
    }
}

struct ProfileDraft: Sendable {
    let original: AccountProfile
    var name: ProfileEditor
    var birthday: Birthday?
    var birthdayVisibleToStreamers: Bool
    init(profile: AccountProfile) {
        original = profile
        name = ProfileEditor(baseline: profile.displayName)
        birthday = profile.birthday
        birthdayVisibleToStreamers = profile.birthdayVisibleToStreamers
    }
    var update: ProfileUpdate {
        ProfileUpdate(nickname: name.normalized == original.displayName ? nil : name.normalized,
                      birthday: birthday, birthdayChanged: birthday != original.birthday,
                      birthdayVisibleToStreamers: birthdayVisibleToStreamers == original.birthdayVisibleToStreamers ? nil : birthdayVisibleToStreamers)
    }
    var changed: Bool { name.changed || birthday != original.birthday || birthdayVisibleToStreamers != original.birthdayVisibleToStreamers }
    var canSave: Bool { name.error == nil && (birthday?.isValid ?? true) && !update.isEmpty }
}
