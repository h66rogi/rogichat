#if ROGICHAT_QA
import SwiftUI

private enum NotificationExample: String, CaseIterable {
    case device = "실제 기기", unknown = "미확인 예시", reading = "조회 중 예시", notRequested = "미요청 예시"
    case denied = "차단 예시", allowed = "허용 예시", alertsOff = "표시 꺼짐 예시", quiet = "조용한 알림 예시", failed = "조회 오류 예시"
}
struct NotificationPreview: View {
    @State private var example: NotificationExample = .device
    private var state: NotificationReadState {
        var state = NotificationReadState()
        if example == .unknown { return state }
        let ticket = state.begin()
        if example == .reading { return state }
        if example == .failed { state.fail(ticket); return state }
        let authorization: NotificationAuthorization
        switch example {
        case .notRequested: authorization = .notRequested
        case .denied: authorization = .denied
        case .quiet: authorization = .quiet
        default: authorization = .allowed
        }
        state.finish(ticket, NotificationSnapshot(authorization: authorization, alertsEnabled: example != .alertsOff))
        return state
    }
    var body: some View {
        Picker("알림 화면", selection: $example) {
            ForEach(NotificationExample.allCases, id: \.self) { Text($0.rawValue).tag($0) }
        }.pickerStyle(.menu)
        Group {
            if example == .device { NotificationSettingsScreen() }
            else {
                Text("OS 상태 예시 · 실제 기기 설정과 달라요. 권한 요청이나 설정 변경은 실행하지 않아요.").font(.footnote)
                NotificationSettingsContent(state: state)
            }
        }.id(example)
    }
}
#endif
