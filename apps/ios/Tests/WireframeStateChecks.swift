#if ROGICHAT_QA
@main
struct WireframeStateChecks {
    static func rooms(_ role: PreviewRole = .fan) -> WireframeState {
        var state = WireframeState()
        state.switchRole(role)
        state.previewLink()
        state.previewRooms()
        return state
    }
    static func chat(_ role: PreviewRole = .fan) -> WireframeState {
        var state = rooms(role)
        state.openRoom("sample-room-a")
        return state
    }
    static func main() {
        var initial = WireframeState()
        initial.previewRooms()
        initial.openRoom("sample-room-a")
        initial.open(.settings)
        precondition(initial.path.isEmpty && !initial.linkPreviewPassed)
        var list = rooms()
        list.openRoom("unknown")
        precondition(list.page == .rooms)
        list.scenario = .empty
        list.openRoom("sample-room-a")
        precondition(list.page == .rooms)

        var fan = chat()
        fan.editDraft("hello")
        fan.changeAudience(.shared)
        fan.selectTarget("샘플 팬 B")
        precondition(fan.audience == .private && fan.target == nil && fan.draft == "hello" && fan.canCompose)

        var streamer = chat(.streamer)
        precondition(!streamer.canCompose)
        streamer.editDraft("unsafe")
        precondition(streamer.draft.isEmpty)
        streamer.selectTarget("샘플 팬 A")
        streamer.editDraft("private")
        precondition(streamer.canCompose && streamer.draft == "private")
        streamer.selectTarget("샘플 팬 B")
        precondition(streamer.draft.isEmpty)
        streamer.editDraft("private B")
        streamer.changeAudience(.shared)
        precondition(streamer.canCompose && streamer.draft.isEmpty && streamer.target == nil)
        streamer.changeAudience(.private)
        precondition(!streamer.canCompose)

        fan.open(.report)
        fan.pop(to: [.rooms, .chat])
        precondition(fan.draft == "hello")
        fan.pop(to: [.settings]) // reject forged navigation
        precondition(fan.page == .chat)
        fan.pop(to: [.rooms])
        fan.openRoom("sample-room-b")
        precondition(fan.roomID == "sample-room-b" && fan.draft.isEmpty)
        fan.editDraft(String(repeating: "a", count: 3000))
        precondition(fan.draft.count == 2000)
        fan.switchRole(.streamer)
        precondition(fan.path.isEmpty && fan.roomID == nil && fan.draft.isEmpty && !fan.linkPreviewPassed)

        var settings = rooms()
        settings.open(.settings)
        settings.open(.account)
        settings.pop(to: [.rooms, .settings])
        precondition(settings.page == .settings)
        settings.pop(to: [])
        precondition(settings.path.isEmpty && !settings.linkPreviewPassed)
        print("iOS wireframe: link gate, roles, recipient/draft isolation, back navigation, reset and input bounds passed")
    }
}
#endif
