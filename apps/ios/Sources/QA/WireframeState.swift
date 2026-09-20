#if ROGICHAT_QA
// UI-only state. Never use these values as a session, repository, or API DTO.
enum PreviewRole: String, CaseIterable {
    case fan = "팬", streamer = "스트리머"
}
enum PreviewPage: String, Hashable {
    case link = "SOOP 계정 연결", rooms = "대화", chat = "대화방", settings = "설정"
    case profile = "내 프로필", account = "계정 관리", report = "신고 및 차단"
}
enum ListScenario: String, CaseIterable {
    case content = "목록", loading = "로딩", empty = "빈 목록", error = "오류"
}
enum PreviewAudience: String, CaseIterable {
    case `private` = "개인 답장", shared = "전체 대화"
}
struct SampleRoom: Identifiable {
    let id: String
    let title: String
    let summary: String
}
enum WireframeFixtures {
    static let rooms = [
        SampleRoom(id: "sample-room-a", title: "샘플 스트리머 A", summary: "함께 나누는 오늘의 이야기"),
        SampleRoom(id: "sample-room-b", title: "샘플 스트리머 B", summary: "다음 대화를 기다리고 있어요")
    ]
    static let fans = ["샘플 팬 A", "샘플 팬 B"]
}

struct WireframeState {
    private(set) var role: PreviewRole = .fan
    private(set) var path: [PreviewPage] = []
    private(set) var linkPreviewPassed = false
    private(set) var roomID: String?
    var scenario: ListScenario = .content
    private(set) var audience: PreviewAudience = .private
    private(set) var target: String?
    private(set) var draft = ""

    var page: PreviewPage? { path.last }
    var canCompose: Bool {
        page == .chat && roomID != nil && (role == .fan || audience == .shared || target != nil)
    }
    mutating func reset() { self = WireframeState(role: role) }
    mutating func switchRole(_ value: PreviewRole) {
        if value != role { self = WireframeState(role: value) }
    }
    mutating func previewLink() {
        guard path.isEmpty else { return }
        path = [.link]
    }
    mutating func previewRooms() {
        guard page == .link else { return }
        linkPreviewPassed = true
        path = [.rooms]
    }
    mutating func openRoom(_ id: String) {
        guard linkPreviewPassed, page == .rooms, scenario == .content,
              WireframeFixtures.rooms.contains(where: { $0.id == id }) else { return }
        roomID = id
        draft = ""
        target = nil
        audience = .private
        path.append(.chat)
    }
    mutating func open(_ value: PreviewPage) {
        switch (page, value) {
        case (.rooms, .settings), (.settings, .profile), (.settings, .account), (.chat, .report):
            path.append(value)
        default: break
        }
    }
    mutating func changeAudience(_ value: PreviewAudience) {
        guard role == .streamer, page == .chat, audience != value else { return }
        audience = value
        target = nil
        draft = ""
    }
    mutating func selectTarget(_ value: String) {
        guard role == .streamer, page == .chat, WireframeFixtures.fans.contains(value) else { return }
        if target == value && audience == .private { return }
        audience = .private
        target = value
        draft = ""
    }
    mutating func editDraft(_ value: String) {
        guard canCompose else { return }
        draft = String(value.prefix(2000))
    }
    // NavigationStack back gesture/button may only remove an existing suffix.
    mutating func pop(to newPath: [PreviewPage]) {
        guard newPath.count < path.count, Array(path.prefix(newPath.count)) == newPath else { return }
        path = newPath
        if path.isEmpty { reset() }
        else if !path.contains(.chat) {
            roomID = nil
            target = nil
            draft = ""
        }
    }
}
#endif
