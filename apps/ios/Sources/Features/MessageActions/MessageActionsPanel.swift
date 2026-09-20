import SwiftUI

/// Parent owns the observable composition and supplies only current scoped state.
struct MessageActionsPanel: View {
    let token: ActionViewToken
    let record: ActionRecord?
    let busy: Bool
    let reactions: MessageReactions?
    let onAction: (ActionViewToken, MessageAction, String?) -> Void
    let onRefresh: (ActionViewToken) -> Void
    private struct Confirmation { let token: ActionViewToken; let action: MessageAction }
    @State private var confirmation: Confirmation?
    private var blocked: Bool { busy || record.map { [.unknown, .preparing, .blocked, .actorBlocked].contains($0.phase) } == true }
    var body: some View {
        VStack(alignment: .leading) {
            if busy { ProgressView() }
            if let record { Text(actionStatus(record.phase)) }
            if let reactions {
                HStack { ForEach(reactions.counts, id: \.emoji) { count in Text("\(count.emoji) \(count.count)") } }
            }
            if record?.phase != .blocked {
                HStack {
                    if token.selection.hints.delete, !token.selection.anonymous {
                        Button("삭제", role: .destructive) { confirmation = Confirmation(token: token, action: .delete) }.disabled(blocked)
                    }
                    if token.selection.hints.publish, !token.selection.anonymous, ["TEXT", "PHOTO"].contains(token.selection.contentKind) {
                        Button("익명으로 공개") { confirmation = Confirmation(token: token, action: .publish) }.disabled(blocked)
                    }
                }
                HStack { ForEach(reactionChoices, id: \.self) { emoji in
                    Button(emoji) { onAction(token, .setReaction, emoji) }.disabled(blocked)
                } }
                if reactions?.mine != nil { Button("내 반응 취소") { onAction(token, .removeReaction, nil) }.disabled(blocked) }
            }
            Button("현재 상태 확인") { onRefresh(token) }.disabled(busy)
        }
        .onChange(of: token) { _, _ in confirmation = nil }
        // Adapted from non-chat MyReviewsView's presenting-target deletion alert.
        .alert(confirmation?.action == .delete ? "메시지 삭제" : "메시지 공개",
            isPresented: Binding(get: { confirmation != nil }, set: { if !$0 { confirmation = nil } }),
            presenting: confirmation) { captured in
                let action = captured.action
                Button(action == .delete ? "삭제" : "공개", role: action == .delete ? .destructive : nil) {
                    confirmation = nil; onAction(captured.token, action, nil)
                }.disabled(blocked)
                Button("취소", role: .cancel) { confirmation = nil }
            } message: { captured in
                Text(captured.action == .delete ? "이 메시지를 삭제할까요? 연결된 공개본도 더 이상 볼 수 없어요."
                    : "작성자를 익명으로 표시해 방 전체에 공개할까요?")
            }
    }
}
func actionStatus(_ phase: ActionPhase) -> String {
    switch phase {
    case .reported: "신고가 접수되었어요."
    case .actorBlocked: "차단이 반영되었어요. 방 내용을 다시 불러옵니다."
    case .unknown: "처리 결과를 확인하지 못했어요. 같은 요청을 다시 보내지 않고 현재 상태를 확인해 주세요."
    case .blocked: "메시지 접근이 차단되었어요."
    case .preparing: "공개 요청을 접수했어요. 공개 상태를 확인해 주세요."
    case .published: "메시지가 익명으로 공개되었어요."
    case .revoked: "공개본 접근이 회수되었어요."
    case .reacted: "반응이 반영되었어요."
    case .rejected: "요청을 처리할 수 없어요. 현재 상태를 확인해 주세요."
    }
}

struct MessageModerationPanel: View {
    let token: ActionViewToken
    let busy: Bool
    let onAction: (ActionViewToken, MessageAction, ReportReason?) -> Void
    @State private var reportToken: ActionViewToken?
    @State private var blockToken: ActionViewToken?
    var body: some View {
        VStack(alignment: .leading) {
            Button("신고") { reportToken = token }.disabled(busy)
            if !token.selection.anonymous, let actor = token.selection.visibleActorId, actor != token.selection.scope.actorId {
                Button("작성자 차단") { blockToken = token }.disabled(busy)
            }
        }
        .onChange(of: token) { _, _ in reportToken = nil; blockToken = nil }
        .confirmationDialog("신고 사유", isPresented: Binding(get: { reportToken != nil }, set: { if !$0 { reportToken = nil } }), titleVisibility: .visible, presenting: reportToken) { captured in
            ForEach(ReportReason.allCases, id: \.self) { reason in
                Button(reason.label) { onAction(captured, .report, reason) }.disabled(busy)
            }
            Button("취소", role: .cancel) { reportToken = nil }
        }
        .alert("작성자 차단", isPresented: Binding(get: { blockToken != nil }, set: { if !$0 { blockToken = nil } }), presenting: blockToken) { captured in
            Button("차단", role: .destructive) { onAction(captured, .blockActor, nil) }.disabled(busy)
            Button("취소", role: .cancel) { blockToken = nil }
        } message: { _ in Text("이 방에서 작성자를 차단할까요? 메시지 표시와 직접 전송이 제한돼요.") }
    }
}
