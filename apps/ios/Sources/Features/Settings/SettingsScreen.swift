import SwiftUI

struct SettingsScreen: View {
    let access: ShellAccess
    let onOpen: (AppPage) -> Void
    var body: some View {
        SettingsSection(title: "내 계정") {
            if access == .ready {
                SettingsRow(icon: "person", title: "내 프로필", subtitle: "표시 이름과 선택 정보") { onOpen(.profile) }
            }
            if access == .ready || access == .linkRequired {
                SettingsRow(icon: "person.crop.circle", title: "계정 관리", subtitle: "연결 상태 · 로그아웃 · 회원 탈퇴") { onOpen(.account) }
            } else {
                SettingsRow(icon: "person.crop.circle", title: "계정 기능", subtitle: "로그인 및 이용 상태 확인 후 사용할 수 있어요", enabled: false)
            }
        }
        SettingsSection(title: "앱 설정") {
            SettingsRow(icon: "bell", title: "알림", subtitle: "기기 권한과 서비스 연결 상태") { onOpen(.notifications) }
            SettingsRow(icon: "info.circle", title: "앱 정보 및 지원", subtitle: "버전 · 이용약관 · 개인정보 처리방침") { onOpen(.about) }
        }
        Text("서비스에 연결되지 않은 설정은 변경하거나 저장하지 않아요.").font(.footnote).foregroundStyle(.secondary)
    }
}
struct AboutScreen: View {
    private var version: String {
        let info = Bundle.main.infoDictionary ?? [:]
        return "\(info["CFBundleShortVersionString"] as? String ?? "—") (\(info["CFBundleVersion"] as? String ?? "—")) · \(info["RogichatEnvironment"] as? String ?? "—")"
    }
    var body: some View {
        SettingsSection(title: "로기챗") {
            SettingsRow(icon: "app", title: "앱 버전", subtitle: version)
        }
        SettingsSection(title: "정책 및 지원") {
            SettingsRow(icon: "doc.text", title: "이용약관", subtitle: "공개 주소 준비 중", enabled: false)
            SettingsRow(icon: "lock", title: "개인정보 처리방침", subtitle: "공개 주소 준비 중", enabled: false)
            SettingsRow(icon: "questionmark.circle", title: "문의하기", subtitle: "지원 경로 준비 중", enabled: false)
        }
    }
}
