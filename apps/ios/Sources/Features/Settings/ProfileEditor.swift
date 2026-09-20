import Foundation

enum ProfilePhase: String, CaseIterable, Sendable {
    case ready = "편집", loading = "불러오는 중", failed = "불러오기 오류", unavailable = "미연동"
}
struct ProfileEditor: Sendable {
    let baseline: String
    private(set) var draft: String
    var phase: ProfilePhase = .ready
    init(baseline: String) { self.baseline = baseline; draft = baseline }
    // ECMAScript trim matches the current server nickname normalizer.
    private static let whitespace = CharacterSet(charactersIn: "\u{9}\u{a}\u{b}\u{c}\u{d} \u{a0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}")
    var normalized: String { draft.precomposedStringWithCanonicalMapping.trimmingCharacters(in: Self.whitespace) }
    var length: Int { normalized.unicodeScalars.count }
    var error: String? {
        if length == 0 { return "표시 이름을 입력해 주세요." }
        if length > 40 { return "표시 이름은 40자까지 입력할 수 있어요." }
        if normalized.unicodeScalars.contains(where: { [.control, .format].contains($0.properties.generalCategory) }) {
            return "제어 문자나 보이지 않는 형식 문자는 사용할 수 없어요."
        }
        return nil
    }
    var changed: Bool { draft != baseline }
    mutating func edit(_ value: String) {
        guard phase == .ready else { return }
        draft = String(String.UnicodeScalarView(value.unicodeScalars.prefix(200)))
    }
    mutating func discard() { draft = baseline }
}
