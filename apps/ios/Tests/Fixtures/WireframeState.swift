// UI-only state. Never use these values as a session, repository, or API DTO.
enum PreviewRole: String, CaseIterable {
    case fan = "팬", streamer = "스트리머"
}
typealias PreviewPage = AppPage
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
    private(set) var navigation = ShellNavigation()
    var linkPreviewPassed: Bool { navigation.access == .ready }
    private(set) var singleRoomMode = false
    var visibleRooms: [SampleRoom] { singleRoomMode ? Array(WireframeFixtures.rooms.prefix(1)) : WireframeFixtures.rooms }
    private(set) var roomID: String?
    var scenario: ListScenario = .content
    private(set) var audience: PreviewAudience = .private
    private(set) var target: String?
    private(set) var draft = ""
    private(set) var profile = ProfileEditor(baseline: "샘플 프로필")

    var page: AppPage { navigation.page }
    var canCompose: Bool {
        page == .chat && roomID != nil && (role == .fan || audience == .shared || target != nil)
    }
    mutating func reset() { self = WireframeState(role: role) }
    mutating func switchRole(_ value: PreviewRole) {
        if value != role { self = WireframeState(role: value) }
    }
    mutating func switchAccess(_ value: ShellAccess) {
        self = WireframeState(role: role)
        navigation.setAccess(value)
    }
    mutating func selectTab(_ value: AppTab) { navigation.selectTab(value) }
    mutating func previewLink() {
        guard page == .welcome else { return }
        switchAccess(.linkRequired)
    }
    mutating func previewRooms(singleRoom: Bool = false) {
        guard page == .link else { return }
        switchAccess(.ready)
        singleRoomMode = singleRoom
        if singleRoom { openRoom(visibleRooms[0].id) }
    }
    mutating func openRoom(_ id: String) {
        guard linkPreviewPassed, page == .rooms, scenario == .content,
              visibleRooms.contains(where: { $0.id == id }) else { return }
        roomID = id
        draft = ""
        target = nil
        audience = .private
        navigation.open(.chat)
    }
    mutating func open(_ value: PreviewPage) { navigation.open(value) }
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
    mutating func editProfile(_ value: String) { if page == .profile { profile.edit(value) } }
    mutating func discardProfile() { if page == .profile { profile.discard() } }
    mutating func profilePhase(_ value: ProfilePhase) { if page == .profile { profile.phase = value } }
    mutating func editDraft(_ value: String) {
        guard canCompose else { return }
        draft = String(value.prefix(2000))
    }
    mutating func pop(to newPath: [AppPage], in tab: AppTab) {
        navigation.pop(to: newPath, in: tab)
        if !navigation.talkPath.contains(.chat) {
            roomID = nil
            target = nil
            draft = ""
        }
    }
}
