import SwiftUI

struct ActorBlocksPanel: View {
    let token: BlockViewToken
    let blocks: [BlockedActor]
    let complete: Bool
    let busy: Bool
    let failed: Bool
    let unknownActors: Set<String>
    let lastOutcome: UnblockOutcome?
    let onRefresh: () -> Void
    let onMore: () -> Void
    let onUnblock: (BlockViewToken, String) -> Void
    private struct Selection { let token: BlockViewToken; let actorId: String }
    @State private var selected: Selection?
    var body: some View {
        VStack(alignment: .leading) {
            Text("이 방의 차단 관리")
            if busy { ProgressView() }
            if !busy, lastOutcome == .rejected { Text("차단 해제 요청을 처리할 수 없어요. 현재 상태를 확인해 주세요.") }
            if !busy, lastOutcome == .acknowledged { Text("차단 해제가 반영되었어요.") }
            if failed { Text("차단 목록을 불러오지 못했어요. 다시 확인해 주세요.") }
            if complete, blocks.isEmpty { Text("차단한 사용자가 없어요.") }
            if !unknownActors.isEmpty { Text("이전 요청의 처리 결과는 확인하지 못했어요. 목록은 현재 확인된 차단 상태예요.") }
            ForEach(blocks, id: \.actorId) { actor in
                Text("\(actor.displayLabel) · \(actor.blockedAt.prefix(10))")
                Button("차단 해제") { selected = Selection(token: token, actorId: actor.actorId) }.disabled(!complete || busy)
            }
            if !complete, !blocks.isEmpty { Button("더 보기", action: onMore).disabled(busy) }
            Button("현재 상태 확인", action: onRefresh).disabled(busy)
        }
        .onChange(of: token) { _, _ in selected = nil }
        .alert("차단 해제", isPresented: Binding(get: { selected != nil }, set: { if !$0 { selected = nil } }), presenting: selected) { captured in
            Button("해제") { selected = nil; onUnblock(captured.token, captured.actorId) }.disabled(!complete || busy)
            Button("취소", role: .cancel) { selected = nil }
        } message: { _ in Text("이 방에서 차단을 해제할까요? 이전 참여 권한은 복구되지 않아요.") }
    }
}
