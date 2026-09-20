import SwiftUI

// Reuses native settings sections, destructive confirmation and error rendering.
// Receipts are actual protected records; no status is inferred from session GET.
struct AccountDeletionScreen: View {
    let records: [AccountDeletionPresentation]
    let busy: Bool
    let error: String?
    let onRetry: (UUID) -> Void
    let onReset: () -> Void
    let onDismiss: () -> Void
    var body: some View {
        NavigationStack {
            List {
                if let error { Section { Text(error).foregroundStyle(.red).accessibilityLabel(error) } }
                ForEach(records.reversed()) { record in
                    Section {
                        if record.working { ProgressView(record.message) }
                        else { Text(record.message).fixedSize(horizontal: false, vertical: true) }
                        if let request = record.requestID {
                            LabeledContent("접수 번호", value: request).textSelection(.enabled)
                        }
                        if record.cleanupPending && !record.working {
                            Text("이 기기의 계정 정보 정리가 남아 있어요.").font(.footnote).foregroundStyle(.secondary)
                            Button("기기 정리 다시 시도") { onRetry(record.id) }.disabled(busy)
                        }
                    }
                }
                Section {
                    Text("응답을 확인하지 못했어도 서버 요청이 접수되었을 수 있어요. 이 화면을 닫거나 다시 로그인해도 서버 요청이 취소되지는 않아요.")
                        .font(.footnote).foregroundStyle(.secondary)
                    Button("이 기기의 정보 초기화", role: .destructive, action: onReset).disabled(busy)
                }
            }
            .navigationTitle("탈퇴 요청 기록")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("확인", action: onDismiss) } }
        }
    }
}
