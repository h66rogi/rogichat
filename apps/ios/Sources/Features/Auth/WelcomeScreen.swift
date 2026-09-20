import SwiftUI

struct WelcomeScreen: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("가까이 나누는 대화").font(.largeTitle.bold())
            Text("좋아하는 스트리머와 로기챗에서 만나요.")
            WireCard(title: "계정으로 시작하기") {
                Button("Apple로 계속하기 · 준비 중") {}.buttonStyle(.borderedProminent).disabled(true)
                Button("SOOP으로 계속하기 · 준비 중") {}.buttonStyle(.bordered).disabled(true)
                Text("Apple로 시작해도 서비스를 이용하려면 SOOP 계정 연결이 필요해요.")
                Text("현재는 로그인 연동을 준비하고 있어요. 계정 정보는 수집하지 않아요.").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}
