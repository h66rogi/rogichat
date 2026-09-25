import SwiftUI

// Adapted LoginView's scrollable brand header, social sign-in group and async feedback.
// Password form reuses the same reference once a real native contract is available.
struct WelcomeScreen: View {
    let methods: [SignInMethod]
    let busy: Bool
    let errorMessage: String?
    let onCancel: () -> Void
    let onSignIn: (SignInMethod) -> Void
    var onPassword: ((PasswordInput) -> Void)? = nil
    @State private var showPassword = false
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
                    Text("좋아하는 스트리머의 이야기를 만나고\n로기챗에서 대화를 이어가세요.")
                        .font(.subheadline).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 32)

                VStack(alignment: .leading, spacing: 20) {
                    benefit("bubble.left.and.bubble.right", title: "함께 나누는 대화", message: "스트리머의 이야기와 소식을 한곳에서 만나요.")
                    benefit("person.crop.circle.badge.checkmark", title: "내 계정으로 연결", message: "내 프로필로 대화를 시작해요.")
                    benefit("bell", title: "새 소식 확인", message: "대화와 새 소식을 편하게 확인해요.")
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
                    if let onPassword {
                        DisclosureGroup("아이디로 로그인",isExpanded:$showPassword) { PasswordForm(changing:false,busy:busy,onSubmit:onPassword).padding(.top,12) }
                    }
                    if busy {
                        ProgressView("로그인하는 중").padding(.vertical, 8)
                        Button("로그인 취소", action: onCancel)
                    }
                    if let errorMessage { Text(errorMessage).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center) }
                    if methods.isEmpty {
                        Label("현재 버전에서는 앱 로그인을 지원하지 않아요.", systemImage: "info.circle")
                            .font(.subheadline).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if methods.contains(.apple) {
                        Text("계정 연결이 필요한 경우 로그인 후 안내해 드려요.")
                            .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    }
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
    let onCancel: () -> Void
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Image(systemName: "link.circle.fill").font(.system(size: 64)).foregroundStyle(AppTheme.accent).accessibilityHidden(true)
                Text("SOOP 계정을 연결해 주세요").font(.largeTitle.bold())
                Text("대화에 참여하려면 SOOP 계정 연결이 필요해요. 현재 로기챗 계정에 사용할 SOOP 계정을 연결해 주세요.")
                    .foregroundStyle(.secondary)
                if canLink {
                    Button(action: onLink) {
                        HStack { if busy { ProgressView() }; Text("SOOP 계정 연결") }.frame(maxWidth: .infinity, minHeight: 44)
                    }.buttonStyle(.borderedProminent).disabled(busy)
                }
                if busy { Button("계정 연결 취소", action: onCancel) }
                if let errorMessage { Text(errorMessage).font(.footnote).foregroundStyle(.red) }
                Button("계정 관리", action: onAccount).buttonStyle(.bordered)
            }.padding(24)
        }.background(AppTheme.page)
    }
}

// Adapted Meloming LoginView's labeled credentials, SecureField, async state and submit guard.
struct PasswordForm: View {
    let changing: Bool
    let busy: Bool
    let onSubmit: (PasswordInput) -> Void
    @State private var loginID = ""
    @State private var password = ""
    @State private var replacement = ""
    @State private var confirmation = ""
    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var field: Int?
    private var valid: Bool {
        PasswordInput.valid(password) && (changing ? PasswordInput.valid(replacement) && replacement == confirmation :
            loginID.range(of: "^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$",options:.regularExpression) != nil)
    }
    var body: some View {
        VStack(alignment:.leading,spacing:16) {
            if !changing {
                Text("아이디").font(.subheadline.weight(.medium))
                TextField("아이디",text:$loginID).textFieldStyle(.roundedBorder).textContentType(.username)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().focused($field,equals:0).submitLabel(.next).onSubmit { field = 1 }
            }
            Text(changing ? "현재 비밀번호" : "비밀번호").font(.subheadline.weight(.medium))
            SecureField("비밀번호",text:$password).textFieldStyle(.roundedBorder).textContentType(.password)
                .focused($field,equals:1).submitLabel(changing ? .next : .go).onSubmit { if changing { field = 2 } else { submit() } }
            if changing {
                Text("새 비밀번호").font(.subheadline.weight(.medium))
                SecureField("12자 이상, 최대 256바이트",text:$replacement).textFieldStyle(.roundedBorder).textContentType(.newPassword).focused($field,equals:2).submitLabel(.next).onSubmit { field = 3 }
                SecureField("새 비밀번호 확인",text:$confirmation).textFieldStyle(.roundedBorder).textContentType(.newPassword).focused($field,equals:3).submitLabel(.go).onSubmit { submit() }
                Text("변경하면 다른 기기의 로그인도 해제됩니다.").font(.footnote).foregroundStyle(.secondary)
            }
            Button(action:submit) {
                HStack { if busy { ProgressView() }; Text(changing ? "비밀번호 변경" : "로그인") }.frame(maxWidth:.infinity,minHeight:44)
            }.buttonStyle(.borderedProminent).disabled(!valid || busy)
        }.disabled(busy)
        .onChange(of:scenePhase) { _, phase in if phase != .active { clear() } }
        .onDisappear { clear() }
    }
    private func submit() {
        guard valid, !busy else { return }
        let input = PasswordInput(loginID:changing ? nil : loginID,password:password,newPassword:changing ? replacement : nil)
        clear(); field = nil; onSubmit(input)
    }
    private func clear() { password = ""; replacement = ""; confirmation = "" }
}
