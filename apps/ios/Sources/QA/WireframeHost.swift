#if ROGICHAT_QA
import SwiftUI

struct WireframeHost: View {
    // QA role/access selectors supply presentation fixtures, never authentication.
    @State private var state = WireframeState()
    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                Text("QA · 화면 미리보기").font(.headline)
                Text("샘플 데이터 · 실제 로그인 및 전송 안 됨").font(.caption)
                HStack {
                    Picker("미리보기 역할", selection: Binding(get: { state.role }, set: { state.switchRole($0) })) {
                        ForEach(PreviewRole.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }.pickerStyle(.segmented)
                    Button("초기화") { state.reset() }
                }
                Picker("이용 상태 예시", selection: Binding(get: { state.navigation.access }, set: { state.switchAccess($0) })) {
                    ForEach(ShellAccess.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }.pickerStyle(.menu)
            }.padding(.horizontal, 20).padding(.vertical, 8)
            Divider()
            AppShell(navigation: state.navigation, onTab: { state.selectTab($0) }, onPop: { state.pop(to: $0, in: $1) }) { page in
                switch page {
                case .welcome:
                    WelcomeScreen()
                    Button("연결 안내부터 미리보기") { state.previewLink() }.buttonStyle(.borderedProminent)
                case .link: LinkWireframe(onPreview: { state.previewRooms() }, onSinglePreview: { state.previewRooms(singleRoom: true) })
                case .rooms: RoomsWireframe(state: state, onScenario: { state.scenario = $0 },
                    onRoom: { state.openRoom($0) }, onSettings: { state.open(.settings) })
                case .chat: ChatWireframe(state: state, onAudience: { state.changeAudience($0) },
                    onTarget: { state.selectTarget($0) }, onDraft: { state.editDraft($0) }, onReport: { state.open(.report) })
                case .settings: SettingsScreen(access: state.navigation.access) { state.open($0) }
                case .profile: ProfileWireframe()
                case .account: AccountWireframe { state.reset() }
                case .report: ReportWireframe()
                case .notifications: NotificationSettingsScreen()
                case .about: AboutScreen()
                case .status: ScreenStatus(title: state.navigation.access.rawValue, message: "계정 이용 상태 안내 화면이에요. 설정에서 앱 정보와 지원을 확인할 수 있어요.")
                }
            }
        }
    }
}
#endif
