import SwiftUI

struct ProfileScreen: View {
    let editor: ProfileEditor
    let onEdit: (String) -> Void
    let onDiscard: () -> Void
    let onRetry: () -> Void
    @State private var confirmingDiscard = false
    var body: some View {
        Group {
            switch editor.phase {
            case .loading: ScreenStatus(title: "프로필을 불러오는 중", message: "잠시만 기다려 주세요.", loading: true)
            case .failed: ScreenStatus(title: "프로필을 불러오지 못했어요", message: "다시 시도해 주세요.", retry: onRetry)
            case .unavailable: ScreenStatus(title: "프로필 연결 준비 중", message: "계정 정보 연결 후 편집할 수 있어요.")
            case .ready:
                SettingsSection(title: "표시 이름") {
                    VStack(alignment: .leading, spacing: 12) {
                        TextField("표시 이름", text: Binding(get: { editor.draft }, set: onEdit))
                            .textFieldStyle(.roundedBorder).accessibilityLabel("표시 이름")
                        Text(editor.error ?? "\(editor.length)/40").font(.footnote)
                            .foregroundStyle(editor.error == nil ? Color.secondary : Color.red)
                        Text("변경한 이름은 아직 저장되지 않아요. 이 실행에서만 입력이 유지돼요.").font(.footnote)
                        Button("저장 · 준비 중") {}.buttonStyle(.borderedProminent).disabled(true)
                        Button("입력 되돌리기") { confirmingDiscard = true }.disabled(!editor.changed)
                    }.padding(16)
                }
                SettingsSection(title: "선택 정보") {
                    SettingsRow(icon: "photo", title: "프로필 사진", subtitle: "사진 설정 준비 중", enabled: false)
                    SettingsRow(icon: "gift", title: "생일과 공개 범위", subtitle: "선택 정보 설정 준비 중 · 생일을 입력받지 않아요", enabled: false)
                }
            }
        }
        .alert("입력을 되돌릴까요?", isPresented: $confirmingDiscard) {
            Button("취소", role: .cancel) {}
            Button("되돌리기", role: .destructive, action: onDiscard)
        } message: { Text("이름 입력을 처음 값으로 되돌려요.") }
    }
}
