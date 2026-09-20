#if ROGICHAT_QA
import SwiftUI

struct WireframeHost: View {
    // Deliberately memory-only; restarting exits preview and does not restore authentication.
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
            }.padding(.horizontal, 20).padding(.vertical, 8)
            Divider()
            NavigationStack(path: Binding(get: { state.path }, set: { state.pop(to: $0) })) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        WelcomeScreen()
                        Button("연결 안내부터 미리보기") { state.previewLink() }.buttonStyle(.borderedProminent)
                    }.padding(20)
                }
                .navigationTitle("로기챗 QA")
                .navigationDestination(for: PreviewPage.self) { page in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 20) {
                            switch page {
                            case .link: LinkWireframe { state.previewRooms() }
                            case .rooms: RoomsWireframe(state: state, onScenario: { state.scenario = $0 },
                                onRoom: { state.openRoom($0) }, onSettings: { state.open(.settings) })
                            case .chat: ChatWireframe(state: state, onAudience: { state.changeAudience($0) },
                                onTarget: { state.selectTarget($0) }, onDraft: { state.editDraft($0) }, onReport: { state.open(.report) })
                            case .settings: SettingsWireframe { state.open($0) }
                            case .profile: ProfileWireframe()
                            case .account: AccountWireframe { state.reset() }
                            case .report: ReportWireframe()
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(20)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .navigationTitle(page.rawValue)
                    .navigationBarTitleDisplayMode(.inline)
                }
            }
        }
        .tint(.primary)
    }
}
#endif
