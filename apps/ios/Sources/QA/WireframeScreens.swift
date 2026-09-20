#if ROGICHAT_QA
import SwiftUI

struct LinkWireframe: View {
    let onPreview: () -> Void
    let onSinglePreview: () -> Void
    var body: some View {
        WireCard(title: "대화를 시작하기 전") {
            Text("1. 로기챗 계정으로 로그인")
            Text("2. 본인의 SOOP 계정 연결")
            Text("3. 참여할 수 있는 대화방 확인")
        }
        Text("Apple 로그인만으로는 대화방을 이용할 수 없어요. SOOP 연결을 완료해야 해요.")
        Button("SOOP 계정 연결 · 준비 중") {}.buttonStyle(.bordered).disabled(true)
        Button("연결 이후 화면 미리보기", action: onPreview).buttonStyle(.borderedProminent)
        Button("방 1개 계정 화면 미리보기", action: onSinglePreview).buttonStyle(.bordered)
        Text("계정이 연결되거나 생성되지 않아요.").font(.footnote).foregroundStyle(.secondary)
    }
}

struct RoomsWireframe: View {
    let state: WireframeState
    let onScenario: (ListScenario) -> Void
    let onRoom: (String) -> Void
    let onSettings: () -> Void
    var body: some View {
        Text("\(state.role.rawValue) 화면 · 참여 중인 대화방")
        Button("내 프로필 및 설정", action: onSettings)
        Picker("목록 상태", selection: Binding(get: { state.scenario }, set: onScenario)) {
            ForEach(ListScenario.allCases, id: \.self) { Text($0.rawValue).tag($0) }
        }.pickerStyle(.menu)
        switch state.scenario {
        case .content:
            ForEach(state.visibleRooms) { room in
                WireCard(title: room.title) {
                    Text(room.summary)
                    Text("샘플 대화방").font(.caption).foregroundStyle(.secondary)
                    Button("대화 보기") { onRoom(room.id) }.buttonStyle(.bordered)
                }
            }
        case .loading:
            ScreenStatus(title: "대화방을 불러오는 중", message: "위 목록 상태를 바꾸면 다른 화면을 볼 수 있어요.", loading: true)
        case .empty:
            ScreenStatus(title: "아직 참여한 대화방이 없어요", message: "참여 조건이 확인되면 이곳에 대화방이 표시돼요.")
        case .error:
            ScreenStatus(title: "목록을 불러오지 못했어요", message: "연결 오류 화면 예시예요.") { onScenario(.content) }
        }
    }
}

struct ChatWireframe: View {
    let state: WireframeState
    let onAudience: (PreviewAudience) -> Void
    let onTarget: (String) -> Void
    let onDraft: (String) -> Void
    let onReport: () -> Void
    var body: some View {
        Text(WireframeFixtures.rooms.first { $0.id == state.roomID }?.title ?? "대화방").font(.title2.bold())
        Text("오늘 · 샘플 타임라인").foregroundStyle(.secondary)
        WireCard(title: "스트리머 · 전체 대화") { Text("오늘도 만나서 반가워요. 편하게 이야기해 주세요.") }
        if state.role == .fan {
            WireCard(title: "나 · 개인 메시지") {
                Text("오늘 방송도 기대하고 있어요!")
                Text("나와 스트리머에게만 보이는 메시지 예시").font(.caption)
            }
            WireCard(title: "스트리머 · 개인 답장") { Text("고마워요. 곧 만나요!") }
        } else {
            ForEach(WireframeFixtures.fans, id: \.self) { fan in
                WireCard(title: "\(fan) · 개인 메시지") {
                    Text("오늘 방송도 기대하고 있어요!")
                    Button("이 팬에게 답장 선택") { onTarget(fan) }
                }
            }
        }
        WireCard(title: "메시지 작성") {
            if state.role == .streamer {
                Picker("메시지 범위", selection: Binding(get: { state.audience }, set: onAudience)) {
                    ForEach(PreviewAudience.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }.pickerStyle(.menu)
                Text(state.audience == .shared ? "대상: 방 참여자 전체" : "대상: \(state.target ?? "위 메시지에서 팬을 선택해 주세요")")
                Text("대상이 바뀌면 미리보기 입력이 지워져요.").font(.caption)
            } else {
                Text("대상: 이 방의 스트리머 · 개인 메시지")
            }
            TextField("메시지 입력 연습", text: Binding(get: { state.draft }, set: onDraft), axis: .vertical)
                .lineLimit(2...5).textFieldStyle(.roundedBorder).disabled(!state.canCompose)
            Text("\(state.draft.count)/2000 · 입력은 저장되지 않아요").font(.caption)
            Button("전송 · 준비 중") {}.buttonStyle(.borderedProminent).disabled(true)
            Text("첨부·반응·공개 전환은 추후 연결돼요. 실제 메시지가 전송되지 않아요.").font(.footnote)
        }
        Button("신고 및 차단 안내", action: onReport)
    }
}

struct ReportWireframe: View {
    @State private var reason = "스팸 또는 광고"
    var body: some View {
        WireCard(title: "신고 사유 미리보기") {
            Picker("신고 사유", selection: $reason) {
                ForEach(["스팸 또는 광고", "괴롭힘 또는 불쾌한 내용", "기타"], id: \.self) { Text($0).tag($0) }
            }.pickerStyle(.menu)
            Text("실제 메시지나 계정이 선택되지 않은 화면 예시예요.")
            Button("신고 제출 · 준비 중") {}.buttonStyle(.borderedProminent).disabled(true)
            Button("사용자 차단 · 준비 중") {}.buttonStyle(.bordered).disabled(true)
        }
    }
}
#endif
