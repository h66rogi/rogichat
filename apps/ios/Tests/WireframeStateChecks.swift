#if ROGICHAT_QA
@main
struct WireframeStateChecks {
    static func rooms(_ role: PreviewRole = .fan) -> WireframeState {
        var state = WireframeState()
        state.switchRole(role); state.previewLink(); state.previewRooms()
        return state
    }
    static func chat(_ role: PreviewRole = .fan) -> WireframeState {
        var state = rooms(role); state.openRoom("sample-room-a"); return state
    }
    static func main() {
        var initial = WireframeState()
        initial.previewRooms(); initial.openRoom("sample-room-a")
        precondition(initial.page == .welcome && !initial.linkPreviewPassed)
        var list = rooms(); list.openRoom("unknown")
        precondition(list.page == .rooms)
        list.scenario = .empty; list.openRoom("sample-room-a")
        precondition(list.page == .rooms)

        var fan = chat(); fan.editDraft("hello"); fan.changeAudience(.shared); fan.selectTarget("샘플 팬 B")
        precondition(fan.audience == .private && fan.target == nil && fan.draft == "hello" && fan.canCompose)
        var streamer = chat(.streamer)
        precondition(!streamer.canCompose)
        streamer.editDraft("unsafe"); precondition(streamer.draft.isEmpty)
        streamer.selectTarget("샘플 팬 A"); streamer.editDraft("private")
        precondition(streamer.canCompose && streamer.draft == "private")
        streamer.selectTarget("샘플 팬 B"); precondition(streamer.draft.isEmpty)
        streamer.editDraft("private B"); streamer.changeAudience(.shared)
        precondition(streamer.canCompose && streamer.draft.isEmpty && streamer.target == nil)
        streamer.changeAudience(.private); precondition(!streamer.canCompose)

        fan.open(.report); fan.pop(to: [.chat], in: .talks)
        precondition(fan.draft == "hello")
        fan.pop(to: [.settings], in: .talks); precondition(fan.page == .chat)
        fan.selectTab(.settings); fan.open(.account)
        fan.selectTab(.talks); precondition(fan.page == .chat && fan.draft == "hello")
        fan.selectTab(.settings); precondition(fan.page == .account)
        fan.selectTab(.talks); fan.pop(to: [], in: .talks); fan.openRoom("sample-room-b")
        precondition(fan.roomID == "sample-room-b" && fan.draft.isEmpty)
        fan.editDraft(String(repeating: "a", count: 3000)); precondition(fan.draft.count == 2000)
        fan.switchAccess(.linkRequired)
        precondition(fan.page == .link && fan.roomID == nil && fan.draft.isEmpty && !fan.linkPreviewPassed)
        fan.selectTab(.settings); fan.open(.profile); precondition(fan.page == .settings)
        fan.open(.account); precondition(fan.page == .account)
        fan.switchRole(.streamer); precondition(fan.page == .welcome)

        for access in [ShellAccess.signedOut, .restoring, .retryableFailure, .blocked, .accountClosing] {
            var nav = ShellNavigation(); nav.setAccess(access); nav.selectTab(.settings)
            nav.open(.account); nav.open(.profile); precondition(nav.page == .settings)
            nav.open(.about); precondition(nav.page == .about)
        }
        var single = WireframeState(); single.previewLink(); single.previewRooms(singleRoom: true)
        precondition(single.page == .chat && single.visibleRooms.count == 1)
        single.pop(to: [], in: .talks); precondition(single.page == .rooms)
        single.selectTab(.settings); single.selectTab(.talks); precondition(single.page == .rooms)
        single.openRoom("sample-room-b"); precondition(single.page == .rooms)
        checkRoutes()
        checkProfile()
        checkNotificationLifecycle()
        print("iOS: preview draft isolation, access gates, independent tab stacks, scope reset, route parser and pending-intent race checks passed")
    }
    static func checkNotificationLifecycle() {
        var foreground = ForegroundState()
        foreground.transition(true); foreground.transition(true); precondition(foreground.epoch == 1)
        foreground.transition(false); foreground.transition(false); foreground.transition(true)
        precondition(foreground.epoch == 2)
        var state = NotificationReadState(); precondition(!state.observing && state.snapshot == nil)
        let first = state.begin(), second = state.begin()
        state.finish(first, NotificationSnapshot(authorization: .allowed)); precondition(state.reading && state.snapshot == nil)
        state.finish(second, NotificationSnapshot(authorization: .denied)); precondition(state.snapshot?.authorization == .denied)
        state.fail(first); precondition(state.snapshot?.authorization == .denied && !state.failed)
        let cancelled = state.begin(); state.cancel(); state.finish(cancelled, NotificationSnapshot(authorization: .allowed))
        precondition(state.snapshot?.authorization == .denied)
        let retry = state.begin(); state.fail(retry); precondition(state.failed && state.snapshot == nil)
        var queue = PendingRouteQueue()
        queue.offer(RoomRouteHint(roomID: "a"), eventID: "a", now: 0, expectedScope: queue.scopeToken)
        let a = queue.begin(now: 0)!
        queue.offer(RoomRouteHint(roomID: "b"), eventID: "b", now: 1, expectedScope: queue.scopeToken)
        precondition(!queue.cancel(a))
        let b = queue.begin(now: 1)!; precondition(queue.cancel(b))
        precondition(queue.consume(b, now: 2) == nil && queue.begin(now: 2) == nil)
        print("Notification lifecycle: foreground dedupe, stale read/cancel/retry and pending cancellation passed")
    }
    static func checkProfile() {
        var editor = ProfileEditor(baseline: "original")
        editor.edit(" \u{1100}\u{1161}\u{a0}"); precondition(editor.normalized == "가")
        editor.edit(String(repeating: "😀", count: 40)); precondition(editor.error == nil)
        editor.edit(String(repeating: "😀", count: 41)); precondition(editor.error != nil)
        for value in ["  ", "a\u{200d}b", "a\nb", "\u{85}"] {
            editor.edit(value); precondition(editor.error != nil)
        }
        editor.edit(String(repeating: "😀", count: 250)); precondition(editor.draft.unicodeScalars.count == 200)
        editor.discard(); precondition(!editor.changed)
        editor.edit("new"); editor.phase = .loading; editor.edit("late"); precondition(editor.draft == "new")
        var state = rooms(); state.selectTab(.settings); state.open(.profile); state.editProfile("temporary")
        state.pop(to: [], in: .settings); state.open(.profile); precondition(state.profile.draft == "temporary")
        state.selectTab(.talks); state.selectTab(.settings); precondition(state.profile.draft == "temporary")
        state.discardProfile(); precondition(state.profile.draft == state.profile.baseline)
        state.editProfile("private"); state.switchAccess(.linkRequired); precondition(!state.profile.changed)
        state.editProfile("forged"); precondition(!state.profile.changed)
        print("Profile: Unicode validation, draft retention, loading guard, discard and account isolation passed")
    }
    static func checkRoutes() {
        let parser = ContentRouteParser(allowedHost: "qa.example.invalid", roomPathPrefix: "/rooms/")
        precondition(parser.parse("https://qa.example.invalid/rooms/room-a") == RoomRouteHint(roomID: "room-a"))
        for input in ["http://qa.example.invalid/rooms/a", "https://prod.example.invalid/rooms/a",
            "https://qa.example.invalid.evil/rooms/a", "https://user@qa.example.invalid/rooms/a",
            "https://qa.example.invalid:443/rooms/a", "https://qa.example.invalid/rooms/a?token=x",
            "https://qa.example.invalid/rooms/a#private", "https://qa.example.invalid/rooms/%2F",
            "https://qa.example.invalid/rooms/../a", "https://qa.example.invalid/rooms/a/b", "not a url"] {
            precondition(parser.parse(input) == nil, "unexpected accepted route")
        }
        var queue = PendingRouteQueue()
        let a = RoomRouteHint(roomID: "a"), b = RoomRouteHint(roomID: "b")
        precondition(queue.offer(a, eventID: "event-a", now: 0, expectedScope: queue.scopeToken))
        let ticketA = queue.begin(now: 0)!
        precondition(!queue.offer(a, eventID: "event-a", now: 1, expectedScope: queue.scopeToken))
        queue.offer(b, eventID: "event-b", now: 2, expectedScope: queue.scopeToken)
        precondition(queue.consume(ticketA, now: 3) == nil)
        let ticketB = queue.begin(now: 3)!
        precondition(queue.consume(ticketB, now: 4) == b)
        precondition(queue.consume(ticketB, now: 5) == nil)
        precondition(!queue.offer(b, eventID: "event-b", now: 6, expectedScope: queue.scopeToken))
        queue.offer(a, eventID: "new-event", now: 7, expectedScope: queue.scopeToken)
        let stale = queue.begin(now: 7)!
        let oldScope = queue.scopeToken
        queue.resetScope()
        precondition(!queue.offer(a, eventID: "late-callback", now: 8, expectedScope: oldScope))
        precondition(queue.consume(stale, now: 8) == nil)
        queue.offer(a, eventID: "expiry", now: 10, expectedScope: queue.scopeToken)
        precondition(queue.begin(now: 10 + PendingRouteQueue.ttl) == nil)
    }
}
#endif
