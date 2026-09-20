import SwiftUI

// Adapted LoginView's scrollable brand header, social sign-in group and async feedback.
// Email/password and other provider flows do not belong to Rogichat's auth contract.
struct WelcomeScreen: View {
    let methods: [SignInMethod]
    let busy: Bool
    let errorMessage: String?
    let onSignIn: (SignInMethod) -> Void
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ScrollView {
            VStack(spacing: 32) {
                VStack(spacing: 16) {
                    BrandMark(size: 88)
                    Text("로기챗").font(.largeTitle.bold())
                    Text("좋아하는 스트리머와,\n조금 더 가까운 대화")
                        .font(.title2.weight(.semibold))
                        .multilineTextAlignment(.center)
                    Text("함께 나누는 이야기부터 나에게 오는 답장까지.\n로기챗에서 대화를 이어가세요.")
                        .font(.subheadline).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 32)

                VStack(alignment: .leading, spacing: 20) {
                    benefit("bubble.left.and.bubble.right", title: "함께 나누는 대화", message: "스트리머의 이야기와 소식을 한곳에서 만나요.")
                    benefit("person.crop.circle.badge.checkmark", title: "내 계정으로 연결", message: "SOOP 계정을 연결해 대화를 시작해요.")
                    benefit("lock.shield", title: "나를 위한 답장", message: "공개 대화와 개인 답장을 구분해 확인해요.")
                }
                .padding(22)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 24))

                VStack(spacing: 12) {
                    ForEach(methods, id: \.self) { method in
                        Button { onSignIn(method) } label: {
                            HStack(spacing: 8) {
                                Image(systemName: method == .apple ? "apple.logo" : "person.crop.circle")
                                Text(method == .apple ? "Apple로 계속하기" : "SOOP으로 계속하기")
                            }
                            .font(.body.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 52)
                            .foregroundStyle(method == .apple ? (colorScheme == .dark ? Color.black : .white) : .white)
                            .background(method == .apple ? (colorScheme == .dark ? Color.white : .black) : AppTheme.brand,
                                        in: RoundedRectangle(cornerRadius: 14))
                        }.disabled(busy)
                    }
                    if busy { ProgressView("로그인하는 중").padding(.vertical, 8) }
                    if let errorMessage { Text(errorMessage).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center) }
                    if methods.isEmpty {
                        Label("현재 버전에서는 앱 로그인을 지원하지 않아요.", systemImage: "info.circle")
                            .font(.subheadline).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Text("Apple로 로그인한 경우에도 SOOP 계정 연결이 필요해요.")
                        .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                .padding(.bottom, 24)
            }
            .frame(maxWidth: 540)
            .padding(.horizontal, 24)
            .frame(maxWidth: .infinity)
        }
        .background(AppTheme.page)
        .toolbar(.hidden, for: .navigationBar)
    }
    private func benefit(_ icon: String, title: String, message: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon).font(.title3).foregroundStyle(AppTheme.accent).frame(width: 28).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(message).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

struct SOOPLinkScreen: View {
    let busy: Bool
    let canLink: Bool
    let errorMessage: String?
    let onLink: () -> Void
    let onAccount: () -> Void
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Image(systemName: "link.circle.fill").font(.system(size: 64)).foregroundStyle(AppTheme.accent).accessibilityHidden(true)
                Text("SOOP 계정을 연결해 주세요").font(.largeTitle.bold())
                Text("대화에 참여하려면 SOOP 계정 연결이 필요해요. Apple로 만든 로기챗 계정에 SOOP 계정을 연결할 수 있어요.")
                    .foregroundStyle(.secondary)
                if canLink {
                    Button(action: onLink) {
                        HStack { if busy { ProgressView() }; Text("SOOP 계정 연결") }.frame(maxWidth: .infinity, minHeight: 44)
                    }.buttonStyle(.borderedProminent).disabled(busy)
                }
                if let errorMessage { Text(errorMessage).font(.footnote).foregroundStyle(.red) }
                Button("계정 관리", action: onAccount).buttonStyle(.bordered)
            }.padding(24)
        }.background(AppTheme.page)
    }
}
