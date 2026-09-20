import SwiftUI

struct AccountPresentation {
    let signInSummary: String
    let connectionSummary: String
}
struct AccountScreen: View {
    let account: AccountPresentation
    var onEndPreview: (() -> Void)? = nil
    @State private var notice: Notice?
    private enum Notice { case logout, deletion, endPreview }
    private var title: String {
        switch notice {
        case .logout: return "로그아웃"
        case .deletion: return "회원 탈퇴"
        default: return "미리보기를 종료할까요?"
        }
    }
    var body: some View {
        Group {
            SettingsSection(title: "계정 연결") {
                SettingsRow(icon: "person", title: "로그인 계정", subtitle: account.signInSummary)
                SettingsRow(icon: "link", title: "SOOP 연결", subtitle: account.connectionSummary)
                SettingsRow(icon: "arrow.triangle.2.circlepath", title: "계정 연결 변경", subtitle: "계정 연결 기능 준비 중", enabled: false)
            }
            SettingsSection(title: "계정 관리") {
                SettingsRow(icon: "rectangle.portrait.and.arrow.right", title: "로그아웃", subtitle: "로그아웃 안내 보기") { notice = .logout }
                SettingsRow(icon: "person.crop.circle.badge.minus", title: "회원 탈퇴", subtitle: "회원 탈퇴 안내 보기") { notice = .deletion }
            }
            if onEndPreview != nil { Button("미리보기 종료") { notice = .endPreview }.buttonStyle(.bordered) }
        }
        .alert(title, isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
            Button("취소", role: .cancel) { notice = nil }
            if notice == .endPreview {
                Button("종료", role: .destructive) { notice = nil; onEndPreview?() }
            } else {
                Button("준비 중", role: .destructive) {}.disabled(true)
            }
        } message: {
            switch notice {
            case .logout: Text("로그아웃 기능은 준비 중이에요. 현재 계정은 변경되지 않아요.")
            case .deletion: Text("탈퇴 기능과 데이터 처리 안내를 준비하고 있어요. 현재 계정이나 데이터는 삭제되지 않아요.")
            default: Text("프로필 입력과 대화 초안이 초기화돼요. 실제 계정에는 영향을 주지 않아요.")
            }
        }
    }
}
