import SwiftUI

// Adapted MyPageView's account actions and explicit destructive confirmation.
// Only operations backed by the injected account service are displayed.
struct AccountScreen: View {
    let account: AccountSummary
    let capabilities: SessionCapabilities
    let onLink: () -> Void
    let onSignOut: () async throws -> Void
    let onDelete: () async throws -> Void
    @State private var notice: Notice?
    @State private var working = false
    @State private var errorMessage: String?
    private enum Notice { case logout, deletion }

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
            } header: { Text("연결된 계정") }
              footer: { Text("대화를 이용하려면 SOOP 계정이 연결되어 있어야 해요.") }
            if capabilities.canSignOut || capabilities.canDeleteAccount {
                Section {
                    if capabilities.canSignOut { Button("로그아웃", role: .destructive) { notice = .logout } }
                    if capabilities.canDeleteAccount { Button("회원 탈퇴", role: .destructive) { notice = .deletion } }
                }
            }
            if working { Section { ProgressView("처리하는 중").frame(maxWidth: .infinity) } }
            if let errorMessage { Section { Text(errorMessage).font(.footnote).foregroundStyle(.red) } }
        }
        .disabled(working)
        .confirmationDialog(notice == .deletion ? "로기챗에서 탈퇴할까요?" : "로그아웃할까요?",
                            isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } }), titleVisibility: .visible) {
            if notice == .deletion {
                Button("회원 탈퇴", role: .destructive) { perform(onDelete) }
            } else {
                Button("로그아웃", role: .destructive) { perform(onSignOut) }
            }
            Button("취소", role: .cancel) { notice = nil }
        } message: {
            Text(notice == .deletion ? "탈퇴하면 이 계정으로 로기챗을 이용할 수 없어요. 계속하려면 회원 탈퇴를 선택해 주세요." : "이 기기에서 로기챗 계정을 로그아웃해요.")
        }
    }
    private func perform(_ action: @escaping () async throws -> Void) {
        guard !working else { return }
        notice = nil; working = true; errorMessage = nil
        Task { @MainActor in
            defer { working = false }
            do { try await action() }
            catch { errorMessage = "요청을 완료하지 못했어요. 연결을 확인하고 다시 시도해 주세요." }
        }
    }
}
