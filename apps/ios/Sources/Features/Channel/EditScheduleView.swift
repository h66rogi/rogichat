import SwiftUI

struct EditScheduleView: View {
    let schedule: Schedule
    var onComplete: (() -> Void)?

    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: EditScheduleViewModel
    @State private var isAdditionalInfoExpanded = false
    @State private var isDescriptionExpanded = false

    init(schedule: Schedule, onComplete: (() -> Void)? = nil) {
        self.schedule = schedule
        self.onComplete = onComplete
        self._viewModel = StateObject(wrappedValue: EditScheduleViewModel(schedule: schedule))
    }

    var body: some View {
        NavigationStack {
            Form {
                // MARK: - Required Section
                Section {
                    TextField("일정 제목", text: $viewModel.title)
                        .textContentType(.none)
                        .autocorrectionDisabled()

                    DatePicker(
                        "시작 시간",
                        selection: $viewModel.startAt,
                        displayedComponents: viewModel.allDay ? [.date] : [.date, .hourAndMinute]
                    )

                    Toggle("하루 종일", isOn: $viewModel.allDay)
                } header: {
                    Text("필수 항목")
                } footer: {
                    Text("일정 제목과 시작 시간은 필수입니다.")
                }

                // MARK: - End Time Section
                Section {
                    Toggle("종료 시간 설정", isOn: $viewModel.hasEndTime)

                    if viewModel.hasEndTime {
                        DatePicker(
                            "종료 시간",
                            selection: $viewModel.endAt,
                            in: viewModel.startAt...,
                            displayedComponents: viewModel.allDay ? [.date] : [.date, .hourAndMinute]
                        )
                    }
                } header: {
                    Text("종료 시간 (선택)")
                }

                // MARK: - Status Section
                Section {
                    Picker("일정 상태", selection: $viewModel.status) {
                        ForEach(ScheduleType.allCases, id: \.self) { type in
                            Label(type.displayName, systemImage: type.iconName)
                                .tag(type)
                        }
                    }
                    .pickerStyle(.menu)
                } header: {
                    Text("상태")
                }

                // MARK: - Additional Info Section
                Section {
                    DisclosureGroup("추가 정보 (선택)", isExpanded: $isAdditionalInfoExpanded) {
                        TextField("장소", text: $viewModel.location)

                        TextField("외부 링크 (URL)", text: $viewModel.externalUrl)
                            .keyboardType(.URL)
                            .textContentType(.URL)
                            .autocapitalization(.none)
                            .autocorrectionDisabled()
                    }
                }

                // MARK: - Content Section
                Section {
                    DisclosureGroup("설명 (선택)", isExpanded: $isDescriptionExpanded) {
                        TextEditor(text: $viewModel.content)
                            .frame(minHeight: 100)

                        Text("일정에 대한 상세 설명을 입력하세요.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                // MARK: - Visibility Section
                Section {
                    Picker("공개 설정", selection: $viewModel.visibility) {
                        Text("공개").tag("PUBLIC")
                        Text("비공개").tag("PRIVATE")
                    }
                    .pickerStyle(.segmented)
                } header: {
                    Text("공개 설정")
                }
            }
            .navigationTitle("일정 수정")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("저장") {
                        Task {
                            let success = await viewModel.updateSchedule()
                            if success {
                                onComplete?()
                                dismiss()
                            }
                        }
                    }
                    .disabled(!viewModel.isValid || viewModel.isLoading)
                }
            }
            .disabled(viewModel.isLoading)
            .overlay {
                if viewModel.isLoading {
                    Color.black.opacity(0.3)
                        .ignoresSafeArea()
                    ProgressView("저장 중...")
                        .padding()
                        .background(.regularMaterial)
                        .cornerRadius(12)
                }
            }
            .alert("오류", isPresented: .constant(viewModel.errorMessage != nil)) {
                Button("확인") {
                    viewModel.errorMessage = nil
                }
            } message: {
                if let message = viewModel.errorMessage {
                    Text(message)
                }
            }
        }
    }
}

