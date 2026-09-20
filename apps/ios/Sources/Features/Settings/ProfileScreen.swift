import SwiftUI

// Adapted ProfileSettingsView's Form, async save, inline error and dismiss-on-success.
// Uses Rogichat's profile policy and explicit nullable PATCH fields.
struct ProfileScreen: View {
    @Environment(\.dismiss) private var dismiss
    @State private var draft: ProfileDraft
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var confirmingDiscard = false
    @State private var saveTask: Task<Void, Never>?
    @FocusState private var editingName: Bool
    let onSave: (ProfileUpdate) async throws -> Void

    init(profile: AccountProfile, onSave: @escaping (ProfileUpdate) async throws -> Void) {
        _draft = State(initialValue: ProfileDraft(profile: profile))
        self.onSave = onSave
    }
    var body: some View {
        Form {
            Section {
                TextField("표시 이름", text: Binding(get: { draft.name.draft }, set: { draft.name.edit($0) }))
                    .focused($editingName).textContentType(.nickname).submitLabel(.done)
                    .onSubmit { editingName = false }.accessibilityLabel("표시 이름")
                HStack {
                    Text(draft.name.error ?? "대화에서 사용할 이름이에요.")
                        .foregroundStyle(draft.name.error == nil ? Color.secondary : .red)
                    Spacer(minLength: 8)
                    Text("\(draft.name.length)/40").foregroundStyle(.secondary).monospacedDigit()
                }.font(.footnote)
            } header: { Text("표시 이름") }
            Section {
                Toggle("생일 등록", isOn: Binding(get: { draft.birthday != nil }, set: { enabled in
                    draft.birthday = enabled ? Birthday(month: 1, day: 1) : nil
                    if !enabled { draft.birthdayVisibleToStreamers = false }
                }))
                if let birthday = draft.birthday {
                    Picker("월", selection: Binding(get: { birthday.month }, set: { month in
                        draft.birthday = Birthday(month: month, day: min(birthday.day, Birthday.days(in: month)))
                    })) {
                        ForEach(1...12, id: \.self) { Text("\($0)월").tag($0) }
                    }
                    Picker("일", selection: Binding(get: { draft.birthday?.day ?? 1 }, set: { day in
                        draft.birthday = Birthday(month: draft.birthday?.month ?? 1, day: day)
                    })) {
                        ForEach(1...max(1, Birthday.days(in: birthday.month)), id: \.self) { Text("\($0)일").tag($0) }
                    }
                    Toggle("스트리머에게 생일 공개", isOn: $draft.birthdayVisibleToStreamers)
                }
            } header: { Text("생일 · 선택") }
              footer: { Text("태어난 연도는 수집하지 않아요. 공개를 선택하면 참여한 대화방의 스트리머에게 생일을 보여줘요.") }
            if let errorMessage {
                Section { Text(errorMessage).font(.footnote).foregroundStyle(.red) }
            }
        }
        .disabled(saving)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("프로필 수정").navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("취소") { if draft.changed { confirmingDiscard = true } else { dismiss() } }.disabled(saving)
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(action: save) {
                    if saving { ProgressView().accessibilityLabel("저장하는 중") } else { Text("저장").fontWeight(.semibold) }
                }.disabled(!draft.canSave || saving)
            }
        }
        .interactiveDismissDisabled(draft.changed || saving)
        .confirmationDialog("변경한 내용을 저장하지 않고 나갈까요?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
            Button("변경 사항 버리기", role: .destructive) { dismiss() }
            Button("계속 수정하기", role: .cancel) {}
        }
        .onDisappear { saveTask?.cancel() }
    }
    private func save() {
        guard draft.canSave, !saving else { return }
        saving = true; errorMessage = nil; editingName = false
        let update = draft.update
        saveTask = Task { @MainActor in
            defer { saving = false }
            do {
                try await onSave(update)
                guard !Task.isCancelled else { return }
                dismiss()
            } catch {
                guard !Task.isCancelled else { return }
                errorMessage = (error as? ProductError)?.errorDescription ?? "프로필을 저장하지 못했어요. 다시 시도해 주세요."
            }
        }
    }
}

// Full profile fields are loaded explicitly; session-summary omissions never become defaults.
struct ProfileLoader: View {
    let onLoad: () async throws -> AccountProfile
    let onSave: (ProfileUpdate) async throws -> Void
    @State private var state: Loadable<AccountProfile> = .idle
    @State private var attempt = 0
    var body: some View {
        LoadableView(state: state) {
            ScreenStatus(title: "프로필을 불러오는 중", message: "", loading: true)
        } loaded: { profile in
            ProfileScreen(profile: profile, onSave: onSave)
        } failed: { error in
            ScreenStatus(title: "프로필을 불러오지 못했어요",
                         message: (error as? ProductError)?.errorDescription ?? "연결을 확인하고 다시 시도해 주세요.",
                         retry: { attempt += 1 })
        }
        .task(id: attempt) {
            state = .loading()
            do {
                let profile = try await onLoad()
                guard !Task.isCancelled else { return }
                state = .loaded(profile)
            } catch {
                guard !Task.isCancelled else { return }
                state = .failed(error)
            }
        }
    }
}
