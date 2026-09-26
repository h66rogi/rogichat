import SwiftUI

// Adapted MyPageView's account actions and explicit destructive confirmation.
// Only operations backed by the injected account service are displayed.
struct AccountScreen: View {
    let session: AppSession
    let account: AccountSummary
    let capabilities: SessionCapabilities
    let onLink: () -> Void
    let onLinkApple: () -> Void
    let prepareDeletion: () -> AccountDeletionIntent?
    let onDelete: (AccountDeletionIntent) -> Void
    @State private var deletionIntent: AccountDeletionIntent?
    @State private var showDeletionConfirmation = false

    var body: some View {
        List {
            Section("로그인 계정") {
                if let method = account.signInMethod { LabeledContent("로그인 방법", value: method) }
                LabeledContent("표시 이름", value: account.displayName)
            }
            Section {
                Label(account.soopConnected ? "SOOP 계정 연결됨" : "SOOP 계정 연결 필요",
                      systemImage: account.soopConnected ? "checkmark.seal.fill" : "link")
                    .foregroundStyle(account.soopConnected ? AppTheme.accent : .secondary)
                if !account.soopConnected && capabilities.canLinkSOOP {
                    Button("SOOP 계정 연결", action: onLink)
                }
                if capabilities.canLinkApple { Button("Apple 계정 연결", action: onLinkApple) }
            } header: { Text("연결된 계정") }
              footer: { Text("대화를 이용하려면 SOOP 계정이 연결되어 있어야 해요.") }
            AccountAccessSettings(session: session)
            LoggedInDevices(session: session)
            if capabilities.canDeleteAccount {
                Section {
                    Button("회원 탈퇴", role: .destructive) {
                        if let intent = prepareDeletion() { deletionIntent = intent; showDeletionConfirmation = true }
                    }
                }
            }
        }
        .confirmationDialog("로기챗에서 탈퇴할까요?",
                            isPresented: $showDeletionConfirmation, titleVisibility: .visible) {
            Button("회원 탈퇴 요청", role: .destructive) {
                if let intent = deletionIntent { deletionIntent = nil; onDelete(intent) }
            }
            Button("취소", role: .cancel) { deletionIntent = nil }
        } message: {
            Text("\(deletionIntent?.accountName ?? account.displayName) 계정의 탈퇴를 요청할까요? 접수되면 계정을 이용할 수 없어요. 접수는 데이터 삭제 완료를 뜻하지 않아요.")
        }
    }
}
