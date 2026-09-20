import SwiftUI

// Adapted NotificationSettingsView's native List sections and system-settings action.
// Server preferences stay absent until that independent contract exists.
struct NotificationSettingsScreen: View {
    @Environment(\.foregroundEpoch) private var epoch
    @State private var state = NotificationReadState()
    @State private var failure: String?
    @State private var opening = false
    private let system = NotificationSystem()

    var body: some View {
        List {
            Section {
                HStack(spacing: 14) {
                    Image(systemName: "bell.badge.fill").foregroundStyle(AppTheme.accent).font(.title2).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 5) {
                        Text("기기 알림").font(.headline)
                        if state.reading { ProgressView("알림 설정 확인 중") }
                        else { Text(state.snapshot?.description ?? "알림 설정을 확인할 수 없어요.").font(.subheadline).foregroundStyle(.secondary) }
                    }
                }.padding(.vertical, 8)
            } footer: {
                Text("로기챗의 알림 허용 여부와 표시 방식을 확인할 수 있어요.")
            }
            Section {
                Button {
                    guard !opening else { return }
                    opening = true
                    Task {
                        let opened = await system.openSettings()
                        opening = false
                        failure = opened ? nil : "설정을 열지 못했어요. 기기의 설정 앱에서 로기챗을 선택해 주세요."
                    }
                } label: {
                    HStack {
                        Text("iPhone 알림 설정")
                        Spacer()
                        Image(systemName: "arrow.up.right.square").foregroundStyle(.secondary)
                    }.frame(minHeight: 32)
                }.disabled(opening)
            } footer: {
                Text("알림 소리, 배너, 잠금 화면 표시는 iPhone 설정에서 변경할 수 있어요.")
            }
            if let failure { Section { Text(failure).font(.footnote).foregroundStyle(.red) } }
        }
        .task(id: epoch) {
            let ticket = state.begin()
            let snapshot = await system.read()
            guard !Task.isCancelled else { return }
            state.finish(ticket, snapshot)
        }
        .onDisappear { state.cancel() }
    }
}
