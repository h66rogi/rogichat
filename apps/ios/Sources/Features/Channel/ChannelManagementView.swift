import SwiftUI

// MARK: - Channel Management Hub View
struct ChannelManagementView: View {
    let channelId: Int
    let channelName: String
    let identifier: String

    var body: some View {
        List {
            Section("라이브") {
                NavigationLink {
                    ConsoleView(channelId: channelId, channelIdentifier: identifier)
                } label: {
                    Label("신청곡 콘솔", systemImage: "music.mic")
                }
            }

            Section("콘텐츠 관리") {
                NavigationLink {
                    CategoryManagementView(channelId: channelId)
                } label: {
                    Label("카테고리 관리", systemImage: "folder")
                }
            }

            Section("채널 설정") {
                NavigationLink {
                    ChannelSettingsView(channelId: channelId, identifier: identifier)
                } label: {
                    Label("채널 설정", systemImage: "gearshape")
                }
            }
        }
        .navigationTitle(channelName)
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Category Management View
struct CategoryManagementView: View {
    let channelId: Int
    @StateObject private var viewModel: ChannelManagementViewModel
    @State private var editMode: EditMode = .inactive

    init(channelId: Int) {
        self.channelId = channelId
        self._viewModel = StateObject(wrappedValue: ChannelManagementViewModel(channelId: channelId))
    }

    var body: some View {
        Group {
            if viewModel.isLoading && viewModel.categories.isEmpty {
                LoadingView()
            } else if viewModel.categories.isEmpty {
                EmptyStateView(
                    icon: "folder",
                    title: "카테고리가 없습니다",
                    message: "카테고리를 추가하여 노래를 분류해보세요",
                    actionTitle: "카테고리 추가"
                ) {
                    viewModel.showAddForm()
                }
            } else {
                List {
                    ForEach(viewModel.categories) { category in
                        CategoryRow(category: category)
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) {
                                    viewModel.categoryToDelete = category
                                    viewModel.showDeleteConfirmation = true
                                } label: {
                                    Label("삭제", systemImage: "trash")
                                }

                                Button {
                                    viewModel.showEditForm(category: category)
                                } label: {
                                    Label("수정", systemImage: "pencil")
                                }
                                .tint(.blue)
                            }
                    }
                    .onMove { from, to in
                        viewModel.moveCategories(from: from, to: to)
                    }
                }
                .environment(\.editMode, $editMode)
            }
        }
        .navigationTitle("카테고리 관리")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                if !viewModel.categories.isEmpty {
                    Button {
                        withAnimation {
                            editMode = editMode == .active ? .inactive : .active
                        }
                    } label: {
                        Text(editMode == .active ? "완료" : "편집")
                    }
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    viewModel.showAddForm()
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(isPresented: $viewModel.showCategoryForm) {
            CategoryFormSheet(viewModel: viewModel)
        }
        .alert("카테고리 삭제", isPresented: $viewModel.showDeleteConfirmation) {
            Button("삭제", role: .destructive) {
                if let category = viewModel.categoryToDelete {
                    Task {
                        await viewModel.deleteCategory(category)
                    }
                }
            }
            Button("취소", role: .cancel) {}
        } message: {
            if let category = viewModel.categoryToDelete {
                Text("'\(category.name)' 카테고리를 삭제하시겠습니까?\n카테고리에 포함된 곡은 삭제되지 않습니다.")
            }
        }
        .task {
            await viewModel.loadCategories()
        }
    }
}

// MARK: - Category Row
struct CategoryRow: View {
    let category: Category

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(Color(hex: category.color ?? "#888888"))
                .frame(width: 12, height: 12)

            Text(category.name)
                .font(.body)

            Spacer()

            if let songCount = category.songCount {
                Text("\(songCount)곡")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Category Form Sheet
struct CategoryFormSheet: View {
    @ObservedObject var viewModel: ChannelManagementViewModel
    @Environment(\.dismiss) private var dismiss

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 4)

    var body: some View {
        NavigationStack {
            Form {
                Section("이름") {
                    TextField("카테고리 이름", text: $viewModel.formName)
                }

                Section("색상") {
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(ChannelManagementViewModel.presetColors, id: \.self) { color in
                            Circle()
                                .fill(Color(hex: color))
                                .frame(width: 44, height: 44)
                                .overlay(
                                    Circle()
                                        .stroke(Color.primary, lineWidth: viewModel.formColor == color ? 3 : 0)
                                )
                                .overlay(
                                    Image(systemName: "checkmark")
                                        .font(.caption.bold())
                                        .foregroundColor(.white)
                                        .opacity(viewModel.formColor == color ? 1 : 0)
                                )
                                .onTapGesture {
                                    viewModel.formColor = color
                                }
                        }
                    }
                    .padding(.vertical, 8)
                }
            }
            .navigationTitle(viewModel.editingCategory != nil ? "카테고리 수정" : "카테고리 추가")
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
                            if viewModel.editingCategory != nil {
                                await viewModel.updateCategory()
                            } else {
                                await viewModel.createCategory()
                            }
                            dismiss()
                        }
                    }
                    .disabled(viewModel.formName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }
}
