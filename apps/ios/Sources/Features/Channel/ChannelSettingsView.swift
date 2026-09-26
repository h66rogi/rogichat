import SwiftUI
import PhotosUI
import Kingfisher

// MARK: - Channel Settings View
struct ChannelSettingsView: View {
    let channelId: Int
    let identifier: String
    @StateObject private var viewModel: ChannelSettingsViewModel
    @Environment(\.dismiss) private var dismiss

    init(channelId: Int, identifier: String) {
        self.channelId = channelId
        self.identifier = identifier
        self._viewModel = StateObject(wrappedValue: ChannelSettingsViewModel(channelId: channelId, identifier: identifier))
    }

    var body: some View {
        Group {
            if viewModel.isLoading {
                LoadingView()
            } else {
                Form {
                    // Profile Image Section
                    Section("프로필 이미지") {
                        HStack {
                            Spacer()
                            ProfileImagePicker(
                                imageUrl: viewModel.profileImageUrl,
                                isUploading: viewModel.isUploadingImage,
                                onImageSelected: { data, fileName, mimeType in
                                    Task {
                                        await viewModel.uploadImage(imageData: data, fileName: fileName, mimeType: mimeType)
                                    }
                                }
                            )
                            Spacer()
                        }
                        if viewModel.profileImageUrl != nil {
                            Button("이미지 제거", role: .destructive) {
                                viewModel.profileImageUrl = nil
                            }
                        }
                    }

                    // Channel Name Section
                    Section("채널 이름") {
                        TextField("채널 이름", text: $viewModel.name)
                    }

                    // Additional Links Section
                    Section("추가 링크") {
                        ForEach(viewModel.links.indices, id: \.self) { index in
                            VStack(spacing: 8) {
                                TextField("이름", text: Binding(
                                    get: { viewModel.links[index].name },
                                    set: { viewModel.links[index].name = $0 }
                                ))
                                TextField("URL", text: Binding(
                                    get: { viewModel.links[index].url },
                                    set: { viewModel.links[index].url = $0 }
                                ))
                                .keyboardType(.URL)
                                .autocapitalization(.none)
                            }
                            .swipeActions {
                                Button(role: .destructive) {
                                    viewModel.links.remove(at: index)
                                } label: {
                                    Label("삭제", systemImage: "trash")
                                }
                            }
                        }

                        if viewModel.links.count < 5 {
                            Button {
                                viewModel.links.append(EditableLink(name: "", url: ""))
                            } label: {
                                Label("링크 추가 (\(viewModel.links.count)/5)", systemImage: "plus")
                            }
                        }
                    }

                    // Theme Color Section
                    Section("테마 색상") {
                        ThemeColorPicker(
                            selectedColor: $viewModel.themeColor
                        )
                    }
                }
            }
        }
        .navigationTitle("채널 설정")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("저장") {
                    Task {
                        let success = await viewModel.save()
                        if success {
                            dismiss()
                        }
                    }
                }
                .disabled(viewModel.isSaving || viewModel.name.trimmingCharacters(in: .whitespaces).isEmpty || viewModel.isUploadingImage)
            }
        }
        .alert("오류", isPresented: $viewModel.showError) {
            Button("확인", role: .cancel) {}
        } message: {
            Text(viewModel.errorMessage)
        }
        .task {
            await viewModel.loadChannel()
        }
    }
}

// MARK: - Editable Link
struct EditableLink: Identifiable {
    let id = UUID()
    var name: String
    var url: String
}

// MARK: - Profile Image Picker
struct ProfileImagePicker: View {
    let imageUrl: String?
    let isUploading: Bool
    let onImageSelected: (Data, String, String) -> Void

    @State private var selectedItem: PhotosPickerItem?

    var body: some View {
        PhotosPicker(selection: $selectedItem, matching: .images) {
            ZStack {
                if let imageUrl = imageUrl, let url = URL(string: imageUrl) {
                    KFImage(url)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 100, height: 100)
                        .clipShape(Circle())
                } else {
                    Circle()
                        .fill(Color.gray.opacity(0.3))
                        .frame(width: 100, height: 100)
                        .overlay(
                            Image(systemName: "person.fill")
                                .font(.largeTitle)
                                .foregroundColor(.gray)
                        )
                }

                if isUploading {
                    Circle()
                        .fill(Color.black.opacity(0.5))
                        .frame(width: 100, height: 100)
                    ProgressView()
                        .tint(.white)
                } else {
                    Circle()
                        .fill(Color.black.opacity(0.3))
                        .frame(width: 100, height: 100)
                    Image(systemName: "camera.fill")
                        .foregroundColor(.white)
                        .font(.title2)
                }
            }
        }
        .disabled(isUploading)
        .onChange(of: selectedItem) { newItem in
            guard let item = newItem else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    let mimeType = "image/jpeg"
                    let fileName = "profile_\(Int(Date().timeIntervalSince1970)).jpg"
                    onImageSelected(data, fileName, mimeType)
                }
            }
        }
    }
}

// MARK: - Theme Color Picker
struct ThemeColorPicker: View {
    @Binding var selectedColor: String

    @State private var hexInput: String = ""
    @State private var pickerColor: Color = .blue

    private let presetColors: [String] = [
        "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
        "#06B6D4", "#84CC16", "#F97316", "#EC4899", "#6B7280",
    ]

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 5)

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(presetColors, id: \.self) { color in
                    Circle()
                        .fill(Color(hex: color))
                        .frame(width: 40, height: 40)
                        .overlay(
                            Circle()
                                .stroke(Color.primary, lineWidth: selectedColor.lowercased() == color.lowercased() ? 3 : 0)
                        )
                        .overlay(
                            Image(systemName: "checkmark")
                                .font(.caption.bold())
                                .foregroundColor(.white)
                                .opacity(selectedColor.lowercased() == color.lowercased() ? 1 : 0)
                        )
                        .onTapGesture {
                            selectedColor = color
                            hexInput = color.replacingOccurrences(of: "#", with: "")
                            pickerColor = Color(hex: color)
                        }
                }
            }

            HStack {
                ColorPicker("", selection: $pickerColor, supportsOpacity: false)
                    .labelsHidden()
                    .frame(width: 36, height: 36)
                    .onChange(of: pickerColor) { newColor in
                        let hex = newColor.toHex()
                        selectedColor = hex
                        hexInput = hex.replacingOccurrences(of: "#", with: "")
                    }

                HStack(spacing: 2) {
                    Text("#")
                        .foregroundColor(.secondary)
                    TextField("HEX", text: Binding(
                        get: { hexInput },
                        set: { newValue in
                            let filtered = newValue.uppercased().filter { "0123456789ABCDEF".contains($0) }
                            hexInput = String(filtered.prefix(6))
                            if hexInput.count == 6 {
                                selectedColor = "#\(hexInput)"
                                pickerColor = Color(hex: "#\(hexInput)")
                            }
                        }
                    ))
                    .autocapitalization(.allCharacters)
                    .disableAutocorrection(true)
                }
            }
        }
        .onAppear {
            hexInput = selectedColor.replacingOccurrences(of: "#", with: "").uppercased()
            pickerColor = Color(hex: selectedColor)
        }
    }
}

// MARK: - Color to Hex
extension Color {
    func toHex() -> String {
        let uiColor = UIColor(self)
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        uiColor.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        return String(format: "#%02X%02X%02X", Int(red * 255), Int(green * 255), Int(blue * 255))
    }
}

