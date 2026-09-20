import SwiftUI

/// Mounted by the session owner: actions start the real provider flow and account APIs.
struct IdentityEntrySection: View {
    let appleAvailable: Bool
    let busy: Bool
    let soopRequired: Bool
    let beginApple: () -> Void
    let beginSOOPLink: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if soopRequired {
                Text("SOOP 계정 연결이 필요해요").font(.headline)
                Text("Apple 로그인은 완료했어요. 채팅을 이용하려면 SOOP 계정을 연결해 주세요. 연결 전에도 계정 관리와 로그아웃, 탈퇴를 이용할 수 있어요.")
                Button("SOOP 계정 연결", action: beginSOOPLink).disabled(busy)
            } else if appleAvailable {
                Button(action: beginApple) {
                    Label("Apple로 계속", systemImage: "apple.logo")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(.primary)
                .disabled(busy)
            } else {
                Text("지금은 Apple 로그인에 연결할 수 없어요. SOOP 로그인을 이용하거나 잠시 후 다시 시도해 주세요.")
                    .foregroundStyle(.secondary)
            }
        }
    }
}
