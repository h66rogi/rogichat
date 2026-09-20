import SwiftUI

struct NotificationSettingsScreen: View {
    @Environment(\.foregroundEpoch) private var epoch
    @State private var state = NotificationReadState()
    @State private var failure: String?
    @State private var refreshTrigger = 0
    @State private var openTrigger = 0
    @State private var handledOpenTrigger = 0
    @State private var observing = false
    private let system = NotificationSystem()

    var body: some View {
        NotificationSettingsContent(state: state, openFailure: failure, onRead: {
            observing = true; refreshTrigger += 1
        }, onOpen: { observing = true; refreshTrigger += 1; openTrigger += 1 })
        .task(id: refreshTrigger) {
            guard observing else { return }
            let revision = state.begin()
            let snapshot = await system.read()
            guard !Task.isCancelled else { return }
            state.finish(revision, snapshot)
        }
        .task(id: openTrigger) {
            guard openTrigger > handledOpenTrigger else { return }
            handledOpenTrigger = openTrigger
            let opened = await system.openSettings()
            guard !Task.isCancelled else { return }
            failure = opened ? nil : "시스템 설정을 열지 못했어요. 기기 설정에서 로기챗을 찾아주세요."
        }
        .onChange(of: epoch) { _, _ in if observing { refreshTrigger += 1 } }
        .onDisappear { state.cancel() }
    }
}
struct NotificationSettingsContent: View {
    let state: NotificationReadState
    var openFailure: String? = nil
    var onRead: (() -> Void)? = nil
    var onOpen: (() -> Void)? = nil
    private var status: String {
        if state.reading { return "알림 상태를 확인하는 중이에요" }
        if state.failed { return "기기 알림 상태를 확인하지 못했어요. 다시 확인해 주세요." }
        return state.snapshot?.description ?? "아직 확인하지 않았어요"
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            SettingsSection(title: "이 기기의 OS 설정") {
                SettingsRow(icon: "bell", title: "알림 권한 확인", subtitle: status,
                    enabled: onRead != nil && !state.reading, action: onRead)
                SettingsRow(icon: "gearshape", title: "시스템 알림 설정 열기", subtitle: "기기 설정을 직접 확인해요",
                    enabled: onOpen != nil, action: onOpen)
            }
            if let openFailure { Text(openFailure).font(.footnote) }
            SettingsSection(title: "서비스 연결") {
                SettingsRow(icon: "slider.horizontal.3", title: "알림 선호 설정", subtitle: "서버 미연동 · 저장되지 않아요", enabled: false)
                SettingsRow(icon: "iphone", title: "기기 등록", subtitle: "푸시 제공자 미연동 · 등록되지 않았어요", enabled: false)
            }
            Text("권한을 확인해도 푸시 수신이 활성화되지는 않아요. 권한 요청이나 기기 등록을 자동 실행하지 않아요.")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }
}
